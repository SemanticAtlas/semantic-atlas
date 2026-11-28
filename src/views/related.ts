import { ItemView, Notice, TFile, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type SemanticAtlasPlugin from '../main';
import type { IndexState } from '../indexing/service';

export const VIEW_TYPE_RELATED = 'semantic-atlas-related';

interface RelatedState extends Record<string, unknown> {
	hideLinked: boolean;
}

const RESULTS = 15;

/** Notes closest by meaning to the active note, with the passage that makes them close. */
export class RelatedNotesView extends ItemView {
	private state: RelatedState = { hideLinked: false };
	private paused = false;
	private current: string | null = null;
	private renderTicket = 0;
	private refreshTimer: number | null = null;
	private body: HTMLElement | null = null;
	private header: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SemanticAtlasPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED;
	}

	getDisplayText(): string {
		return this.plugin.t('related.title');
	}

	override getIcon(): string {
		return 'sparkles';
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (typeof state === 'object' && state !== null && typeof (state as RelatedState).hideLinked === 'boolean') {
			this.state = { hideLinked: (state as RelatedState).hideLinked };
		}
		await super.setState(state, result);
		this.renderHeader();
		void this.render();
	}

	override async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('semantic-atlas-related');
		this.header = contentEl.createDiv({ cls: 'semantic-atlas-toolbar' });
		this.body = contentEl.createDiv({ cls: 'semantic-atlas-related-list' });
		this.current = this.app.workspace.getActiveFile()?.path ?? null;
		this.renderHeader();
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (this.paused || !file) return;
				this.current = file.path;
				void this.render();
			}),
		);
		let lastPhase = this.plugin.index.getState().phase;
		let lastIndexed = this.current ? this.plugin.index.hasNote(this.current) : false;
		this.register(
			this.plugin.index.onChange((s: IndexState) => {
				// Refresh when the phase changes or the active note gets indexed; not on every note.
				const indexed = this.current ? this.plugin.index.hasNote(this.current) : false;
				if (s.phase !== lastPhase || indexed !== lastIndexed) this.scheduleRender();
				lastPhase = s.phase;
				lastIndexed = indexed;
			}),
		);
		await this.render();
	}

	override async onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		await Promise.resolve();
	}

	private scheduleRender(): void {
		if (this.refreshTimer !== null) return;
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.render();
		}, 1500);
	}

	private renderHeader(): void {
		const bar = this.header;
		if (!bar) return;
		const t = this.plugin.t;
		bar.empty();
		const label = bar.createEl('label', { cls: 'semantic-atlas-toggle' });
		const hide = label.createEl('input', { type: 'checkbox' });
		hide.checked = this.state.hideLinked;
		label.appendText(t('related.hideLinked'));
		hide.addEventListener('change', () => {
			this.state = { hideLinked: hide.checked };
			this.app.workspace.requestSaveLayout();
			void this.render();
		});
		const pause = bar.createEl('button', { cls: 'clickable-icon' });
		const showPause = (): void => {
			pause.empty();
			setIcon(pause, this.paused ? 'play' : 'pause');
			pause.setAttribute('aria-label', t(this.paused ? 'related.resume' : 'related.pause'));
		};
		showPause();
		pause.addEventListener('click', () => {
			this.paused = !this.paused;
			showPause();
			if (!this.paused) {
				this.current = this.app.workspace.getActiveFile()?.path ?? this.current;
				void this.render();
			}
		});
		const copy = bar.createEl('button', { cls: 'clickable-icon' });
		setIcon(copy, 'copy');
		copy.setAttribute('aria-label', t('related.copyLinks'));
		copy.addEventListener('click', () => void this.copyLinks());
	}

	private hits(): string[] {
		if (!this.current) return [];
		const linked = new Set<string>();
		if (this.state.hideLinked) {
			const resolved = this.app.metadataCache.resolvedLinks;
			for (const target of Object.keys(resolved[this.current] ?? {})) linked.add(target);
			for (const [source, targets] of Object.entries(resolved)) if (this.current in targets) linked.add(source);
		}
		return this.plugin.index
			.related(this.current, RESULTS + linked.size)
			.filter((h) => !linked.has(h.id))
			.slice(0, RESULTS)
			.map((h) => h.id);
	}

	private async copyLinks(): Promise<void> {
		if (!this.current) return;
		const links = this.hits()
			.map((id) => this.app.vault.getFileByPath(id))
			.filter((f): f is TFile => f instanceof TFile)
			.map((f) => `- ${this.app.fileManager.generateMarkdownLink(f, this.current ?? '')}`);
		await navigator.clipboard.writeText(links.join('\n'));
		new Notice(this.plugin.t('related.copied', { count: links.length }));
	}

	private async render(): Promise<void> {
		const body = this.body;
		if (!body) return;
		const ticket = ++this.renderTicket;
		const t = this.plugin.t;
		const index = this.plugin.index;
		const state = index.getState();
		body.empty();

		if (state.phase === 'off' || state.phase === 'no-model' || state.phase === 'error') {
			body.createEl('p', { cls: 'semantic-atlas-message', text: state.phase === 'error' ? t('index.error', { message: state.message }) : t('related.setUp') });
			const button = body.createEl('button', { text: t('related.setUpButton'), cls: 'mod-cta' });
			button.addEventListener('click', () => void this.plugin.setUpIndex());
			return;
		}
		if (state.phase === 'indexing' || state.phase === 'downloading' || state.phase === 'loading') {
			body.createEl('p', { cls: 'semantic-atlas-message', text: t('related.indexing', { done: state.done, total: state.total }) });
		}
		if (!this.current) {
			body.createEl('p', { cls: 'semantic-atlas-message', text: t('related.noActive') });
			return;
		}
		if (!index.hasNote(this.current)) {
			body.createEl('p', { cls: 'semantic-atlas-message', text: t('related.notIndexed') });
			return;
		}
		const source = this.current;
		const hits = index.related(source, RESULTS * 2);
		const keep = new Set(this.hits());
		const list = body.createEl('ol', { cls: 'semantic-atlas-related-items' });
		body.createEl('p', { cls: 'semantic-atlas-hint', text: t('related.dragHint') });
		for (const hit of hits.filter((h) => keep.has(h.id))) {
			const file = this.app.vault.getFileByPath(hit.id);
			if (!(file instanceof TFile)) continue;
			const item = list.createEl('li', { cls: 'semantic-atlas-related-item' });
			const title = item.createEl('a', { cls: 'internal-link semantic-atlas-related-title', text: file.basename, href: '#' });
			title.draggable = true;
			title.setAttribute('data-href', file.path);
			title.addEventListener('click', (e) => {
				e.preventDefault();
				void this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false).openFile(file);
			});
			title.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/plain', this.app.fileManager.generateMarkdownLink(file, source));
			});
			const meta = item.createDiv({ cls: 'semantic-atlas-related-meta' });
			const bar = meta.createEl('meter', { cls: 'semantic-atlas-score' });
			bar.min = 0;
			bar.max = 1;
			bar.value = Math.max(0, hit.score);
			bar.setAttribute('aria-label', hit.score.toFixed(2));
			meta.createSpan({ text: hit.score.toFixed(2) });
			if (hit.passage) {
				const excerpt = item.createDiv({ cls: 'semantic-atlas-related-excerpt' });
				if (hit.passage.headings.length > 0) excerpt.createDiv({ cls: 'semantic-atlas-suggestion-path', text: hit.passage.headings.join(' › ') });
				const text = await index.passageText(hit.id, hit.passage, 220);
				if (ticket !== this.renderTicket) return;
				excerpt.createDiv({ text });
			}
		}
		if (list.childElementCount === 0) body.createEl('p', { cls: 'semantic-atlas-message', text: t('related.empty') });
	}
}
