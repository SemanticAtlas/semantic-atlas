/** Which notes a sub-map shows: a cluster, a folder, a tag, the notes shown, or a drift path. */
import type { NoteFacts } from './variables';

export type SubmapKind = 'cluster' | 'folder' | 'tag' | 'shown' | 'path';
export const SUBMAP_KINDS: readonly SubmapKind[] = ['cluster', 'folder', 'tag', 'shown', 'path'];
export const SUBMAP_MIN = 20;
export const SUBMAP_MAX = 2000;

export interface SubmapSource {
	selected: string | null;
	result: { clusters: readonly { id: number; name: string; members: readonly string[] }[]; notes: ReadonlyMap<string, { cluster: number }> };
	facts: ReadonlyMap<string, NoteFacts>;
	/** Notes currently shown (filter and legend applied). */
	shown?: readonly string[];
	/** Notes of the drift path. */
	path?: readonly string[];
	/** Label of the "shown" or "path" sub-map. */
	label?: string;
}

export type Subset = { ids: string[]; label: string } | { error: 'noSelection' | 'tooFew' | 'tooMany'; count?: number };

export function subsetFor(kind: SubmapKind, src: SubmapSource): Subset {
	let ids: string[];
	let label: string;
	if (kind === 'shown' || kind === 'path') {
		ids = [...new Set(kind === 'shown' ? (src.shown ?? []) : (src.path ?? []))];
		label = src.label ?? '';
	} else {
		const sel = src.selected;
		if (!sel || !src.result.notes.has(sel)) return { error: 'noSelection' };
		if (kind === 'cluster') {
			const c = src.result.clusters.find((x) => x.id === src.result.notes.get(sel)!.cluster);
			ids = c ? [...c.members] : [];
			label = c?.name ?? '';
		} else if (kind === 'folder') {
			const folder = src.facts.get(sel)?.folder ?? '';
			ids = [...src.result.notes.keys()].filter((id) => (src.facts.get(id)?.folder ?? '') === folder);
			label = folder || '/';
		} else {
			// The note's tag used by the most notes.
			const counts = new Map<string, number>();
			for (const f of src.facts.values()) for (const t of new Set(f.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
			const tags = src.facts.get(sel)?.tags ?? [];
			if (tags.length === 0) return { error: 'tooFew', count: 0 };
			const tag = [...tags].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1))[0]!;
			ids = [...src.result.notes.keys()].filter((id) => src.facts.get(id)?.tags.includes(tag));
			label = `#${tag}`;
		}
	}
	if (ids.length < SUBMAP_MIN) return { error: 'tooFew', count: ids.length };
	if (ids.length > SUBMAP_MAX) return { error: 'tooMany', count: ids.length };
	return { ids, label };
}
