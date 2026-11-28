/**
 * The landscape: the vault seen by meaning. Four tabs (map, clusters, over time, axes) and the
 * "Quality of the analysis" panel. Everything comes from the last analysis; nothing here writes
 * to a note.
 */
import { ItemView, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { MapView, colourOf, type AnalysisResult, type Period } from '@semanticatlas/core';
import type SemanticAtlasPlugin from '../main';
import type { MessageKey } from '../i18n';
import { qualityReport } from '../analysis/quality';
import { axisTable, growthTable } from '../analysis/tables';

export const VIEW_TYPE_LANDSCAPE = 'semantic-atlas-landscape';

const TABS = ['map', 'clusters', 'time', 'axes'] as const;
type Tab = (typeof TABS)[number];
const PERIODS: Period[] = ['year', 'quarter', 'month'];
const MEMBERS_SHOWN = 10;

interface LandscapeState extends Record<string, unknown> {
	tab: Tab;
	period: Period;
}

const isTab = (x: unknown): x is Tab => typeof x === 'string' && (TABS as readonly string[]).includes(x);
const isPeriod = (x: unknown): x is Period => typeof x === 'string' && (PERIODS as string[]).includes(x);

export class LandscapeView extends ItemView {
	private state: LandscapeState = { tab: 'map', period: 'month' };
	private toolbar: HTMLElement | null = null;
	private tabBar: HTMLElement | null = null;
	private message: HTMLElement | null = null;
	private body: HTMLElement | null = null;
	private quality: HTMLDetailsElement | null = null;
	private map: MapView | null = null;
	private shown: AnalysisResult | null = null;
	private ticket = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SemanticAtlasPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_LANDSCAPE;
	}

	getDisplayText(): string {
		return this.plugin.t('landscape.title');
	}

	override getIcon(): string {
		return 'map';
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (typeof state === 'object' && state !== null) {
			const s = state as Partial<LandscapeState>;
			if (isTab(s.tab)) this.state.tab = s.tab;
			if (isPeriod(s.period)) this.state.period = s.period;
		}
		await super.setState(state, result);
		this.render(true);
	}

	override async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('semantic-atlas-landscape');
		this.toolbar = contentEl.createDiv({ cls: 'semantic-atlas-toolbar' });
		this.tabBar = contentEl.createDiv({ cls: 'semantic-atlas-tabs', attr: { role: 'tablist', 'aria-label': this.plugin.t('landscape.tabs') } });
		this.message = contentEl.createEl('p', { cls: 'semantic-atlas-message', attr: { 'aria-live': 'polite' } });
		this.body = contentEl.createDiv({ cls: 'semantic-atlas-landscape-body', attr: { role: 'tabpanel' } });
		this.quality = contentEl.createEl('details', { cls: 'semantic-atlas-quality' });
		this.register(this.plugin.analysis.onChange(() => this.render(false)));
		this.register(this.plugin.index.onChange((s) => {
			if (s.phase !== 'indexing' && s.phase !== 'downloading') this.renderMessage();
		}));
		this.registerEvent(this.app.workspace.on('css-change', () => this.map?.refreshTheme()));
		this.render(true);
		await Promise.resolve();
	}

	override onResize(): void {
		this.map?.notifyResize();
	}

	override async onClose(): Promise<void> {
		this.map?.dispose();
		this.map = null;
		await Promise.resolve();
	}

	private t(key: MessageKey, vars?: Record<string, string | number>): string {
		return this.plugin.t(key, vars);
	}

	private openNote(id: string, newLeaf = false): void {
		const file = this.app.vault.getFileByPath(id);
		if (file instanceof TFile) void this.app.workspace.getLeaf(newLeaf).openFile(file);
	}

	private noteLink(parent: HTMLElement, id: string, text?: string): HTMLElement {
		const label = text ?? this.app.vault.getFileByPath(id)?.basename ?? id;
		const a = parent.createEl('a', { cls: 'internal-link', text: label, href: '#' });
		a.addEventListener('click', (event) => {
			event.preventDefault();
			this.openNote(id, event.ctrlKey || event.metaKey);
		});
		return a;
	}

	/** Re-renders; `full` also rebuilds the current tab when the result did not change. */
	private render(full: boolean): void {
		if (!this.body) return;
		const result = this.plugin.analysis.result();
		this.renderToolbar();
		this.renderTabs();
		this.renderMessage();
		const usable = result && !result.skipped ? result : null;
		if (full || usable !== this.shown || this.state.tab !== 'map') {
			const scroll = this.body.scrollTop;
			this.renderBody(usable, usable !== this.shown);
			this.body.scrollTop = scroll;
		}
		this.shown = usable;
		this.renderQuality(usable);
	}

	private renderToolbar(): void {
		const bar = this.toolbar;
		if (!bar) return;
		bar.empty();
		const update = bar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': this.t('landscape.update') } });
		setIcon(update, 'refresh-cw');
		update.disabled = !this.plugin.index.isReady() || this.plugin.analysis.getState().phase === 'running';
		update.addEventListener('click', () => void this.plugin.analysis.run());
		if (this.state.tab === 'map' && this.shown) {
			const filter = bar.createEl('input', {
				type: 'search',
				attr: { placeholder: this.t('landscape.filter'), 'aria-label': this.t('landscape.filterLabel') },
			});
			filter.addEventListener('input', () => this.map?.setFilter(filter.value));
		}
	}

	private renderTabs(): void {
		const bar = this.tabBar;
		if (!bar) return;
		bar.empty();
		TABS.forEach((tab, i) => {
			const selected = tab === this.state.tab;
			const b = bar.createEl('button', {
				text: this.t(`landscape.tab.${tab}`),
				attr: { role: 'tab', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1' },
			});
			b.toggleClass('is-active', selected);
			b.addEventListener('click', () => this.selectTab(tab));
			b.addEventListener('keydown', (event) => {
				const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
				if (step === 0) return;
				event.preventDefault();
				const next = TABS[(i + step + TABS.length) % TABS.length]!;
				this.selectTab(next);
				this.tabBar?.querySelectorAll('button')[TABS.indexOf(next)]?.focus();
			});
		});
	}

	private selectTab(tab: Tab): void {
		if (tab === this.state.tab) return;
		this.state.tab = tab;
		this.app.workspace.requestSaveLayout();
		this.render(true);
	}

	private renderMessage(): void {
		const el = this.message;
		if (!el) return;
		el.empty();
		const a = this.plugin.analysis.getState();
		const result = this.plugin.analysis.result();
		if (!this.plugin.index.isReady() && !result) {
			el.setText(this.t('landscape.notReady'));
			const b = el.createEl('button', { text: this.t('related.setUpButton'), cls: 'mod-cta' });
			b.addEventListener('click', () => void this.plugin.setUpIndex());
			return;
		}
		if (a.phase === 'running') el.setText(this.t('landscape.running'));
		else if (a.phase === 'waiting' && !result) el.setText(this.t('landscape.waiting'));
		else if (a.phase === 'error') el.setText(this.t('landscape.error', { message: a.message }));
		else if (result?.skipped) el.setText(this.t('landscape.tooFew'));
		else if (result) el.setText(this.t('landscape.summary', { notes: result.notes.size, clusters: result.clusters.length, seconds: (a.ms / 1000).toFixed(1) }));
	}

	private renderBody(result: AnalysisResult | null, changed: boolean): void {
		const body = this.body;
		if (!body) return;
		if (this.state.tab !== 'map' || !result) {
			this.map?.dispose();
			this.map = null;
			body.empty();
		}
		if (!result) return;
		body.dataset.tab = this.state.tab;
		if (this.state.tab === 'map') this.renderMap(body, result, changed);
		else if (this.state.tab === 'clusters') this.renderClusters(body, result);
		else if (this.state.tab === 'time') this.renderTime(body, result);
		else void this.renderAxes(body, result);
	}

	// ---- map ------------------------------------------------------------------------------

	private renderMap(body: HTMLElement, result: AnalysisResult, changed: boolean): void {
		if (!this.map) {
			body.empty();
			this.map = new MapView(body, {
				labels: {
					table: this.t('map.table'),
					legend: this.t('map.legend'),
					canvas: this.t('map.canvas'),
					unstable: this.t('map.unstable'),
					shown: (shown, total) => this.t('map.shown', { shown, total }),
					selected: (label) => this.t('map.selected', { label }),
				},
				onOpen: (id) => this.openNote(id),
			});
			changed = true;
		}
		if (!changed) return;
		let lo = Infinity;
		let hi = -Infinity;
		for (const n of result.notes.values()) {
			lo = Math.min(lo, n.centrality);
			hi = Math.max(hi, n.centrality);
		}
		const span = hi - lo || 1;
		this.map.setData({
			points: [...result.notes].map(([id, n]) => ({
				id,
				label: this.app.vault.getFileByPath(id)?.basename ?? id,
				group: n.cluster,
				x: n.x,
				y: n.y,
				size: (n.centrality - lo) / span,
			})),
			groups: result.clusters.map((c) => ({ id: c.id, name: c.name, stability: c.stability })),
		});
	}

	// ---- clusters -------------------------------------------------------------------------

	private renderClusters(body: HTMLElement, result: AnalysisResult): void {
		const list = body.createDiv({ cls: 'semantic-atlas-clusters' });
		for (const c of result.clusters) {
			const card = list.createEl('section', { cls: 'semantic-atlas-cluster' });
			card.style.setProperty('--sa-swatch', colourOf(c.id));
			const head = card.createDiv({ cls: 'semantic-atlas-cluster-head' });
			head.createSpan({ cls: 'semantic-atlas-swatch', attr: { 'aria-hidden': 'true' } });
			const title = head.createEl('h3', { text: c.name });
			if (c.manual) head.createSpan({ cls: 'semantic-atlas-badge', text: this.t('clusters.manual') });
			const rename = head.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': this.t('clusters.rename') } });
			setIcon(rename, 'pencil');
			rename.addEventListener('click', () => {
				this.editName(head, title, c.id, c.name, c.manual);
			});

			const facts = card.createEl('p', { cls: 'semantic-atlas-cluster-facts' });
			facts.appendText(`${this.t('clusters.notes', { count: c.size })} · ${this.t('clusters.stability', { percent: Math.round(c.stability * 100) })}`);
			const connectors = c.members.filter((id) => result.notes.get(id)?.role === 'connector').length;
			if (connectors > 0) facts.appendText(` · ${this.t('clusters.connectors', { count: connectors })}`);
			if (c.stability < 0.6) card.createEl('p', { cls: 'semantic-atlas-warning', text: this.t('clusters.unstable') });
			if (c.terms.length > 0) {
				card.createEl('p', { cls: 'semantic-atlas-label', text: this.t('clusters.terms') });
				card.createEl('p', { cls: 'semantic-atlas-cluster-terms', text: c.terms.join(', ') });
			}
			card.createEl('p', { cls: 'semantic-atlas-label', text: this.t('clusters.members') });
			const ul = card.createEl('ul');
			for (const id of c.members.slice(0, MEMBERS_SHOWN)) this.noteLink(ul.createEl('li'), id);
			if (c.members.length > MEMBERS_SHOWN) {
				const more = card.createEl('details');
				more.createEl('summary', { text: this.t('clusters.more', { count: c.members.length - MEMBERS_SHOWN }) });
				const rest = more.createEl('ul');
				for (const id of c.members.slice(MEMBERS_SHOWN)) this.noteLink(rest.createEl('li'), id);
			}
		}
	}

	private editName(head: HTMLElement, title: HTMLElement, id: number, name: string, manual: boolean): void {
		if (head.querySelector('form')) return;
		title.hide();
		const form = head.createEl('form', { cls: 'semantic-atlas-rename' });
		head.insertAfter(form, title);
		const input = form.createEl('input', { type: 'text', value: name, attr: { 'aria-label': this.t('clusters.renameLabel') } });
		form.createEl('button', { type: 'submit', text: this.t('clusters.save'), cls: 'mod-cta' });
		const cancel = form.createEl('button', { type: 'button', text: this.t('clusters.cancel') });
		if (manual) {
			const reset = form.createEl('button', { type: 'button', text: this.t('clusters.reset') });
			reset.addEventListener('click', () => void this.plugin.analysis.rename(id, ''));
		}
		const close = (): void => {
			form.remove();
			title.show();
		};
		cancel.addEventListener('click', close);
		input.addEventListener('keydown', (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				close();
			}
		});
		form.addEventListener('submit', (event) => {
			event.preventDefault();
			void this.plugin.analysis.rename(id, input.value);
		});
		input.focus();
		input.select();
	}

	// ---- over time ------------------------------------------------------------------------

	private renderTime(body: HTMLElement, result: AnalysisResult): void {
		const { dateSource } = this.plugin.settings.analysis;
		const property = this.plugin.settings.index.dateProperty;
		const source =
			dateSource === 'property'
				? property
					? this.t('time.source.property', { name: property })
					: this.t('time.source.propertyMissing')
				: this.t(`time.source.${dateSource}`);
		const controls = body.createDiv({ cls: 'semantic-atlas-toolbar' });
		const label = controls.createEl('label');
		label.appendText(`${this.t('time.period')} `);
		const select = label.createEl('select', { cls: 'dropdown' });
		for (const p of PERIODS) select.createEl('option', { value: p, text: this.t(`time.${p}`) });
		select.value = this.state.period;
		select.addEventListener('change', () => {
			if (!isPeriod(select.value)) return;
			this.state.period = select.value;
			this.app.workspace.requestSaveLayout();
			this.render(true);
		});
		body.createEl('p', { cls: 'semantic-atlas-message', text: source });

		const table = growthTable(result, this.plugin.analysis.dates(), this.state.period);
		if (table.periods.length === 0) {
			body.createEl('p', { text: this.t('time.noDates') });
			return;
		}
		const wrap = body.createDiv({ cls: 'semantic-atlas-table-wrap' });
		const el = wrap.createEl('table', { cls: 'semantic-atlas-growth' });
		el.createEl('caption', { text: this.t('time.caption') });
		const headRow = el.createEl('thead').createEl('tr');
		headRow.createEl('th', { text: this.t('time.cluster'), attr: { scope: 'col' } });
		for (const p of table.periods) headRow.createEl('th', { text: p, attr: { scope: 'col' } });
		headRow.createEl('th', { text: this.t('time.undated'), attr: { scope: 'col' } });
		const tbody = el.createEl('tbody');
		for (const row of table.rows) {
			const tr = tbody.createEl('tr');
			tr.style.setProperty('--sa-swatch', colourOf(row.cluster));
			const th = tr.createEl('th', { attr: { scope: 'row' } });
			th.createSpan({ cls: 'semantic-atlas-swatch', attr: { 'aria-hidden': 'true' } });
			th.appendText(row.name);
			row.counts.forEach((count, i) => {
				const td = tr.createEl('td', { attr: { title: this.t('time.cell', { count, period: table.periods[i]! }) } });
				const bar = td.createDiv({ cls: 'semantic-atlas-bar' });
				bar.style.setProperty('--sa-share', String(table.max > 0 ? count / table.max : 0));
				td.createSpan({ cls: 'semantic-atlas-count', text: count > 0 ? String(count) : '' });
			});
			tr.createEl('td', { text: row.undated > 0 ? String(row.undated) : '' });
		}
	}

	// ---- axes -----------------------------------------------------------------------------

	private async renderAxes(body: HTMLElement, result: AnalysisResult): Promise<void> {
		if (this.plugin.settings.analysis.axes.length === 0) {
			body.createEl('p', { text: this.t('axes.none') });
			return;
		}
		const ticket = ++this.ticket;
		const loading = body.createEl('p', { cls: 'semantic-atlas-message', text: this.t('axes.loading') });
		let axes;
		try {
			axes = await this.plugin.analysis.axes();
		} catch (error) {
			loading.setText(this.t('landscape.error', { message: error instanceof Error ? error.message : String(error) }));
			return;
		}
		if (ticket !== this.ticket || this.state.tab !== 'axes') return;
		loading.remove();
		const table = axisTable(result, this.plugin.analysis.vectors(), axes);
		body.createEl('p', { cls: 'semantic-atlas-message', text: this.t('axes.centileHelp') });
		const wrap = body.createDiv({ cls: 'semantic-atlas-table-wrap' });
		const el = wrap.createEl('table', { cls: 'semantic-atlas-axes' });
		el.createEl('caption', { text: this.t('axes.caption') });
		const headRow = el.createEl('thead').createEl('tr');
		headRow.createEl('th', { text: this.t('axes.cluster'), attr: { scope: 'col' } });
		for (const a of table.axes) headRow.createEl('th', { text: a, attr: { scope: 'col' } });
		const tbody = el.createEl('tbody');
		for (const row of table.rows) {
			const tr = tbody.createEl('tr');
			tr.style.setProperty('--sa-swatch', colourOf(row.cluster));
			const th = tr.createEl('th', { attr: { scope: 'row' } });
			th.createSpan({ cls: 'semantic-atlas-swatch', attr: { 'aria-hidden': 'true' } });
			th.appendText(row.name);
			for (const c of row.centiles) {
				const td = tr.createEl('td', { cls: 'semantic-atlas-heat', text: String(Math.round(c)) });
				td.style.setProperty('--sa-heat', String(Math.max(0, (c - 50) / 50)));
			}
		}
		for (const axis of table.axes) {
			const section = body.createEl('section', { cls: 'semantic-atlas-axis' });
			section.createEl('h3', { text: this.t('axes.top', { axis }) });
			section.createEl('p', { cls: 'semantic-atlas-message', text: this.t('axes.nearest', { count: table.nearest.get(axis) ?? 0 }) });
			const ul = section.createEl('ul');
			for (const hit of table.top.get(axis) ?? []) {
				const li = ul.createEl('li');
				this.noteLink(li, hit.id);
				li.appendText(` (${Math.round(hit.centile)})`);
			}
		}
	}

	// ---- quality --------------------------------------------------------------------------

	private renderQuality(result: AnalysisResult | null): void {
		const el = this.quality;
		if (!el) return;
		const open = el.open;
		el.empty();
		el.toggle(result !== null);
		if (!result) return;
		el.open = open;
		el.createEl('summary', { text: this.t('quality.title') });
		const q = qualityReport(result);
		const fmt = (x: number): string => x.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
		el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('quality.help') });
		const ul = el.createEl('ul');
		const item = (text: string, help?: string): void => {
			const li = ul.createEl('li', { text });
			if (help) li.createDiv({ cls: 'semantic-atlas-message', text: help });
		};
		item(this.t('quality.notes', { count: q.notes }));
		item(this.t('quality.clusters', { count: q.clusters, merged: q.mergedClusters }));
		item(this.t('quality.modularity', { value: fmt(q.modularity.value), level: this.t(`quality.level.${q.modularity.level}`) }), this.t('quality.modularity.help'));
		item(this.t('quality.silhouette', { value: fmt(q.silhouette.value), level: this.t(`quality.level.${q.silhouette.level}`) }), this.t('quality.silhouette.help'));
		item(this.t('quality.stability', { percent: Math.round(q.meanStability * 100) }));
		const names = new Map(result.clusters.map((c) => [c.id, c.name]));
		item(q.unstable.length > 0 ? this.t('quality.unstable', { names: q.unstable.map((id) => names.get(id) ?? String(id)).join(', ') }) : this.t('quality.noUnstable'));
		item(this.t(q.hubs.correction === 'none' ? 'quality.hubsNone' : 'quality.hubs', { k: q.hubs.k, skewness: fmt(q.hubs.skewness) }));
		item(this.t('quality.duplicates', { count: q.nearDuplicates }));
		if (result.nearDuplicates.length > 0) {
			const dl = el.createEl('ul', { cls: 'semantic-atlas-pairs' });
			for (const p of result.nearDuplicates.slice(0, 10)) {
				const li = dl.createEl('li');
				this.noteLink(li, p.a);
				li.appendText(' ↔ ');
				this.noteLink(li, p.b);
				li.appendText(` (${fmt(p.similarity)})`);
			}
		}
		el.createEl('p', { cls: 'semantic-atlas-label', text: this.t('quality.isolated') });
		const iso = el.createEl('ul');
		for (const n of q.mostIsolated) {
			const li = iso.createEl('li');
			this.noteLink(li, n.id);
			li.appendText(` (${fmt(n.isolation)})`);
		}
		const at = this.plugin.analysis.getState().at;
		if (at > 0) el.createEl('p', { cls: 'semantic-atlas-message', text: this.t('quality.when', { date: new Date(at).toLocaleString() }) });
	}
}
