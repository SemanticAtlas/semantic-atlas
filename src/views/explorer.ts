/**
 * The explorer: every analysed note placed by meaning, coloured and sized by a chosen variable,
 * with the explicit links, suggested links (with their reasons and the three actions), a drift
 * through the closest notes, and the card of the selected note. Display choices are saved with
 * the view. Nothing here writes to a note, except the "Link" action, on click.
 */
import { ItemView, Menu, Notice, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import {
	ExplorerView,
	categoricalColours,
	colourOf,
	driftStep,
	numericColours,
	sizes,
	SEQUENTIAL,
	MISSING_COLOUR,
	type AnalysisResult,
	type ExplorerEdge,
	type ExplorerEdgeKind,
	type ExplorerLegend,
	type ProjectionMethod,
	type ProjectionResult,
	type Suggestion,
} from '@semanticatlas/core';
import type SemanticAtlasPlugin from '../main';
import type { MessageKey } from '../i18n';
import { collectRelations } from '../adapter/collect';
import { linkResolver, readNotes } from '../adapter/vault';
import { SUBMAP_KINDS, SUBMAP_MAX, SUBMAP_MIN, subsetFor, type SubmapKind } from '../explorer/submap';
import { CATEGORY_BY, NUMBER_BY, SIZE_BY, categoryValues, isCategory, numericValues, sizeValues, type ColourBy, type SizeBy, type VariableContext } from '../explorer/variables';

export const VIEW_TYPE_EXPLORER = 'semantic-atlas-explorer';

const EDGE_KINDS: ExplorerEdgeKind[] = ['link', 'embed', 'property', 'suggested'];
const PANELS = ['note', 'suggestions'] as const;
type Panel = (typeof PANELS)[number];
const SUGGESTIONS_SHOWN = 40;

type Layout = 'landscape' | ProjectionMethod;
const LAYOUTS: readonly Layout[] = ['tsne', 'umap', 'pacmap', 'landscape'];

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
}

const DEFAULT_STATE: ExplorerState = { layout: 'tsne', colourBy: 'cluster', sizeBy: 'pagerank', edges: ['link', 'embed', 'property'], delay: 1.5, panel: 'note', aroundSelection: false };
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
		this.explorer = new ExplorerView(host, {
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
		});
		this.register(this.plugin.analysis.onChange(() => this.render(false)));
		this.registerEvent(this.app.workspace.on('css-change', () => this.explorer?.refreshTheme()));
		this.render(true);
		await Promise.resolve();
	}

	override onResize(): void {
		this.explorer?.notifyResize();
	}

	override async onClose(): Promise<void> {
		this.stopDrift();
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
		const notice = new Notice(this.t('explorer.submap.computing', { count: subset.ids.length }), 0);
		try {
			const sub = await this.plugin.analysis.analyseSubset(subset.ids);
			if (sub.skipped) {
				new Notice(this.t('explorer.submap.tooFew', { count: subset.ids.length, min: SUBMAP_MIN, max: SUBMAP_MAX }));
				return;
			}
			this.stopDrift(false);
			this.drift.path = [];
			this.levels.push({ label: subset.label, result: sub });
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
						? result.clusters.map((c) => ({ name: c.name, members: c.members.map((m) => index.get(m)).filter((i): i is number => i !== undefined) }))
						: [],
			});
			explorer.setEdgeKinds(this.state.edges);
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
		const key = this.levelKey(layout);
		const cached = this.projections.get(key);
		if (cached?.result === result && cached.ids.length === ids.length && cached.ids.every((id, i) => id === ids[i])) {
			this.showQuality(cached.projection);
			return cached.projection;
		}
		const previous = cached ? new Map(cached.ids.map((id, i) => [id, [cached.projection.x[i]!, cached.projection.y[i]!] as [number, number]])) : undefined;
		this.showQuality(null, true);
		try {
			const projection = await this.plugin.analysis.project(ids, layout, previous);
			if (projection.skipped) {
				this.showQuality(null);
				return null;
			}
			this.projections.set(key, { ids, result, projection });
			this.showQuality(projection);
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
		if (!result || !this.explorer) return;
		const ids = this.ids;
		const pos = await this.positions(result, ids);
		if (this.current() !== result || this.ids !== ids) return;
		const x = pos ? pos.x : Float32Array.from(ids, (id) => result.notes.get(id)!.x);
		const y = pos ? pos.y : Float32Array.from(ids, (id) => result.notes.get(id)!.y);
		this.explorer.setPositions(x, y);
		this.explorer.fitAll();
	}

	private showQuality(p: ProjectionResult | null, computing = false): void {
		const el = this.quality;
		if (!el) return;
		el.empty();
		if (computing) el.setText(this.t('explorer.projecting', { method: this.t(`explorer.layout.${this.state.layout}`) }));
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
		for (const p of PANELS) {
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
