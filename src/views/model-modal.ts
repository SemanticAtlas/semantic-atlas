import { Modal, Notice, Setting, type App } from 'obsidian';
import type { IndexingService, IndexState } from '../indexing/service';
import type { Translate } from '../i18n';

const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);

/**
 * Asks before downloading the model, and shows what will be downloaded, from where, its size
 * and license. Also offers to import the files by hand (no network).
 */
export class ModelModal extends Modal {
	private unsubscribe: (() => void) | null = null;

	constructor(
		app: App,
		private readonly service: IndexingService,
		private readonly t: Translate,
		private readonly onAccepted: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, t } = this;
		const spec = this.service.model;
		this.setTitle(t('model.title'));
		contentEl.createEl('p', { text: t('model.intro') });
		contentEl.createEl('p', { text: t('model.download') });

		const table = contentEl.createEl('table', { cls: 'semantic-atlas-model-table' });
		const row = (label: string, fill: (cell: HTMLElement) => void): void => {
			const tr = table.createEl('tr');
			tr.createEl('th', { text: label });
			fill(tr.createEl('td'));
		};
		row(t('model.name'), (td) => td.createEl('a', { text: spec.name, href: spec.sourceUrl }));
		row(t('model.license'), (td) => td.createEl('a', { text: spec.license, href: spec.licenseUrl }));
		row(t('model.size'), (td) => td.setText(t('model.sizeValue', { mb: mb(spec.totalBytes) })));
		const release = spec.assets.weights.url.replace(/\/download\/([^/]+)\/.*$/, '/tag/$1');
		row(t('model.from'), (td) => td.createEl('a', { text: new URL(release).host + new URL(release).pathname, href: release }));
		contentEl.createEl('p', { cls: 'setting-item-description', text: t('model.storage') });

		const progress = contentEl.createEl('progress', { cls: 'semantic-atlas-progress' });
		progress.max = spec.totalBytes;
		progress.value = 0;
		progress.hide();
		const status = contentEl.createEl('p', { cls: 'semantic-atlas-message' });
		status.setAttribute('role', 'status');

		const show = (s: IndexState): void => {
			if (s.phase === 'downloading') {
				progress.show();
				progress.value = s.bytesDone;
				status.setText(t('model.progress', { done: mb(s.bytesDone), total: mb(s.bytesTotal) }));
			} else if (s.phase === 'error') {
				status.setText(t('index.error', { message: s.message }));
			} else if (s.phase === 'loading' || s.phase === 'indexing' || s.phase === 'ready') {
				this.close();
			}
		};
		this.unsubscribe = this.service.onChange(show);

		const input = contentEl.createEl('input', { type: 'file' });
		input.multiple = true;
		input.hide();
		input.addEventListener('change', () => {
			void (async () => {
				const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
				await this.onAccepted();
				const unknown = await this.service.importModelFiles(files);
				if (unknown.length > 0) new Notice(t('model.importUnknown', { names: unknown.join(', ') }));
			})();
		});

		new Setting(contentEl)
			.setDesc(t('model.importHint'))
			.addButton((b) =>
				b.setButtonText(t('model.importButton')).onClick(() => {
					input.click();
				}),
			)
			.addButton((b) =>
				b.setButtonText(t('model.cancel')).onClick(() => {
					this.service.cancelDownload();
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(t('model.downloadButton'))
					.setCta()
					.onClick(() => {
						b.setDisabled(true);
						void (async () => {
							await this.onAccepted();
							await this.service.downloadModel();
						})();
					}),
			);
	}

	override onClose(): void {
		this.unsubscribe?.();
		this.contentEl.empty();
	}
}

/** Confirms clearing the data of the plugin, with an option for the model. */
export class ClearDataModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly modelBytes: number,
		private readonly onConfirm: (models: boolean) => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		const { contentEl, t } = this;
		this.setTitle(t('clear.title'));
		contentEl.createEl('p', { text: t('clear.body') });
		let models = false;
		new Setting(contentEl).setName(t('clear.models', { mb: mb(this.modelBytes) })).addToggle((toggle) =>
			toggle.setValue(false).onChange((v) => {
				models = v;
			}),
		);
		new Setting(contentEl)
			.addButton((b) =>
				b.setButtonText(t('model.cancel')).onClick(() => {
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(t('clear.confirm'))
					// setDestructive() needs Obsidian 1.13; the class gives the same look.
					.setClass('mod-warning')
					.onClick(() => {
						void (async () => {
							await this.onConfirm(models);
							new Notice(t('clear.done'));
							this.close();
						})();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
