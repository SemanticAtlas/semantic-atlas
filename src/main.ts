import { Notice, Platform, Plugin, TFile, getLanguage, type WorkspaceLeaf } from 'obsidian';
import { createAtlas, type Atlas } from '@semanticatlas/core';
import engineWasm from '@semanticatlas/engine/engine.wasm';
import { createTranslator, pickLocale, type Translate } from './i18n';
import { createLogger, type Logger } from './log';
import { DEFAULT_SETTINGS, migrateSettings, type SemanticAtlasSettings } from './settings/schema';
import { SemanticAtlasSettingTab } from './settings/tab';
import { IndexingService, type IndexState } from './indexing/service';
import { AnalysisService } from './analysis/service';
import { LandscapeView, VIEW_TYPE_LANDSCAPE } from './views/landscape';
import { ClearDataModal, ModelModal } from './views/model-modal';
import { RelatedNotesView, VIEW_TYPE_RELATED } from './views/related';
import { RelationsLeafView, VIEW_TYPE_RELATIONS, type RelationsViewState } from './views/relations';
import { SemanticSearchModal } from './views/search-modal';

export default class SemanticAtlasPlugin extends Plugin {
	override settings: SemanticAtlasSettings = { ...DEFAULT_SETTINGS };
	/** Settings saved by a newer release: used, never overwritten. */
	settingsReadOnly = false;
	t: Translate = createTranslator('en');
	log: Logger = createLogger(() => this.settings.debug);
	private atlasPromise: Promise<Atlas> | null = null;
	index!: IndexingService;
	analysis!: AnalysisService;
	private statusBar: HTMLElement | null = null;
	private changeTimers = new Map<string, number>();

	override async onload(): Promise<void> {
		this.t = createTranslator(pickLocale(getLanguage()));
		await this.loadSettings();
		this.addSettingTab(new SemanticAtlasSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_RELATIONS, (leaf) => new RelationsLeafView(leaf, this));
		this.addCommand({
			id: 'open-link-graph',
			name: this.t('commands.openGraph'),
			callback: () => void this.openRelations({ local: false }, 'tab'),
		});
		this.addCommand({
			id: 'open-local-link-graph',
			name: this.t('commands.openLocalGraph'),
			callback: () => void this.openRelations({ local: true }, 'sidebar'),
		});
		this.index = new IndexingService(this.app, () => this.settings.index, this.log);
		this.registerView(VIEW_TYPE_RELATED, (leaf) => new RelatedNotesView(leaf, this));
		this.addCommand({ id: 'set-up-semantic-index', name: this.t('commands.setUpIndex'), callback: () => void this.setUpIndex() });
		this.addCommand({
			id: 'search-by-meaning',
			name: this.t('commands.searchByMeaning'),
			callback: () => {
				new SemanticSearchModal(this.app, this.index, this.t).open();
			},
		});
		this.addCommand({ id: 'open-related-notes', name: this.t('commands.openRelated'), callback: () => void this.openRelated() });
		this.addCommand({
			id: 'open-random-close-note',
			name: this.t('commands.randomClose'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.index.hasNote(file.path)) return false;
				if (!checking) void this.openRandomClose(file);
				return true;
			},
		});
		this.addCommand({
			id: 'pause-indexing',
			name: this.t('commands.pauseIndex'),
			checkCallback: (checking) => {
				if (this.index.getState().phase !== 'indexing') return false;
				if (!checking) this.index.pause();
				return true;
			},
		});
		this.addCommand({
			id: 'resume-indexing',
			name: this.t('commands.resumeIndex'),
			checkCallback: (checking) => {
				if (this.index.getState().phase !== 'paused') return false;
				if (!checking) this.index.resume();
				return true;
			},
		});
		this.analysis = new AnalysisService({
			app: this.app,
			index: this.index,
			settings: () => this.settings.analysis,
			indexSettings: () => this.settings.index,
			saveNames: async (names) => {
				this.settings.analysis.names = names;
				await this.saveSettings();
			},
			log: this.log,
		});
		this.registerView(VIEW_TYPE_LANDSCAPE, (leaf) => new LandscapeView(leaf, this));
		this.addCommand({ id: 'open-landscape', name: this.t('commands.openLandscape'), callback: () => void this.openLandscape() });
		this.addCommand({
			id: 'update-analysis',
			name: this.t('commands.updateAnalysis'),
			checkCallback: (checking) => {
				if (!this.index.isReady()) return false;
				if (!checking) void this.analysis.run();
				return true;
			},
		});
		this.addCommand({ id: 'clear-all-data', name: this.t('commands.clearData'), callback: () => this.confirmClearData() });

		if (!Platform.isMobile) {
			this.statusBar = this.addStatusBarItem();
			this.statusBar.addClass('semantic-atlas-status');
		}
		this.register(
			this.index.onChange((s) => {
				this.showStatus(s);
				this.analysis.indexChanged();
			}),
		);

