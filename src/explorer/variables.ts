/**
 * The variables of the explorer's "Colour by" and "Size by", for each note, from the analysis
 * and from facts read from the vault. Missing values are null (categories) or NaN (numbers),
 * never zero: the explorer shows them in grey.
 */
import { STOP_WORDS, precursor, recentActivity, tokenize, type AnalysisResult } from '@semanticatlas/core';

export type CategoryBy = 'cluster' | 'folder' | 'tag' | 'role';
export type NumberBy = 'bridge' | 'isolation' | 'precursor' | 'activity' | 'date' | 'relevance' | 'pagerank';
export type ColourBy = CategoryBy | NumberBy;
export type SizeBy = 'degree' | 'pagerank' | 'centrality' | 'activity' | 'fixed';

export const CATEGORY_BY: readonly CategoryBy[] = ['cluster', 'folder', 'tag', 'role'];
export const NUMBER_BY: readonly NumberBy[] = ['bridge', 'isolation', 'precursor', 'activity', 'date', 'relevance', 'pagerank'];
export const SIZE_BY: readonly SizeBy[] = ['degree', 'pagerank', 'centrality', 'activity', 'fixed'];

export const isCategory = (x: ColourBy): x is CategoryBy => (CATEGORY_BY as readonly string[]).includes(x);

/** What the vault says about a note. */
export interface NoteFacts {
	folder: string;
	tags: string[];
	/** Date from the chosen source (undefined: no date). */
	date: number | undefined;
	modified: number;
	/** Explicit links in or out, other notes counted once. */
	degree: number;
}

export interface VariableContext {
	result: Pick<AnalysisResult, 'clusters' | 'notes' | 'knn'>;
	facts: ReadonlyMap<string, NoteFacts>;
	now: number;
	/** Recent activity: the last `activityDays` days (default 30). */
	activityDays?: number;
	/** Below this number of dated neighbours, no activity nor precursor value (default 3). */
	minDated?: number;
	/** Relevance centile of each note on the interest axes, when axes are declared. */
	relevance?: ReadonlyMap<string, number>;
}

/** Neighbour ids of each note, from the analysis's kNN (in the order of `result.notes`). */
function neighbourIds(ctx: VariableContext): Map<string, string[]> {
	const order = [...ctx.result.notes.keys()];
	const { k, neighbours } = ctx.result.knn;
	return new Map(order.map((id, i) => [id, Array.from(neighbours.subarray(i * k, (i + 1) * k), (j) => order[j]!)]));
}

export function categoryValues(by: CategoryBy, ids: readonly string[], ctx: VariableContext): (string | null)[] {
	if (by === 'cluster') {
		const names = new Map(ctx.result.clusters.map((c) => [c.id, c.name]));
		return ids.map((id) => {
			const n = ctx.result.notes.get(id);
			return n ? (names.get(n.cluster) ?? null) : null;
		});
	}
	if (by === 'folder') return ids.map((id) => ctx.facts.get(id)?.folder || null);
	if (by === 'role') return ids.map((id) => ctx.result.notes.get(id)?.role ?? null);
	// Main tag: the note's tag used by the most notes of the vault.
	const counts = new Map<string, number>();
	for (const f of ctx.facts.values()) for (const t of new Set(f.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
	return ids.map((id) => {
		const tags = ctx.facts.get(id)?.tags ?? [];
		if (tags.length === 0) return null;
		return [...tags].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1))[0]!;
	});
}

export function numericValues(by: NumberBy, ids: readonly string[], ctx: VariableContext): number[] {
	const { notes } = ctx.result;
	const minDated = ctx.minDated ?? 3;
	switch (by) {
		case 'pagerank':
			return ids.map((id) => notes.get(id)?.pagerank ?? Number.NaN);
		case 'bridge':
			return ids.map((id) => notes.get(id)?.participation ?? Number.NaN);
		case 'isolation':
			return ids.map((id) => notes.get(id)?.isolationCentile ?? Number.NaN);
		case 'date':
			return ids.map((id) => ctx.facts.get(id)?.date ?? Number.NaN);
		case 'relevance':
			return ids.map((id) => ctx.relevance?.get(id) ?? Number.NaN);
		case 'activity': {
			const near = neighbourIds(ctx);
			const modified = new Map([...ctx.facts].map(([id, f]) => [id, f.modified]));
			return ids.map((id) => recentActivity(near.get(id) ?? [], modified, ctx.now, ctx.activityDays ?? 30, minDated).value ?? Number.NaN);
		}
		case 'precursor': {
			const near = neighbourIds(ctx);
			const dates = new Map<string, number>();
			for (const [id, f] of ctx.facts) if (f.date !== undefined) dates.set(id, f.date);
			const sorted = Float64Array.from(dates.values()).sort();
			return ids.map((id) => precursor(id, near.get(id) ?? [], dates, sorted, minDated)?.excess ?? Number.NaN);
		}
	}
}

/** Raw values for "Size by"; null for a fixed size. */
export function sizeValues(by: SizeBy, ids: readonly string[], ctx: VariableContext): number[] | null {
	switch (by) {
		case 'fixed':
			return null;
		case 'degree':
			return ids.map((id) => ctx.facts.get(id)?.degree ?? Number.NaN);
		case 'pagerank':
			return numericValues('pagerank', ids, ctx);
		case 'centrality':
			return ids.map((id) => ctx.result.notes.get(id)?.centrality ?? Number.NaN);
		case 'activity':
			return numericValues('activity', ids, ctx);
	}
}

/**
 * Words found in both texts, rarest in the vault first (`docFreq`: notes containing each word,
 * out of `docCount`); stop words, numbers and one-letter words are left out.
 */
export function sharedWords(a: string, b: string, docFreq: ReadonlyMap<string, number>, docCount: number, max = 6): string[] {
	const words = (text: string): Set<string> => new Set(tokenize(text).filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)));
	const wb = words(b);
	return [...words(a)]
		.filter((w) => wb.has(w))
		.sort((x, y) => (docFreq.get(x) ?? docCount) - (docFreq.get(y) ?? docCount) || (x < y ? -1 : 1))
		.slice(0, max);
}
