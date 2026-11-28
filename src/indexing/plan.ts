/** Pure decisions of the indexing service: what to index, and in which order. */
import type { IndexSettings } from '../settings/schema';

/** True when a note is left out of the semantic index. */
export function isExcluded(path: string, tags: readonly string[], settings: IndexSettings, configDir = ''): boolean {
	if (configDir && (path === configDir || path.startsWith(`${configDir}/`))) return true;
	for (const folder of settings.excludeFolders) {
		const f = folder.replace(/\/+$/, '');
		if (f && (path === f || path.startsWith(`${f}/`))) return true;
	}
	for (const tag of tags) {
		for (const excluded of settings.excludeTags) {
			const e = excluded.replace(/^#/, '');
			if (e && (tag === e || tag.startsWith(`${e}/`))) return true;
		}
	}
	return false;
}

export interface Plan {
	/** Notes to embed, the active note first, then the most recently modified. */
	toEmbed: string[];
	/** Indexed notes that no longer exist (or are now excluded). */
	toDelete: string[];
	unchanged: number;
}

export function planWork(indexed: ReadonlyMap<string, string>, files: readonly { id: string; hash: string; mtime: number }[], activeId: string | null): Plan {
	const present = new Set(files.map((f) => f.id));
	const stale = files.filter((f) => indexed.get(f.id) !== f.hash);
	stale.sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : b.mtime - a.mtime || (a.id < b.id ? -1 : 1)));
	return {
		toEmbed: stale.map((f) => f.id),
		toDelete: [...indexed.keys()].filter((id) => !present.has(id)).sort(),
		unchanged: files.length - stale.length,
	};
}

/** Identifies what changes the vectors: the model and the text-preparation settings. */
export function settingsHash(s: IndexSettings, modelSha256: string): string {
	return JSON.stringify([modelSha256, s.titleWeight, s.maxChunkTokens, s.overlapTokens, s.minTokens, s.includeCode]);
}
