import { App, PluginSettingTab, Setting } from 'obsidian';
import type SemanticAtlasPlugin from '../main';

export class SemanticAtlasSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SemanticAtlasPlugin,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl } = this;
		const t = this.plugin.t;
		containerEl.empty();

		if (this.plugin.settingsReadOnly) {
			containerEl.createEl('p', { cls: 'semantic-atlas-warning', text: t('settings.readOnly') });
		}

		new Setting(containerEl)
			.setName(t('settings.debug.name'))
			.setDesc(t('settings.debug.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.setDisabled(this.plugin.settingsReadOnly)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
