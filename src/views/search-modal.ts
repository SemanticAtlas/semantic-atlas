import { Notice, SuggestModal, TFile, type App } from 'obsidian';
import type { IndexingService, NoteHit } from '../indexing/service';
import type { Translate } from '../i18n';

interface Suggestion extends NoteHit {
	title: string;
	excerpt: string;
}

/** Search by meaning (hybrid: passages by meaning and words, fused by rank). */
export class SemanticSearchModal extends SuggestModal<Suggestion> {
	private last = 0;

	constructor(
		app: App,
		private readonly service: IndexingService,
		private readonly t: Translate,
	) {
		super(app);
		this.setPlaceholder(t('search.placeholder'));
		this.emptyStateText = t('related.empty');
	}

	async getSuggestions(query: string): Promise<Suggestion[]> {
		if (!this.service.isReady()) {
			this.emptyStateText = this.t('search.notReady');
			return [];
		}
		const ticket = ++this.last;
		// Wait for the typing to settle.
		await new Promise((resolve) => window.setTimeout(resolve, 250));
		if (ticket !== this.last || !query.trim()) return [];
		const hits = await this.service.search(query, 20);
		return Promise.all(
			hits.map(async (h) => ({
				...h,
				title: this.app.vault.getFileByPath(h.id)?.basename ?? h.id,
				excerpt: h.passage ? await this.service.passageText(h.id, h.passage, 200) : '',
			})),
		);
	}

	renderSuggestion(s: Suggestion, el: HTMLElement): void {
		el.addClass('semantic-atlas-suggestion');
		el.createDiv({ cls: 'semantic-atlas-suggestion-title', text: s.title });
		if (s.passage && s.passage.headings.length > 0) el.createDiv({ cls: 'semantic-atlas-suggestion-path', text: s.passage.headings.join(' › ') });
		if (s.excerpt) el.createDiv({ cls: 'semantic-atlas-suggestion-excerpt', text: s.excerpt });
	}

	onChooseSuggestion(s: Suggestion): void {
		const file = this.app.vault.getFileByPath(s.id);
		if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file);
		else new Notice(s.id);
	}
}
