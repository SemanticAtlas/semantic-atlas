import { Plugin, getLanguage, type WorkspaceLeaf } from 'obsidian';
import { createAtlas, type Atlas } from '@semanticatlas/core';
import engineWasm from '@semanticatlas/engine/engine.wasm';
import { createTranslator, pickLocale, type Translate } from './i18n';
import { createLogger, type Logger } from './log';
import { DEFAULT_SETTINGS, migrateSettings, type SemanticAtlasSettings } from './settings/schema';
import { SemanticAtlasSettingTab } from './settings/tab';
import { RelationsLeafView, VIEW_TYPE_RELATIONS, type RelationsViewState } from './views/relations';

export default class SemanticAtlasPlugin extends Plugin {
	override settings: SemanticAtlasSettings = { ...DEFAULT_SETTINGS };
	/** Settings saved by a newer release: used, never overwritten. */
	settingsReadOnly = false;
	t: Translate = createTranslator('en');
	log: Logger = createLogger(() => this.settings.debug);
	private atlasPromise: Promise<Atlas> | null = null;

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
		this.log.debug('loaded');
	}

	override onunload(): void {
		this.log.debug('unloaded');
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
