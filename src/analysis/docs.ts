/** What the cluster names are computed from, for one note. */
import { cleanMarkdown, type ClusterDocs } from '@semanticatlas/core';

export type NoteDoc = ClusterDocs['docs'][number];

/** The parts of Obsidian's `CachedMetadata` used here. */
export interface DocCache {
	headings?: { heading: string }[] | undefined;
	tags?: { tag: string }[] | undefined;
	frontmatter?: Record<string, unknown> | undefined;
}

const frontmatterTags = (fm: Record<string, unknown> | undefined): string[] => {
	const raw = fm?.tags ?? fm?.tag;
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
	return list.filter((t): t is string => typeof t === 'string' && t !== '');
};

/** Title, headings, tags and the start of the cleaned text (at most `maxText` characters). */
export function docOf(title: string, cache: DocCache | null, content: string, maxText = 4000): NoteDoc {
	const tags = [...(cache?.tags ?? []).map((t) => t.tag), ...frontmatterTags(cache?.frontmatter)].map((t) => t.replace(/^#/, ''));
	return {
		title,
		headings: (cache?.headings ?? []).map((h) => h.heading),
		tags: [...new Set(tags)],
		text: cleanMarkdown(content).slice(0, maxText),
	};
}
