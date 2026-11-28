import { ItemView, TFile, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { RelationsView, type OpenInfo } from '@semanticatlas/core';
import { collectRelations } from '../adapter/collect';
import { linkResolver, readNotes } from '../adapter/vault';
import type SemanticAtlasPlugin from '../main';

export const VIEW_TYPE_RELATIONS = 'semantic-atlas-relations';

export interface RelationsViewState extends Record<string, unknown> {
	local: boolean;
	depth: number;
	showUnresolved: boolean;
}

const DEFAULT_STATE: RelationsViewState = { local: false, depth: 1, showUnresolved: false };
const REFRESH_DELAY_MS = 1000;

const isState = (value: unknown): value is Partial<RelationsViewState> => typeof value === 'object' && value !== null;

/** Graph of the explicit links between notes, global or around the active note. */
export class RelationsLeafView extends ItemView {
	private state: RelationsViewState = { ...DEFAULT_STATE };
	private graph: RelationsView | null = null;
	private host: HTMLElement | null = null;
	private toolbar: HTMLElement | null = null;
	private message: HTMLElement | null = null;
	private refreshTimer: number | null = null;
	private lastNote: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SemanticAtlasPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_RELATIONS;
	}

	getDisplayText(): string {
		return this.plugin.t(this.state.local ? 'relations.localTitle' : 'relations.title');
	}

	override getIcon(): string {
		return 'git-fork';
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), ...this.state };
	}

	override async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (isState(state)) {
			this.state = {
				local: typeof state.local === 'boolean' ? state.local : this.state.local,
				depth: typeof state.depth === 'number' ? Math.min(3, Math.max(1, Math.round(state.depth))) : this.state.depth,
				showUnresolved: typeof state.showUnresolved === 'boolean' ? state.showUnresolved : this.state.showUnresolved,
			};
		}
		await super.setState(state, result);
		this.renderToolbar();
		await this.mountGraph();
	}

	override async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('semantic-atlas-relations');
		this.toolbar = contentEl.createDiv({ cls: 'semantic-atlas-toolbar' });
		this.message = contentEl.createEl('p', { cls: 'semantic-atlas-message', text: this.plugin.t('relations.loading') });
		this.host = contentEl.createDiv({ cls: 'semantic-atlas-relations-host' });
		this.lastNote = this.app.workspace.getActiveFile()?.path ?? null;
		this.renderToolbar();

		this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file) return;
				this.lastNote = file.path;
				if (this.state.local) this.applyFocus();
			}),
		);
		this.registerEvent(this.app.workspace.on('css-change', () => this.graph?.refreshTheme()));
		await this.mountGraph();
	}

	override async onClose(): Promise<void> {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.graph?.dispose();
		this.graph = null;
	}

	private renderToolbar(): void {
		const bar = this.toolbar;
		if (!bar) return;
		const t = this.plugin.t;
		bar.empty();

		const localLabel = bar.createEl('label', { cls: 'semantic-atlas-toggle' });
		const local = localLabel.createEl('input', { type: 'checkbox' });
		local.checked = this.state.local;
		localLabel.appendText(t('relations.local'));
		local.addEventListener('change', () => void this.updateState({ local: local.checked }));

		const depthLabel = bar.createEl('label', { cls: 'semantic-atlas-depth' });
		depthLabel.appendText(t('relations.depth'));
		const depth = depthLabel.createEl('select');
		for (const d of [1, 2, 3]) depth.createEl('option', { text: String(d), value: String(d) });
		depth.value = String(this.state.depth);
		depth.disabled = !this.state.local;
		depth.addEventListener('change', () => void this.updateState({ depth: Number(depth.value) }));

		const ghostsLabel = bar.createEl('label', { cls: 'semantic-atlas-toggle' });
		const ghosts = ghostsLabel.createEl('input', { type: 'checkbox' });
		ghosts.checked = this.state.showUnresolved;
		ghostsLabel.appendText(t('relations.showUnresolved'));
		ghosts.addEventListener('change', () => void this.updateState({ showUnresolved: ghosts.checked }));
	}

	private async updateState(change: Partial<RelationsViewState>): Promise<void> {
		const remount = change.showUnresolved !== undefined && change.showUnresolved !== this.state.showUnresolved;
		this.state = { ...this.state, ...change };
		this.renderToolbar();
		// Persist the state in the workspace layout.
		this.app.workspace.requestSaveLayout();
		if (remount) await this.mountGraph();
		else this.applyFocus();
		// The tab title depends on the mode.
		(this.leaf as WorkspaceLeaf & { updateHeader?: () => void }).updateHeader?.();
	}

	private async mountGraph(): Promise<void> {
		const host = this.host;
		if (!host) return;
		try {
			const atlas = await this.plugin.atlas();
			this.graph?.dispose();
			const t = this.plugin.t;
			this.graph = new RelationsView(host, atlas, {
				labels: {
					list: t('relations.list'),
					note: t('relations.note'),
					outgoing: t('relations.outgoing'),
					incoming: t('relations.incoming'),
					canvas: t('relations.canvas'),
					summary: (notes, links, unresolved) => t('relations.summary', { notes, links, unresolved }),
					selected: (label) => t('relations.selected', { label }),
					unresolvedNote: t('relations.unresolvedNote'),
				},
				onOpen: (id, info) => void this.openNote(id, info),
				showUnresolved: this.state.showUnresolved,
			});
			this.refresh();
		} catch (error) {
			this.plugin.log.error('relations view', error);
			this.message?.setText(this.plugin.t('relations.error', { message: error instanceof Error ? error.message : String(error) }));
		}
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, REFRESH_DELAY_MS);
	}

	private refresh(): void {
		if (!this.graph) return;
		const started = performance.now();
		const data = collectRelations(readNotes(this.app), linkResolver(this.app));
		this.graph.setData(data);
		this.applyFocus();
		this.plugin.log.debug(`relations: ${data.nodes.length} notes, ${data.edges.length} edges in ${Math.round(performance.now() - started)} ms`);
	}

	private applyFocus(): void {
		if (!this.graph) return;
		const note = this.state.local ? this.lastNote : null;
		this.message?.setText(this.state.local && !note ? this.plugin.t('relations.noActiveNote') : '');
		this.graph.setFocus(note, this.state.depth);
	}

	private async openNote(id: string, info?: OpenInfo): Promise<void> {
		// From a tab in the main area, open notes in a new tab; from a sidebar, in the main area.
		const inMainArea = this.leaf.getRoot() === this.app.workspace.rootSplit;
		const leaf = this.app.workspace.getLeaf(inMainArea ? 'tab' : false);
		if (info?.unresolved) {
			// Same behaviour as clicking an unresolved link: Obsidian creates the note.
			await this.app.workspace.openLinkText(id, this.lastNote ?? '', inMainArea ? 'tab' : false);
			return;
		}
		const file = this.app.vault.getFileByPath(id);
		if (file instanceof TFile) await leaf.openFile(file);
	}
}