		// Start-up work waits for the layout, and 'create' fires for every file while loading.
		this.app.workspace.onLayoutReady(() => {
			void this.index.start();
			this.registerEvent(this.app.metadataCache.on('changed', (file) => this.onNoteChanged(file)));
			this.registerEvent(
				this.app.vault.on('rename', (file, oldPath) => {
					void this.index.remove(oldPath);
					if (file instanceof TFile) this.onNoteChanged(file);
				}),
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					void this.index.remove(file.path);
				}),
			);
		});
		this.log.debug('loaded');
	}

	override onunload(): void {
		for (const timer of this.changeTimers.values()) window.clearTimeout(timer);
		this.changeTimers.clear();
		this.analysis.stop();
		void this.index.stop();
		this.log.debug('unloaded');
	}

	/** Re-embeds a note two seconds after its last change. */
	private onNoteChanged(file: TFile): void {
		if (file.extension !== 'md') return;
		const previous = this.changeTimers.get(file.path);
		if (previous !== undefined) window.clearTimeout(previous);
		this.changeTimers.set(
			file.path,
			window.setTimeout(() => {
				this.changeTimers.delete(file.path);
				this.index.enqueue(file.path);
			}, 2000),
		);
	}

	private showStatus(s: IndexState): void {
		const el = this.statusBar;
		if (!el) return;
		const t = this.t;
		const text =
			s.phase === 'indexing'
				? t('index.statusIndexing', { done: s.done, total: s.total })
				: s.phase === 'downloading'
					? t('index.statusDownloading', { percent: s.bytesTotal ? Math.floor((100 * s.bytesDone) / s.bytesTotal) : 0 })
					: s.phase === 'loading'
						? t('index.statusLoading')
						: s.phase === 'paused'
							? t('index.statusPaused', { done: s.done, total: s.total })
							: s.phase === 'error'
								? t('index.statusError')
								: '';
		el.setText(text);
		el.toggle(text !== '');
		if (s.phase === 'error') el.setAttribute('aria-label', s.message);
	}

	/** Turns the index on, asking before the model is downloaded. */
	async setUpIndex(): Promise<void> {
		if (Platform.isMobile && !this.settings.index.onMobile) {
			new Notice(this.t('index.offMobile'));
			return;
		}
		const enable = async (): Promise<void> => {
			if (!this.settings.index.enabled) {
				this.settings.index.enabled = true;
				await this.saveSettings();
			}
		};
		if (await this.index.hasModel()) {
			await enable();
			await this.index.start();
			return;
		}
		new ModelModal(this.app, this.index, this.t, enable).open();
	}

	confirmClearData(): void {
		new ClearDataModal(this.app, this.t, this.index.model.totalBytes, async (models) => {
			this.settings.index.enabled = false;
			await this.saveSettings();
			await this.index.clearAll(models);
			this.analysis.reset();
		}).open();
	}

	async openRelated(): Promise<void> {
		const { workspace } = this.app;
		const leaf = workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0] ?? workspace.getRightLeaf(false);
		if (!leaf) return;
		if (leaf.view.getViewType() !== VIEW_TYPE_RELATED) await leaf.setViewState({ type: VIEW_TYPE_RELATED, active: true });
		await workspace.revealLeaf(leaf);
	}

	async openLandscape(): Promise<void> {
		const { workspace } = this.app;
		const leaf = workspace.getLeavesOfType(VIEW_TYPE_LANDSCAPE)[0] ?? workspace.getLeaf('tab');
		if (leaf.view.getViewType() !== VIEW_TYPE_LANDSCAPE) await leaf.setViewState({ type: VIEW_TYPE_LANDSCAPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	private async openRandomClose(file: TFile): Promise<void> {
		const hits = this.index.related(file.path, 10);
		const pick = hits[Math.floor(Math.random() * hits.length)];
		const target = pick ? this.app.vault.getFileByPath(pick.id) : null;
		if (target instanceof TFile) await this.app.workspace.getLeaf(false).openFile(target);
		else new Notice(this.t('random.none'));
	}

	/** The compute engine, loaded on first use (not at start-up). */
	atlas(): Promise<Atlas> {
		this.atlasPromise ??= createAtlas(engineWasm).catch((error: unknown) => {
			this.atlasPromise = null;
			throw error;
		});
		return this.atlasPromise;
	}

	/** Reveals an existing link graph in the same mode, or opens one. */
	async openRelations(state: Partial<RelationsViewState>, where: 'tab' | 'sidebar'): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_RELATIONS).find((leaf) => {
			const view = leaf.getViewState().state as Partial<RelationsViewState> | undefined;
			return (view?.local ?? false) === (state.local ?? false);
		});
		const leaf: WorkspaceLeaf | null = existing ?? (where === 'tab' ? workspace.getLeaf('tab') : workspace.getRightLeaf(false));
		if (!leaf) return;
		if (!existing) await leaf.setViewState({ type: VIEW_TYPE_RELATIONS, active: true, state });
		await workspace.revealLeaf(leaf);
	}

	/** Called by Obsidian when data.json changed on disk, for example after a sync. */
	override async onExternalSettingsChange(): Promise<void> {
		await this.loadSettings();
	}

	async loadSettings(): Promise<void> {
		const { settings, changed, readOnly } = migrateSettings(await this.loadData());
		this.settings = settings;
		this.settingsReadOnly = readOnly;
		if (changed && !readOnly) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		if (this.settingsReadOnly) return;
		await this.saveData(this.settings);
	}
}
