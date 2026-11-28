/**
 * The explorer: every analysed note placed by meaning, coloured and sized by a chosen variable,
 * with the explicit links, suggested links (with their reasons and the three actions), a drift
 * through the closest notes, and the card of the selected note. Display choices are saved with
 * the view. Nothing here writes to a note, except the "Link" action, on click.
 */
import { ItemView, Menu, Notice, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import {
	ExplorerView,
	PhysicsClient,
	categoricalColours,
	physicsEdges,
	similarityAtCentile,
	colourOf,
	driftStep,
	numericColours,
	sizes,
	SEQUENTIAL,
	MISSING_COLOUR,
	type AnalysisResult,
	type ExplorerEdge,
	type ExplorerEdgeKind,
	type ExplorerOptions,
	type ExplorerLegend,
	type ProjectionMethod,
	type ProjectionResult,
	type Suggestion,
} from '@semanticatlas/core';
import engineWasm from '@semanticatlas/engine/engine.wasm';
import physicsWorkerCode from 'virtual:physics-worker';
import type SemanticAtlasPlugin from '../main';
import type { MessageKey } from '../i18n';
import { collectRelations } from '../adapter/collect';
import { linkResolver, readNotes } from '../adapter/vault';
import { SUBMAP_KINDS, SUBMAP_MAX, SUBMAP_MIN, subsetFor, type SubmapKind } from '../explorer/submap';
import { CATEGORY_BY, NUMBER_BY, SIZE_BY, categoryValues, isCategory, numericValues, sizeValues, type ColourBy, type SizeBy, type VariableContext } from '../explorer/variables';

export const VIEW_TYPE_EXPLORER = 'semantic-atlas-explorer';

const EDGE_KINDS: ExplorerEdgeKind[] = ['link', 'embed', 'property', 'suggested'];
const PANELS = ['note', 'suggestions', 'forces'] as const;
type Panel = (typeof PANELS)[number];
const SUGGESTIONS_SHOWN = 40;

type Layout = 'landscape' | 'physics' | ProjectionMethod;
const LAYOUTS: readonly Layout[] = ['tsne', 'umap', 'pacmap', 'physics', 'landscape'];
const PROJECTIONS: readonly ProjectionMethod[] = ['tsne', 'umap', 'pacmap'];

/** Settings of the free physics, saved with the view. */
interface PhysicsState {
	/** Projection the notes start from and are anchored to. */
	anchorTo: ProjectionMethod;
	centre: number;
	repulsion: number;
	/** Stiffness of explicit links (0: not simulated). */
	links: number;
	/** Stiffness of semantic edges (0: not simulated). */
	semantic: number;
	/** Semantic edges above this centile of the neighbours' similarities. */
	semanticCentile: number;
	linkDistance: number;
	cohesion: number;
	anchor: number;
	damping: number;
	collide: number;
	halo: boolean;
}

const DEFAULT_PHYSICS: PhysicsState = {
	anchorTo: 'tsne',
	centre: 0.05,
	repulsion: 30,
	links: 1,
	semantic: 0.5,
	semanticCentile: 50,
	linkDistance: 30,
	cohesion: 0.3,
	anchor: 0.2,
	damping: 0.4,
	collide: 3,
	halo: true,
};

/** Sliders of the forces panel: key, minimum, maximum, step. */
const SLIDERS: readonly [keyof PhysicsState, number, number, number][] = [
	['centre', 0, 0.3, 0.01],
	['repulsion', 0, 200, 5],
	['links', 0, 2, 0.1],
	['semantic', 0, 2, 0.1],
	['semanticCentile', 0, 100, 5],
	['linkDistance', 5, 120, 5],
	['cohesion', 0, 1, 0.05],
	['anchor', 0, 1, 0.05],
	['damping', 0.1, 0.9, 0.05],
	['collide', 0, 12, 1],
];
/** Settings that change the simulated edges: the simulation restarts from where it is. */
const EDGE_SETTINGS: readonly (keyof PhysicsState)[] = ['links', 'semantic', 'semanticCentile'];

interface ExplorerState extends Record<string, unknown> {
	layout: Layout;
	colourBy: ColourBy;
	sizeBy: SizeBy;
	edges: ExplorerEdgeKind[];
	/** Seconds between two steps of the drift (0.1 to 10). */
	delay: number;
	panel: Panel;
	/** Suggestions about the selected note only. */
	aroundSelection: boolean;
	physics: PhysicsState;
}

const DEFAULT_STATE: ExplorerState = { layout: 'tsne', colourBy: 'cluster', sizeBy: 'pagerank', edges: ['link', 'embed', 'property'], delay: 1.5, panel: 'note', aroundSelection: false, physics: { ...DEFAULT_PHYSICS } };
const COLOUR_BY: readonly ColourBy[] = [...CATEGORY_BY, ...NUMBER_BY];

export class ExplorerLeafView extends ItemView {
	private state: ExplorerState = { ...DEFAULT_STATE, edges: [...DEFAULT_STATE.edges] };
	private explorer: ExplorerView | null = null;
	private toolbar: HTMLElement | null = null;
	private message: HTMLElement | null = null;
	private side: HTMLElement | null = null;
	/** The analysis of the whole vault. */
	private main: AnalysisResult | null = null;
	/** Sub-maps opened from it, the last one shown. */
	private levels: { label: string; result: AnalysisResult }[] = [];
	private crumbs: HTMLElement | null = null;
	private ids: string[] = [];
	private selected: string | null = null;
	private pendingFocus: string | null = null;
	private drift: { timer: number | null; path: { id: string; similarity: number }[] } = { timer: null, path: [] };
	private ticket = 0;
	/** Projections computed, by level and method, with the ids they were computed for. */
	private projections = new Map<string, { ids: string[]; result: AnalysisResult; projection: ProjectionResult }>();
	private quality: HTMLElement | null = null;
	private explorerOptions: Partial<ExplorerOptions> | null = null;
	private physics: PhysicsClient | null = null;
	private physicsReady: Promise<PhysicsClient> | null = null;
	private physicsUrl: string | null = null;
	/** What the running simulation was started for, and its last positions. */
	private physicsFor: { result: AnalysisResult; ids: string[] } | null = null;
	private physicsPos: { x: Float32Array; y: Float32Array } | null = null;
	private physicsAnchors: { x: Float32Array; y: Float32Array } | null = null;
	private fitOnFrame = false;
	/** Fit the camera after the next map update (a new level). */
	private fitNext = false;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SemanticAtlasPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_EXPLORER;
	}

	getDisplayText(): string {
		return this.plugin.t('explorer.title');
	}

	override getIcon(): string {
		return 'orbit';
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (typeof state === 'object' && state !== null) {
			const s = state as Partial<ExplorerState> & { focus?: unknown };
			if (LAYOUTS.includes(s.layout as Layout)) this.state.layout = s.layout as Layout;
			if (COLOUR_BY.includes(s.colourBy as ColourBy)) this.state.colourBy = s.colourBy as ColourBy;
			if (SIZE_BY.includes(s.sizeBy as SizeBy)) this.state.sizeBy = s.sizeBy as SizeBy;
			if (Array.isArray(s.edges)) this.state.edges = s.edges.filter((e): e is ExplorerEdgeKind => EDGE_KINDS.includes(e));
			if (typeof s.delay === 'number' && Number.isFinite(s.delay)) this.state.delay = Math.min(10, Math.max(0.1, s.delay));
			if (PANELS.includes(s.panel as Panel)) this.state.panel = s.panel as Panel;
			if (typeof s.aroundSelection === 'boolean') this.state.aroundSelection = s.aroundSelection;
			if (typeof s.physics === 'object' && s.physics !== null) {
				const p = { ...DEFAULT_PHYSICS };
				for (const [key, min, max] of SLIDERS) {
					const v = (s.physics as unknown as Record<string, unknown>)[key];
					if (typeof v === 'number' && Number.isFinite(v)) (p as unknown as Record<string, number>)[key] = Math.min(max, Math.max(min, v));
				}
				if (PROJECTIONS.includes(s.physics.anchorTo)) p.anchorTo = s.physics.anchorTo;
				if (typeof s.physics.halo === 'boolean') p.halo = s.physics.halo;
				this.state.physics = p;
			}
			if (typeof s.focus === 'string') this.pendingFocus = s.focus;
		}
		await super.setState(state, result);
		this.render(true);
	}

	/** Selects a note and centres the map on it (command "Open in the explorer"). */
	focusNote(id: string): void {
		this.pendingFocus = id;
		this.applyFocus();
	}

	override async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('semantic-atlas-explorer');
		this.toolbar = contentEl.createDiv({ cls: 'semantic-atlas-toolbar' });
		this.message = contentEl.createEl('p', { cls: 'semantic-atlas-message', attr: { 'aria-live': 'polite' } });
		this.quality = contentEl.createEl('p', { cls: 'semantic-atlas-message semantic-atlas-map-quality' });
		this.crumbs = contentEl.createEl('nav', { cls: 'semantic-atlas-crumbs', attr: { 'aria-label': this.plugin.t('explorer.submap.crumbs') } });
		this.crumbs.hide();
		const main = contentEl.createDiv({ cls: 'semantic-atlas-explorer-main' });
		const host = main.createDiv({ cls: 'semantic-atlas-explorer-map' });
		this.side = main.createDiv({ cls: 'semantic-atlas-explorer-side' });
		const t = this.plugin.t;
		this.explorerOptions = {
			neighbourHighlight: true,
			onAreaOpen: (index) => {
				const cluster = this.current()?.clusters[index];
				if (cluster) void this.openSubmapOf(cluster.members, cluster.name);
			},
			labels: {
				canvas: t('explorer.canvas'),
				legend: t('explorer.legend'),
				shown: (shown, total) => t('map.shown', { shown, total }),
				selected: (label) => t('map.selected', { label }),
			},
			onSelect: (id) => {
				this.selected = id;
				this.renderSide();
			},
			onOpen: (id) => {
				this.openNote(id);
			},
		};
		this.explorer = new ExplorerView(host, this.explorerOptions);
		this.updateDragging();
		this.register(this.plugin.analysis.onChange(() => this.render(false)));
		// The simulation stops when the view is hidden.
		const doc = this.containerEl.doc;
		const hide = (): void => {
			if (!this.containerEl.isShown() || doc.hidden) this.physics?.freeze();
		};
		this.registerEvent(this.app.workspace.on('layout-change', hide));
		this.registerEvent(this.app.workspace.on('active-leaf-change', hide));
		this.registerDomEvent(doc, 'visibilitychange', hide);
		this.registerEvent(this.app.workspace.on('css-change', () => this.explorer?.refreshTheme()));
		this.render(true);
		await Promise.resolve();
	}

	override onResize(): void {
		this.explorer?.notifyResize();
	}

	override async onClose(): Promise<void> {
		this.stopDrift();
		this.physics?.terminate();
		this.physics = null;
		this.physicsReady = null;
		if (this.physicsUrl) URL.revokeObjectURL(this.physicsUrl);
		this.physicsUrl = null;
		this.explorer?.dispose();
		this.explorer = null;
		await Promise.resolve();
	}

	private t(key: MessageKey, vars?: Record<string, string | number>): string {
		return this.plugin.t(key, vars);
	}

	private label(id: string): string {
		return this.app.vault.getFileByPath(id)?.basename ?? id;
	}

	private openNote(id: string, newLeaf = false): void {
		const file = this.app.vault.getFileByPath(id);
		if (file instanceof TFile) void this.app.workspace.getLeaf(newLeaf).openFile(file);
	}

	private noteLink(parent: HTMLElement, id: string): HTMLElement {
		const a = parent.createEl('a', { cls: 'internal-link', text: this.label(id), href: '#' });
		a.addEventListener('click', (event) => {
			event.preventDefault();
			if (event.ctrlKey || event.metaKey) this.openNote(id, true);
			else this.selectNote(id);
		});
		a.addEventListener('dblclick', (event) => {
			event.preventDefault();
			this.openNote(id);
		});
		return a;
	}

	private selectNote(id: string): void {
		this.selected = id;
		this.explorer?.select(id, { centre: true });
		this.renderSide();
	}

	private save(): void {
		this.app.workspace.requestSaveLayout();
	}

	/** The result shown: the last sub-map, or the whole vault. */
	private current(): AnalysisResult | null {
		return this.levels[this.levels.length - 1]?.result ?? this.main;
	}

	// ---- sub-maps ---------------------------------------------------------------------------

	private async openSubmap(kind: SubmapKind): Promise<void> {
		const result = this.current();
		if (!result) return;
		const label = kind === 'path' ? this.t('explorer.submap.pathLabel') : this.t('explorer.submap.shownLabel');
		const subset = subsetFor(kind, {
			selected: this.selected,
			result,
			facts: this.plugin.analysis.facts(),
			shown: this.explorer?.visibleIds() ?? [],
			path: this.drift.path.map((p) => p.id),
			label,
		});
		if ('error' in subset) {
			new Notice(
				subset.error === 'noSelection'
					? this.t('explorer.submap.noSelection')
					: this.t(subset.error === 'tooFew' ? 'explorer.submap.tooFew' : 'explorer.submap.tooMany', { count: subset.count ?? 0, min: SUBMAP_MIN, max: SUBMAP_MAX }),
			);
			return;
		}
		await this.openSubmapOf(subset.ids, subset.label);
	}

	/** Opens the sub-map of the given notes. */
	private async openSubmapOf(ids: readonly string[], label: string): Promise<void> {
		if (ids.length < SUBMAP_MIN || ids.length > SUBMAP_MAX) {
			new Notice(this.t(ids.length < SUBMAP_MIN ? 'explorer.submap.tooFew' : 'explorer.submap.tooMany', { count: ids.length, min: SUBMAP_MIN, max: SUBMAP_MAX }));
			return;
		}
		const notice = new Notice(this.t('explorer.submap.computing', { count: ids.length }), 0);
		try {
			const sub = await this.plugin.analysis.analyseSubset(ids);
			if (sub.skipped) {
				new Notice(this.t('explorer.submap.tooFew', { count: ids.length, min: SUBMAP_MIN, max: SUBMAP_MAX }));
				return;
			}
			this.stopDrift(false);
			this.drift.path = [];
			this.levels.push({ label, result: sub });
			if (this.selected && !sub.notes.has(this.selected)) this.selected = null;
			this.renderLevel();
		} catch (error) {
			new Notice(this.t('landscape.error', { message: error instanceof Error ? error.message : String(error) }));
		} finally {
			notice.hide();
		}
	}

	/** Goes back to level `depth` (0: the whole vault). */
	private goToLevel(depth: number): void {
		this.stopDrift(false);
		this.drift.path = [];
		this.levels = this.levels.slice(0, depth);
		this.renderLevel();
	}

	private renderLevel(): void {
		this.renderCrumbs();
		this.renderToolbar(this.current() !== null);
		this.fitNext = true;
		this.renderMap();
		this.renderSide();
	}

	private renderCrumbs(): void {
		const el = this.crumbs;
		if (!el) return;
		el.empty();
		el.toggle(this.levels.length > 0);
		if (this.levels.length === 0) return;
		const names = [this.t('explorer.submap.vault'), ...this.levels.map((l) => l.label)];
		names.forEach((name, depth) => {
			if (depth > 0) el.createSpan({ text: ' › ', attr: { 'aria-hidden': 'true' } });
			if (depth === names.length - 1) {
				el.createSpan({ text: name, attr: { 'aria-current': 'page' } });
			} else {
				const b = el.createEl('button', { text: name, cls: 'semantic-atlas-crumb' });
				b.addEventListener('click', () => {
					this.goToLevel(depth);
				});
			}
		});
	}

	// ---- rendering --------------------------------------------------------------------------

	private render(full: boolean): void {
		const result = this.plugin.analysis.result();
		const usable = result && !result.skipped ? result : null;
		this.renderMessage(usable);
		this.renderToolbar(usable !== null);
		if (full || usable !== this.main) {
			this.main = usable;
			this.renderMap();
		}
		this.renderSide();
		this.applyFocus();
	}

	private renderMessage(result: AnalysisResult | null): void {
		const el = this.message;
		if (!el) return;
		el.empty();
		const a = this.plugin.analysis.getState();
		if (!this.plugin.index.isReady() && !result) {
			el.setText(this.t('landscape.notReady'));
			const b = el.createEl('button', { text: this.t('related.setUpButton'), cls: 'mod-cta' });
			b.addEventListener('click', () => void this.plugin.setUpIndex());
		} else if (a.phase === 'running') el.setText(this.t('landscape.running'));
		else if (!result && a.phase === 'waiting') el.setText(this.t('landscape.waiting'));
		else if (a.phase === 'error') el.setText(this.t('landscape.error', { message: a.message }));
		else if (this.plugin.analysis.result()?.skipped) el.setText(this.t('landscape.tooFew'));
		el.toggle(el.textContent !== '');
	}

	private renderToolbar(enabled: boolean): void {
		const bar = this.toolbar;
		if (!bar) return;
		bar.empty();
		if (!enabled) return;
		const select = <T extends string>(label: string, value: T, options: readonly T[], text: (o: T) => string, onChange: (v: T) => void): void => {
			const l = bar.createEl('label');
			l.appendText(`${label} `);
			const s = l.createEl('select', { cls: 'dropdown' });
			for (const o of options) s.createEl('option', { value: o, text: text(o) });
			s.value = value;
			s.addEventListener('change', () => {
				onChange(s.value as T);
			});
		};
		select(this.t('explorer.layout'), this.state.layout, LAYOUTS, (o) => this.t(`explorer.layout.${o}`), (v) => {
			this.state.layout = v;
			this.save();
			void this.changeLayout();
		});
		const hasAxes = this.plugin.settings.analysis.axes.length > 0;
		select(
			this.t('explorer.colourBy'),
			this.state.colourBy,
			COLOUR_BY.filter((c) => c !== 'relevance' || hasAxes),
			(o) => this.t(`explorer.by.${o}`),
			(v) => {
				this.state.colourBy = v;
				this.save();
				this.renderMap();
			},
		);
		select(this.t('explorer.sizeBy'), this.state.sizeBy, SIZE_BY, (o) => this.t(`explorer.size.${o}`), (v) => {
			this.state.sizeBy = v;
			this.save();
			this.renderMap();
		});
		const filter = bar.createEl('input', { type: 'search', attr: { placeholder: this.t('landscape.filter'), 'aria-label': this.t('landscape.filterLabel') } });
		filter.addEventListener('input', () => this.explorer?.setFilter(filter.value));
		const sub = bar.createEl('button', { text: this.t('explorer.submap.button') });
		sub.addEventListener('click', (event) => {
			const menu = new Menu();
			for (const kind of SUBMAP_KINDS) {
				menu.addItem((item) =>
					item.setTitle(this.t(`explorer.submap.${kind}`)).onClick(() => {
						void this.openSubmap(kind);
					}),
				);
			}
			menu.showAtMouseEvent(event);
		});
		const fit = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': this.t('explorer.fit') } });
		setIcon(fit, 'maximize');
		fit.addEventListener('click', () => this.explorer?.fitAll());

		const edges = bar.createDiv({ cls: 'semantic-atlas-explorer-edges', attr: { role: 'group', 'aria-label': this.t('explorer.edges') } });
		for (const kind of EDGE_KINDS) {
			const l = edges.createEl('label');
			const box = l.createEl('input', { type: 'checkbox' });
			box.checked = this.state.edges.includes(kind);
			l.appendText(this.t(`explorer.edge.${kind}`));
			box.addEventListener('change', () => {
				this.state.edges = EDGE_KINDS.filter((k) => (k === kind ? box.checked : this.state.edges.includes(k)));
				this.explorer?.setEdgeKinds(this.state.edges);
				this.save();
			});
		}

		const drift = bar.createDiv({ cls: 'semantic-atlas-explorer-drift' });
		const go = drift.createEl('button', { text: this.t(this.drift.timer !== null ? 'explorer.driftStop' : 'explorer.driftStart') });
		go.addEventListener('click', () => {
			if (this.drift.timer !== null) this.stopDrift();
			else this.startDrift();
			this.renderToolbar(true);
		});
		const l = drift.createEl('label');
		l.appendText(`${this.t('explorer.delay')} `);
		// Logarithmic slider: 0.1 s to 10 s.
		const range = l.createEl('input', { type: 'range', attr: { min: '0', max: '100', step: '1' } });
		range.value = String(Math.round(50 * Math.log10(this.state.delay * 10)));
		const shown = l.createSpan({ text: this.t('explorer.seconds', { seconds: this.state.delay.toFixed(1) }) });
		range.addEventListener('input', () => {
			this.state.delay = Math.min(10, Math.max(0.1, 0.1 * 10 ** (Number(range.value) / 50)));
			shown.setText(this.t('explorer.seconds', { seconds: this.state.delay.toFixed(1) }));
			this.save();
			if (this.drift.timer !== null) {
				this.stopDrift(false);
				this.scheduleDrift();
			}
		});
	}

	/** Builds the map from the analysis and the chosen variables. */
	private renderMap(): void {
		const explorer = this.explorer;
		const result = this.current();
		if (!explorer) return;
		if (!result) {
			explorer.setData({ nodes: [], edges: [], legend: { type: 'categories', entries: [] } });
			return;
		}
		const ticket = ++this.ticket;
		const ids = [...result.notes.keys()];
		this.ids = ids;
		const ctx = this.context(result);
		void Promise.all([this.relevance(), this.positions(result, ids)]).then(([relevance, pos]) => {
			if (ticket !== this.ticket) return;
			const full: VariableContext = relevance ? { ...ctx, relevance } : ctx;
			const { colours, legend } = this.encode(ids, full);
			const size = sizes(sizeValues(this.state.sizeBy, ids, full), ids.length);
			const index = new Map(ids.map((id, i) => [id, i]));
			const edges: ExplorerEdge[] = [];
			const relations = collectRelations(
				readNotes(this.app).filter((n) => index.has(n.path)),
				linkResolver(this.app),
			);
			const seen = new Set<string>();
			for (const e of relations.edges) {
				if (e.kind === 'unresolved') continue;
				const a = index.get(e.from);
				const b = index.get(e.to);
				if (a === undefined || b === undefined || a === b) continue;
				const key = `${Math.min(a, b)}|${Math.max(a, b)}|${e.kind}`;
				if (seen.has(key)) continue;
				seen.add(key);
				edges.push({ a, b, kind: e.kind });
			}
			for (const s of result.suggestions.items.slice(0, 100)) {
				const a = index.get(s.a);
				const b = index.get(s.b);
				if (a !== undefined && b !== undefined) edges.push({ a, b, kind: 'suggested' });
			}
			explorer.setData({
				nodes: ids.map((id, i) => {
					const n = result.notes.get(id)!;
					return { id, label: this.label(id), x: pos ? pos.x[i]! : n.x, y: pos ? pos.y[i]! : n.y, colour: colours[i]!, size: size[i]! };
				}),
				edges,
				legend,
				areas:
					this.state.colourBy === 'cluster'
						? result.clusters.map((c) => ({ name: c.name, colour: colourOf(c.id), members: c.members.map((m) => index.get(m)).filter((i): i is number => i !== undefined) }))
						: [],
			});
			explorer.setEdgeKinds(this.state.edges);
			explorer.setHalo(this.state.layout === 'physics' && this.state.physics.halo);
			explorer.setPath(this.drift.path.map((p) => p.id));
			if (this.fitNext) {
				this.fitNext = false;
				explorer.fitAll();
			}
			this.applyFocus();
		});
	}

	/** Key of the current level, for the projections cache. */
	private levelKey(method: ProjectionMethod): string {
		return `${this.levels.map((l) => l.label).join('\u0000')}|${method}`;
	}

	/**
	 * Positions of the notes for the chosen layout: the landscape's, or a projection computed
	 * once per level and analysis, warm-started from the previous one of the same level.
	 */
	private async positions(result: AnalysisResult, ids: string[]): Promise<{ x: Float32Array; y: Float32Array } | null> {
		const layout = this.state.layout;
		if (layout === 'landscape') {
			this.showQuality(null);
			return null;
		}
		if (layout === 'physics') return this.physicsPositions(result, ids);
		return this.projectionFor(result, ids, layout, true);
	}

	private async projectionFor(result: AnalysisResult, ids: string[], layout: ProjectionMethod, show: boolean): Promise<ProjectionResult | null> {
		if (!show) this.showQuality(null);
		const key = this.levelKey(layout);
		const cached = this.projections.get(key);
		if (cached?.result === result && cached.ids.length === ids.length && cached.ids.every((id, i) => id === ids[i])) {
			if (show) this.showQuality(cached.projection);
			return cached.projection;
		}
		const previous = cached ? new Map(cached.ids.map((id, i) => [id, [cached.projection.x[i]!, cached.projection.y[i]!] as [number, number]])) : undefined;
		this.showQuality(null, true, layout);
		try {
			const projection = await this.plugin.analysis.project(ids, layout, previous);
			if (projection.skipped) {
				this.showQuality(null);
				return null;
			}
			this.projections.set(key, { ids, result, projection });
			if (show) this.showQuality(projection);
			return projection;
		} catch (error) {
			this.plugin.log.error(`projection: ${error instanceof Error ? error.message : String(error)}`);
			this.showQuality(null);
			return null;
		}
	}

	/** Moves the notes to the chosen layout, animated. */
	private async changeLayout(): Promise<void> {
		const result = this.current();
		this.updateDragging();
		if (this.state.layout !== 'physics') this.stopPhysics();
		if (this.state.layout === 'physics' || this.state.panel === 'forces') {
			if (this.state.layout !== 'physics') this.state.panel = 'note';
			this.renderSide();
		}
		this.explorer?.setHalo(this.state.layout === 'physics' && this.state.physics.halo);
		if (!result || !this.explorer) return;
		const ids = this.ids;
		const pos = await this.positions(result, ids);
		if (this.current() !== result || this.ids !== ids) return;
		const x = pos ? pos.x : Float32Array.from(ids, (id) => result.notes.get(id)!.x);
		const y = pos ? pos.y : Float32Array.from(ids, (id) => result.notes.get(id)!.y);
		this.explorer.setPositions(x, y);
		this.explorer.fitAll();
	}

	// ---- free physics -----------------------------------------------------------------------

	/** Dragging notes moves them only in the free physics (the view reads the option each time). */
	private updateDragging(): void {
		const options = this.explorerOptions;
		if (!options) return;
		if (this.state.layout === 'physics') {
			options.onNodeDrag = (i, x, y, phase, pin) => {
				if (!this.physics) return;
				if (phase === 'end' && !pin) this.physics.unpin(i);
				else this.physics.pin(i, x, y);
			};
		} else delete options.onNodeDrag;
	}

	private client(): Promise<PhysicsClient> {
		this.physicsReady ??= (async () => {
			this.physicsUrl = URL.createObjectURL(new Blob([physicsWorkerCode], { type: 'text/javascript' }));
			const client = new PhysicsClient(new Worker(this.physicsUrl));
			client.onFrame((frame) => {
				if (this.state.layout !== 'physics' || !this.physicsFor || frame.x.length !== this.ids.length) return;
				this.physicsPos = { x: frame.x, y: frame.y };
				this.explorer?.setLivePositions(frame.x, frame.y);
				if (this.fitOnFrame) {
					this.fitOnFrame = false;
					this.explorer?.fitAll();
				}
			});
			client.onError((message) => {
				this.plugin.log.error(`physics: ${message}`);
			});
			await client.init(engineWasm.slice());
			this.physics = client;
			return client;
		})();
		return this.physicsReady;
	}

	/** Projection positions scaled to the physics (about `linkDistance × √n × 1.5` wide), centred. */
	private scaled(p: { x: Float32Array; y: Float32Array }): { x: Float32Array; y: Float32Array } {
		const n = p.x.length;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < n; i++) {
			minX = Math.min(minX, p.x[i]!);
			maxX = Math.max(maxX, p.x[i]!);
			minY = Math.min(minY, p.y[i]!);
			maxY = Math.max(maxY, p.y[i]!);
		}
		const span = Math.max(maxX - minX, maxY - minY, 1e-6);
		const k = (this.state.physics.linkDistance * Math.sqrt(n) * 1.5) / span;
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		return { x: Float32Array.from(p.x, (v) => (v - cx) * k), y: Float32Array.from(p.y, (v) => (v - cy) * k) };
	}

	private async physicsPositions(result: AnalysisResult, ids: string[]): Promise<{ x: Float32Array; y: Float32Array } | null> {
		const same = this.physicsFor?.result === result && this.physicsFor.ids.length === ids.length && this.physicsFor.ids.every((id, i) => id === ids[i]);
		if (same && this.physicsPos) {
			this.showQuality(null);
			return this.physicsPos;
		}
		const projection = await this.projectionFor(result, ids, this.state.physics.anchorTo, false);
		const base = projection ?? { x: Float32Array.from(ids, (id) => result.notes.get(id)!.x), y: Float32Array.from(ids, (id) => result.notes.get(id)!.y) };
		const anchors = this.scaled(base);
		// Notes already simulated keep their place; new ones start at their anchor.
		const start = { x: Float32Array.from(anchors.x), y: Float32Array.from(anchors.y) };
		if (this.physicsFor && this.physicsPos) {
			const at = new Map(this.physicsFor.ids.map((id, i) => [id, i]));
			ids.forEach((id, i) => {
				const j = at.get(id);
				if (j !== undefined) {
					start.x[i] = this.physicsPos!.x[j]!;
					start.y[i] = this.physicsPos!.y[j]!;
				}
			});
		}
		this.showQuality(null);
		await this.startPhysics(result, ids, anchors, start);
		return start;
	}

	private async startPhysics(result: AnalysisResult, ids: string[], anchors: { x: Float32Array; y: Float32Array }, start: { x: Float32Array; y: Float32Array }): Promise<void> {
		const client = await this.client();
		const p = this.state.physics;
		const index = new Map(ids.map((id, i) => [id, i]));
		const pairs: [number, number][] = [];
		for (const e of collectRelations(readNotes(this.app).filter((nt) => index.has(nt.path)), linkResolver(this.app)).edges) {
			if (e.kind === 'unresolved') continue;
			const a = index.get(e.from);
			const b = index.get(e.to);
			if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
		}
		const groupOf = new Map(result.clusters.map((c, g) => [c.id, g]));
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		this.physicsFor = { result, ids };
		this.physicsAnchors = anchors;
		this.physicsPos = start;
		this.fitOnFrame = true;
		client.start({
			n: ids.length,
			edges: physicsEdges(ids.length, pairs, result.knn, { links: p.links, semantic: p.semantic, minSimilarity: similarityAtCentile(result.knn, p.semanticCentile) }),
			groups: Uint32Array.from(ids, (id) => groupOf.get(result.notes.get(id)!.cluster) ?? 0),
			anchors,
			positions: start,
			params: { center: p.centre, charge: -p.repulsion, linkDistance: p.linkDistance, velocityDecay: p.damping },
			forces: { cohesion: p.cohesion, anchor: p.anchor, collide: p.collide },
			seed: 1,
			frames: !reduced,
		});
	}

	private stopPhysics(): void {
		this.physics?.stop();
		this.physicsFor = null;
		this.physicsPos = null;
		this.physicsAnchors = null;
	}

	/** Applies a change of the forces panel. */
	private async applyPhysics(key: keyof PhysicsState): Promise<void> {
		const p = this.state.physics;
		const client = this.physics;
		const result = this.current();
		this.save();
		if (!client || !result || !this.physicsFor) return;
		if (key === 'halo') this.explorer?.setHalo(p.halo);
		else if (key === 'anchorTo') {
			const projection = await this.projectionFor(result, this.ids, p.anchorTo, false);
			if (projection) {
				this.physicsAnchors = this.scaled(projection);
				client.setAnchors(this.physicsAnchors.x, this.physicsAnchors.y);
			}
			this.showQuality(null);
		} else if (key === 'linkDistance') {
			// The anchors are scaled on the link distance.
			const projection = await this.projectionFor(result, this.ids, p.anchorTo, false);
			if (projection) {
				this.physicsAnchors = this.scaled(projection);
				client.setAnchors(this.physicsAnchors.x, this.physicsAnchors.y);
			}
			client.setParams({ linkDistance: p.linkDistance });
		} else if (EDGE_SETTINGS.includes(key)) {
			await this.startPhysics(result, this.ids, this.physicsAnchors ?? this.physicsPos!, this.physicsPos!);
			this.fitOnFrame = false;
		} else if (key === 'cohesion' || key === 'anchor' || key === 'collide') client.setForces({ [key]: p[key] });
		else if (key === 'centre') client.setParams({ center: p.centre });
		else if (key === 'repulsion') client.setParams({ charge: -p.repulsion });
		else if (key === 'damping') client.setParams({ velocityDecay: p.damping });
	}

	private renderForces(el: HTMLElement): void {
		const p = this.state.physics;
		el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('forces.hint') });
		const anchor = el.createEl('label', { cls: 'semantic-atlas-force' });
		anchor.createSpan({ text: this.t('forces.anchorTo') });
		const select = anchor.createEl('select', { cls: 'dropdown' });
		for (const m of PROJECTIONS) select.createEl('option', { value: m, text: this.t(`explorer.layout.${m}`) });
		select.value = p.anchorTo;
		select.addEventListener('change', () => {
			if (!PROJECTIONS.includes(select.value as ProjectionMethod)) return;
			p.anchorTo = select.value as ProjectionMethod;
			void this.applyPhysics('anchorTo');
		});
		for (const [key, min, max, step] of SLIDERS) {
			const row = el.createEl('label', { cls: 'semantic-atlas-force' });
			row.createSpan({ text: this.t(`forces.${key as Exclude<keyof PhysicsState, 'anchorTo' | 'halo'>}`) });
			const range = row.createEl('input', { type: 'range', attr: { min: String(min), max: String(max), step: String(step) } });
			range.value = String(p[key]);
			const value = row.createSpan({ cls: 'semantic-atlas-force-value', text: String(p[key]) });
			range.addEventListener('input', () => {
				(p as unknown as Record<string, number>)[key] = Number(range.value);
				value.setText(range.value);
				if (!EDGE_SETTINGS.includes(key)) void this.applyPhysics(key);
			});
			// Edges are rebuilt once the slider is released.
			if (EDGE_SETTINGS.includes(key)) range.addEventListener('change', () => void this.applyPhysics(key));
		}
		const halo = el.createEl('label', { cls: 'semantic-atlas-toggle' });
		const box = halo.createEl('input', { type: 'checkbox' });
		box.checked = p.halo;
		halo.appendText(this.t('forces.halo'));
		box.addEventListener('change', () => {
			p.halo = box.checked;
			void this.applyPhysics('halo');
		});
		const actions = el.createDiv({ cls: 'semantic-atlas-actions' });
		const reheat = actions.createEl('button', { text: this.t('forces.reheat') });
		reheat.addEventListener('click', () => this.physics?.reheat(1));
		const freeze = actions.createEl('button', { text: this.t('forces.freeze') });
		freeze.addEventListener('click', () => this.physics?.freeze());
		const reset = actions.createEl('button', { text: this.t('forces.reset') });
		reset.addEventListener('click', () => {
			this.state.physics = { ...DEFAULT_PHYSICS, anchorTo: p.anchorTo };
			this.save();
			const result = this.current();
			if (result && this.physicsAnchors) void this.startPhysics(result, this.ids, this.physicsAnchors, this.physicsAnchors);
			this.explorer?.setHalo(this.state.physics.halo);
			this.renderSide();
		});
		el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('forces.dragHint') });
	}

	private showQuality(p: ProjectionResult | null, computing = false, method: Layout = this.state.layout): void {
		const el = this.quality;
		if (!el) return;
		el.empty();
		if (computing) el.setText(this.t('explorer.projecting', { method: this.t(`explorer.layout.${method}`) }));
		else if (this.state.layout === 'physics' && !p) el.setText(this.t('explorer.physicsLine', { method: this.t(`explorer.layout.${this.state.physics.anchorTo}`) }));
		else if (p) {
			const fmt = (x: number): string => x.toFixed(2);
			el.setText(
				this.t('explorer.quality', {
					method: this.t(`explorer.layout.${p.method}`),
					trust: fmt(p.quality.trustworthiness),
					continuity: fmt(p.quality.continuity),
					kept: Math.round(p.quality.knnPreservation * 100),
				}),
			);
			el.createSpan({ text: ` ${this.t(p.method === 'pacmap' ? 'explorer.readingPacmap' : 'explorer.reading')}` });
		}
		el.toggle(el.textContent !== '');
	}

	private context(result: AnalysisResult): VariableContext {
		return { result, facts: this.plugin.analysis.facts(), now: Date.now() };
	}

	/** Relevance centile on the interest axes, when the colour needs it. */
	private async relevance(): Promise<Map<string, number> | undefined> {
		if (this.state.colourBy !== 'relevance' || this.plugin.settings.analysis.axes.length === 0) return undefined;
		try {
			return await this.plugin.analysis.relevance();
		} catch {
			return undefined;
		}
	}

	private encode(ids: string[], ctx: VariableContext): { colours: string[]; legend: ExplorerLegend } {
		const by = this.state.colourBy;
		const missingLabel = this.t('explorer.missing');
		if (isCategory(by)) {
			const raw = categoryValues(by, ids, ctx);
			const roleLabel = (r: string): string => this.t(`role.${r as 'core' | 'connector' | 'peripheral'}`);
			const values = by === 'role' ? raw.map((r) => (r ? roleLabel(r) : null)) : raw;
			const clusterIds = new Map(ctx.result.clusters.map((c) => [c.name, c.id]));
			const enc = categoricalColours(values, {
				otherLabel: this.t('explorer.other'),
				missingLabel,
				...(by === 'cluster' ? { max: 1000, colourOf: (name: string) => colourOf(clusterIds.get(name) ?? 0) } : {}),
			});
			return { colours: enc.colours, legend: { type: 'categories', entries: enc.legend } };
		}
		const values = numericValues(by, ids, ctx);
		const enc = numericColours(values);
		const fmt = (x: number): string =>
			Number.isNaN(x) ? '–' : by === 'date' ? new Date(x).toLocaleDateString() : by === 'isolation' || by === 'relevance' ? String(Math.round(x)) : x.toLocaleString(undefined, { maximumFractionDigits: 3 });
		return {
			colours: enc.colours,
			legend: {
				type: 'scale',
				colours: SEQUENTIAL,
				minLabel: fmt(enc.min),
				maxLabel: fmt(enc.max),
				...(enc.missing > 0 ? { missing: { label: this.t('explorer.missingCount', { count: enc.missing }), colour: MISSING_COLOUR } } : {}),
			},
		};
	}

	private applyFocus(): void {
		const id = this.pendingFocus;
		if (!id || !this.explorer || !this.current()?.notes.has(id) || !this.ids.includes(id)) return;
		this.pendingFocus = null;
		this.selectNote(id);
	}

	// ---- drift ------------------------------------------------------------------------------

	private startDrift(): void {
		const result = this.current();
		if (!result || this.ids.length === 0) return;
		const start = this.selected && result.notes.has(this.selected) ? this.selected : this.ids[Math.floor(Math.random() * this.ids.length)]!;
		this.drift.path = [{ id: start, similarity: 1 }];
		this.explorer?.setPath([start]);
		this.explorer?.follow(start);
		this.selected = start;
		this.state.panel = 'note';
		this.renderSide();
		this.scheduleDrift();
	}

	private scheduleDrift(): void {
		this.drift.timer = window.setTimeout(() => {
			this.stepDrift();
		}, this.state.delay * 1000);
	}

	private stepDrift(): void {
		this.drift.timer = null;
		const result = this.current();
		if (!result) return;
		const index = new Map(this.ids.map((id, i) => [id, i]));
		const visited = new Set(this.drift.path.map((p) => index.get(p.id)!));
		const current = index.get(this.drift.path[this.drift.path.length - 1]!.id)!;
		const step = driftStep(current, result.knn, visited);
		if (!step) {
			this.renderToolbar(true);
			return;
		}
		const id = this.ids[step.next]!;
		this.drift.path.push({ id, similarity: step.similarity });
		this.explorer?.setPath(this.drift.path.map((p) => p.id));
		this.explorer?.follow(id);
		this.selected = id;
		this.renderSide();
		this.scheduleDrift();
	}

	private stopDrift(rerender = true): void {
		if (this.drift.timer !== null) window.clearTimeout(this.drift.timer);
		this.drift.timer = null;
		if (rerender) this.renderSide();
	}

	private async copyPath(): Promise<void> {
		const links = this.drift.path
			.map((p) => this.app.vault.getFileByPath(p.id))
			.filter((f): f is TFile => f instanceof TFile)
			.map((f) => `- ${this.app.fileManager.generateMarkdownLink(f, '')}`);
		await navigator.clipboard.writeText(links.join('\n'));
		new Notice(this.t('related.copied', { count: links.length }));
	}

	// ---- side panel -------------------------------------------------------------------------

	private renderSide(): void {
		const side = this.side;
		if (!side) return;
		const scroll = side.scrollTop;
		side.empty();
		const result = this.current();
		if (!result) return;
		const tabs = side.createDiv({ cls: 'semantic-atlas-tabs', attr: { role: 'tablist' } });
		if (this.state.panel === 'forces' && this.state.layout !== 'physics') this.state.panel = 'note';
		for (const p of PANELS) {
			if (p === 'forces' && this.state.layout !== 'physics') continue;
			const b = tabs.createEl('button', { text: this.t(`explorer.panel.${p}`), attr: { role: 'tab', 'aria-selected': String(p === this.state.panel) } });
			b.toggleClass('is-active', p === this.state.panel);
			b.addEventListener('click', () => {
				this.state.panel = p;
				this.save();
				this.renderSide();
			});
		}
		const body = side.createDiv({ attr: { role: 'tabpanel' } });
		if (this.state.panel === 'note') this.renderCard(body, result);
		else if (this.state.panel === 'forces') this.renderForces(body);
		else this.renderSuggestions(body, result);
		if (this.drift.path.length > 0) this.renderDrift(side);
		side.scrollTop = scroll;
	}

	private renderCard(el: HTMLElement, result: AnalysisResult): void {
		const id = this.selected;
		const n = id ? result.notes.get(id) : undefined;
		if (!id || !n) {
			el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('explorer.noSelection') });
			return;
		}
		const head = el.createEl('h3');
		const a = head.createEl('a', { cls: 'internal-link', text: this.label(id), href: '#' });
		a.addEventListener('click', (e) => {
			e.preventDefault();
			this.openNote(id, e.ctrlKey || e.metaKey);
		});
		const excerpt = this.plugin.analysis.excerpt(id);
		if (excerpt) el.createEl('p', { cls: 'semantic-atlas-excerpt', text: excerpt });
		const cluster = result.clusters.find((c) => c.id === n.cluster);
		const facts = el.createEl('ul', { cls: 'semantic-atlas-facts' });
		if (cluster) facts.createEl('li', { text: this.t('explorer.cluster', { name: cluster.name }) });
		facts.createEl('li', { text: this.t('explorer.role', { role: this.t(`role.${n.role}`) }) });
		facts.createEl('li', { text: this.t('explorer.isolation', { centile: Math.round(n.isolationCentile) }) });

		el.createEl('p', { cls: 'semantic-atlas-label', text: this.t('explorer.neighbours') });
		const order = [...result.notes.keys()];
		const i = order.indexOf(id);
		const { k, neighbours, similarities } = result.knn;
		const ul = el.createEl('ul');
		for (let r = 0; r < Math.min(k, 6); r++) {
			const j = neighbours[i * k + r];
			if (j === undefined) continue;
			const li = ul.createEl('li');
			this.noteLink(li, order[j]!);
			li.appendText(` (${similarities[i * k + r]!.toFixed(2)})`);
		}
		const resolved = this.app.metadataCache.resolvedLinks;
		const out = Object.keys(resolved[id] ?? {}).filter((x) => x !== id && result.notes.has(x));
		const inc = Object.entries(resolved)
			.filter(([src, targets]) => src !== id && id in targets && result.notes.has(src))
			.map(([src]) => src);
		el.createEl('p', { cls: 'semantic-atlas-label', text: this.t('explorer.links', { out: out.length, in: inc.length }) });
		const links = el.createEl('ul');
		for (const x of [...new Set([...out, ...inc])].slice(0, 12)) this.noteLink(links.createEl('li'), x);
		const sub = el.createEl('button', { text: this.t('explorer.suggestionsHere') });
		sub.addEventListener('click', () => {
			this.state.panel = 'suggestions';
			this.state.aroundSelection = true;
			this.save();
			this.renderSide();
		});
	}

	private renderSuggestions(el: HTMLElement, result: AnalysisResult): void {
		const { evaluation, items } = result.suggestions;
		const fmt = (x: number): string => x.toFixed(2);
		const summary =
			evaluation.status === 'insufficient'
				? this.t('suggest.insufficient', { links: evaluation.links })
				: evaluation.kept
					? this.t('suggest.kept', { links: evaluation.positives, combined: fmt(evaluation.combined.auc), cosine: fmt(evaluation.cosine.auc) })
					: this.t('suggest.notKept', { links: evaluation.positives, combined: fmt(evaluation.combined.auc), cosine: fmt(evaluation.cosine.auc) });
		el.createEl('p', { cls: 'semantic-atlas-message', text: summary });
		el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('suggest.hint') });
		const around = el.createEl('label', { cls: 'semantic-atlas-toggle' });
		const box = around.createEl('input', { type: 'checkbox' });
		box.checked = this.state.aroundSelection;
		box.disabled = !this.selected;
		around.appendText(this.t('suggest.around'));
		box.addEventListener('change', () => {
			this.state.aroundSelection = box.checked;
			this.save();
			this.renderSide();
		});
		const list = this.state.aroundSelection && this.selected ? items.filter((s) => s.a === this.selected || s.b === this.selected) : items;
		if (list.length === 0) {
			el.createEl('p', { text: this.t('suggest.none') });
			return;
		}
		for (const s of list.slice(0, SUGGESTIONS_SHOWN)) this.renderSuggestion(el, s);
	}

	private renderSuggestion(parent: HTMLElement, s: Suggestion): void {
		const card = parent.createDiv({ cls: 'semantic-atlas-suggestion' });
		const head = card.createDiv({ cls: 'semantic-atlas-suggestion-head' });
		this.noteLink(head, s.a);
		head.appendText(' ↔ ');
		this.noteLink(head, s.b);
		const facts = card.createEl('p', { cls: 'semantic-atlas-message' });
		facts.appendText(this.t('suggest.similarity', { value: s.cosine.toFixed(2) }));
		if (s.twoHop) facts.appendText(` · ${this.t('suggest.twoHop')}`);
		const words = this.plugin.analysis.sharedWords(s.a, s.b);
		const reasons = card.createEl('ul', { cls: 'semantic-atlas-reasons' });
		if (words.length > 0) reasons.createEl('li', { text: this.t('suggest.words', { words: words.join(', ') }) });
		if (s.commonNeighbours.length > 0) {
			const li = reasons.createEl('li');
			li.appendText(`${this.t('suggest.common')} `);
			s.commonNeighbours.slice(0, 4).forEach((id, i) => {
				if (i > 0) li.appendText(', ');
				this.noteLink(li, id);
			});
		}
		if (s.sharedTags.length > 0) reasons.createEl('li', { text: this.t('suggest.tags', { tags: s.sharedTags.map((t) => `#${t}`).join(' ') }) });
		const passages = card.createEl('details');
		passages.createEl('summary', { text: this.t('suggest.passages') });
		passages.addEventListener('toggle', () => {
			if (!passages.open || passages.dataset.loaded) return;
			passages.dataset.loaded = '1';
			void this.showPassages(passages, s);
		});
		const actions = card.createDiv({ cls: 'semantic-atlas-actions' });
		const link = actions.createEl('button', { text: this.t('suggest.link'), cls: 'mod-cta', attr: { 'aria-label': this.t('suggest.linkLabel', { from: this.label(s.a), to: this.label(s.b) }) } });
		link.addEventListener('click', () => {
			void this.plugin.analysis
				.link(s.a, s.b)
				.then(() => new Notice(this.t('suggest.linked', { from: this.label(s.a), to: this.label(s.b) })))
				.catch((e: unknown) => new Notice(String(e)));
		});
		const unrelated = actions.createEl('button', { text: this.t('suggest.unrelated') });
		unrelated.addEventListener('click', () => void this.plugin.analysis.judge(s.a, s.b, 'unrelated'));
		const ignore = actions.createEl('button', { text: this.t('suggest.ignore') });
		ignore.addEventListener('click', () => void this.plugin.analysis.judge(s.a, s.b, 'ignored'));
	}

	private async showPassages(el: HTMLElement, s: Suggestion): Promise<void> {
		const best = this.plugin.index.closestPassages(s.a, s.b);
		if (!best) {
			el.createEl('p', { text: this.t('suggest.noPassages') });
			return;
		}
		const [ta, tb] = await Promise.all([this.plugin.index.passageText(s.a, best.a), this.plugin.index.passageText(s.b, best.b)]);
		for (const [id, text] of [
			[s.a, ta],
			[s.b, tb],
		] as const) {
			const q = el.createEl('blockquote', { cls: 'semantic-atlas-passage' });
			q.createEl('strong', { text: this.label(id) });
			q.createDiv({ text });
		}
		el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('suggest.similarity', { value: best.similarity.toFixed(2) }) });
	}

	private renderDrift(side: HTMLElement): void {
		const box = side.createEl('section', { cls: 'semantic-atlas-drift' });
		box.createEl('h3', { text: this.t('explorer.driftTitle', { steps: this.drift.path.length }) });
		const ol = box.createEl('ol');
		for (const p of this.drift.path.slice(-15)) {
			const li = ol.createEl('li');
			this.noteLink(li, p.id);
			if (p !== this.drift.path[0]) li.appendText(` (${p.similarity.toFixed(2)})`);
		}
		const actions = box.createDiv({ cls: 'semantic-atlas-actions' });
		const copy = actions.createEl('button', { text: this.t('explorer.copyPath') });
		copy.addEventListener('click', () => void this.copyPath());
		const clear = actions.createEl('button', { text: this.t('explorer.clearPath') });
		clear.addEventListener('click', () => {
			this.stopDrift(false);
			this.drift.path = [];
			this.explorer?.setPath([]);
			this.renderToolbar(true);
			this.renderSide();
		});
	}
}
