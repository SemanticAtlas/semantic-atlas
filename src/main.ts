import { Plugin, getLanguage } from 'obsidian';
import { createTranslator, pickLocale, type Translate } from './i18n';
import { createLogger, type Logger } from './log';
import { DEFAULT_SETTINGS, migrateSettings, type SemanticAtlasSettings } from './settings/schema';
import { SemanticAtlasSettingTab } from './settings/tab';

export default class SemanticAtlasPlugin extends Plugin {
	override settings: SemanticAtlasSettings = { ...DEFAULT_SETTINGS };
	/** Settings saved by a newer release: used, never overwritten. */
	settingsReadOnly = false;
	t: Translate = createTranslator('en');
	log: Logger = createLogger(() => this.settings.debug);

	override async onload(): Promise<void> {
		this.t = createTranslator(pickLocale(getLanguage()));
		await this.loadSettings();
		this.addSettingTab(new SemanticAtlasSettingTab(this.app, this));
		this.log.debug('loaded');
	}

	override onunload(): void {
		this.log.debug('unloaded');
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
