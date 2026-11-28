/**
 * Reads the notes and their references from Obsidian's metadata cache. No Markdown is parsed
 * here: links, embeds and front-matter links come from `getFileCache`.
 */
import type { App } from 'obsidian';
import type { LinkResolver, SourceNote, SourceReference } from './collect';

export function readNotes(app: App): SourceNote[] {
	return app.vault.getMarkdownFiles().map((file) => {
		const cache = app.metadataCache.getFileCache(file);
		const references: SourceReference[] = [
			...(cache?.links ?? []).map((l) => ({ kind: 'link' as const, link: l.link, original: l.original })),
			...(cache?.embeds ?? []).map((l) => ({ kind: 'embed' as const, link: l.link, original: l.original })),
			...(cache?.frontmatterLinks ?? []).map((l) => ({ kind: 'property' as const, link: l.link, original: l.original })),
		];
		return { path: file.path, title: file.basename, references };
	});
}

export function linkResolver(app: App): LinkResolver {
	return (linkpath, sourcePath) => app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null;
}
