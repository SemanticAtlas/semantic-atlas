import { App, PluginSettingTab, Setting } from 'obsidian';
import type SemanticAtlasPlugin from '../main';
import type { IndexSettings } from './schema';

const lines = (text: string): string[] =>
	text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);

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

		this.displayIndex(containerEl);
	}

	private displayIndex(el: HTMLElement): void {
		const t = this.plugin.t;
		const plugin = this.plugin;
		const readOnly = plugin.settingsReadOnly;
		/** Saves a change; `restart` rebuilds what depends on it. */
		const update = async (patch: Partial<IndexSettings>, restart: boolean): Promise<void> => {
			plugin.settings.index = { ...plugin.settings.index, ...patch };
			await plugin.saveSettings();
			if (restart) await plugin.index.start();
		};
		new Setting(el).setName(t('settings.indexHeading')).setHeading();

		const s = plugin.index.getState();
		const stateText =
			s.phase === 'indexing'
				? t('state.indexing', { done: s.done, total: s.total })
				: s.phase === 'ready'
					? t('state.ready', { notes: s.indexedNotes })
					: s.phase === 'error'
						? t('state.error', { message: s.message })
						: t(`state.${s.phase}`);
		new Setting(el).setName(t('settings.state.name')).setDesc(stateText);

		new Setting(el)
			.setName(t('settings.enabled.name'))
			.setDesc(t('settings.enabled.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(plugin.settings.index.enabled)
					.setDisabled(readOnly)
					.onChange(async (value) => {
						if (value) {
							await plugin.setUpIndex();
						} else {
							await update({ enabled: false }, true);
						}
						this.display();
					}),
			);
		new Setting(el)
			.setName(t('settings.onMobile.name'))
			.setDesc(t('settings.onMobile.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(plugin.settings.index.onMobile)
					.setDisabled(readOnly)
					.onChange(async (value) => {
						await update({ onMobile: value }, true);
					}),
			);
		new Setting(el)
			.setName(t('settings.titleWeight.name'))
			.setDesc(t('settings.titleWeight.desc'))
			.addSlider((slider) =>
				slider
					.setLimits(0, 0.6, 0.05)
					.setValue(plugin.settings.index.titleWeight)
					.setDisabled(readOnly)
					.onChange(async (value) => {
						await update({ titleWeight: value }, true);
					}),
			);
		new Setting(el)
			.setName(t('settings.maxChunk.name'))
			.setDesc(t('settings.maxChunk.desc'))
			.addDropdown((dropdown) => {
				for (const n of [128, 256, 384, 512]) dropdown.addOption(String(n), String(n));
				dropdown
					.setValue(String(plugin.settings.index.maxChunkTokens))
					.setDisabled(readOnly)
					.onChange(async (value) => {
						await update({ maxChunkTokens: Number(value) }, true);
					});
			});
		new Setting(el)
			.setName(t('settings.includeCode.name'))
			.setDesc(t('settings.includeCode.desc'))
			.addToggle((toggle) =>
				toggle
					.setValue(plugin.settings.index.includeCode)
					.setDisabled(readOnly)
					.onChange(async (value) => {
						await update({ includeCode: value }, true);
					}),
			);
		new Setting(el)
			.setName(t('settings.excludeFolders.name'))
			.setDesc(t('settings.excludeFolders.desc'))
			.addTextArea((area) => {
				area.setValue(plugin.settings.index.excludeFolders.join('\n')).setDisabled(readOnly);
				area.inputEl.addEventListener('blur', () => {
					void update({ excludeFolders: lines(area.getValue()) }, true);
				});
			});
		new Setting(el)
			.setName(t('settings.excludeTags.name'))
			.setDesc(t('settings.excludeTags.desc'))
			.addTextArea((area) => {
				area.setValue(plugin.settings.index.excludeTags.join('\n')).setDisabled(readOnly);
				area.inputEl.addEventListener('blur', () => {
					void update({ excludeTags: lines(area.getValue()).map((tag) => tag.replace(/^#/, '')) }, true);
				});
			});
		new Setting(el)
			.setName(t('settings.clear.name'))
			.setDesc(t('settings.clear.desc'))
			.addButton((b) =>
				b.setButtonText(t('settings.clear.button')).onClick(() => {
					plugin.confirmClearData();
				}),
			);
	}
}
