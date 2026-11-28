/**
 * Builds the core's neutral `NoteInput` from a note's content and Obsidian's metadata cache.
 * Pure: the caller passes the content, the cache and the file facts, so this is tested without
 * Obsidian. Offsets are shifted to the text without front matter.
 */
import type { NoteInput, SectionInput, SectionKind } from '@semanticatlas/core';

interface Position {
	start: { offset: number };
	end: { offset: number };
}

/** The parts of Obsidian's `CachedMetadata` used here. */
export interface CacheLike {
	frontmatterPosition?: Position | undefined;
	frontmatter?: Record<string, unknown> | undefined;
	sections?: { type: string; position: Position; id?: string | undefined }[] | undefined;
	headings?: { heading: string; level: number; position: Position }[] | undefined;
	links?: { link: string; displayText?: string | undefined; original: string; position: Position }[] | undefined;
	embeds?: { link: string; displayText?: string | undefined; original: string; position: Position }[] | undefined;
}

export interface NoteMeta {
	path: string;
	title: string;
	folder: string;
	ctime: number;
	mtime: number;
	/** All tags (front matter and inline), without '#'. */
	tags: string[];
	aliases: string[];
}

const QUERY_LANGUAGES = /^(?:query|dataview|dataviewjs|tasks|base)\b/;

const kindOf = (type: string, firstLine: string): SectionKind | null => {
	switch (type) {
		case 'yaml':
			return null;
		case 'heading':
			return 'heading';
		case 'paragraph':
		case 'text':
		case 'blockquote':
			return 'paragraph';
		case 'callout':
			return 'callout';
		case 'list':
			return 'list';
		case 'table':
			return 'table';
		case 'math':
			return 'math';
		case 'code':
			return QUERY_LANGUAGES.test(firstLine.replace(/^(`{3,}|~{3,})\s*/, '')) ? 'query' : 'code';
		default:
			return 'other';
	}
};

const parseDate = (value: unknown): number | undefined => {
	if (typeof value !== 'string' && typeof value !== 'number') return undefined;
	const t = typeof value === 'number' ? value : Date.parse(value);
	return Number.isFinite(t) ? t : undefined;
};

export function toNoteInput(meta: NoteMeta, content: string, cache: CacheLike | null, options: { dateProperty?: string }): NoteInput {
	const shift = cache?.frontmatterPosition?.end.offset ?? 0;
	const text = content.slice(shift);
	const local = (p: Position): { start: number; end: number } => ({ start: p.start.offset - shift, end: p.end.offset - shift });
	const headings = new Map((cache?.headings ?? []).map((h) => [h.position.start.offset, h]));

	const sections: SectionInput[] = [];
	for (const s of cache?.sections ?? []) {
		if (s.position.end.offset <= shift) continue;
		const { start, end } = local(s.position);
		const newline = text.indexOf('\n', start);
		const kind = kindOf(s.type, text.slice(start, newline < 0 || newline > end ? end : newline));
		if (!kind) continue;
		const section: SectionInput = { kind, start, end };
		if (kind === 'heading') {
			const h = headings.get(s.position.start.offset);
			if (h) {
				section.heading = h.heading;
				section.level = h.level;
			}
		}
		if (s.id) section.id = s.id;
		sections.push(section);
	}

	const spans = [
		...(cache?.links ?? []).map((l) => ({ ...local(l.position), display: l.displayText ?? l.link })),
		...(cache?.embeds ?? []).map((l) => ({ ...local(l.position), display: '' })),
	]
		.filter((s) => s.start >= 0)
		.sort((a, b) => a.start - b.start);

	const dates: NoteInput['dates'] = { created: meta.ctime, modified: meta.mtime };
	const dateSources: NonNullable<NoteInput['dateSources']> = { created: 'filesystem', modified: 'filesystem' };
	const property = options.dateProperty ? parseDate(cache?.frontmatter?.[options.dateProperty]) : undefined;
	if (property !== undefined) {
		dates.property = property;
		dateSources.property = 'property';
	}

	return {
		id: meta.path,
		title: meta.title,
		aliases: meta.aliases,
		folder: meta.folder,
		tags: meta.tags,
		dates,
		dateSources,
		properties: cache?.frontmatter ?? {},
		text,
		sections,
		linkSpans: spans,
	};
}
