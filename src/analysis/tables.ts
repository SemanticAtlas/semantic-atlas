/** Tables of the landscape view: clusters over time, clusters against the interest axes. */
import { clusterGrowth, scoreAxes, type AnalysisResult, type Axis, type Period } from '@semanticatlas/core';

export interface GrowthTable {
	periods: string[];
	rows: { cluster: number; name: string; counts: number[]; undated: number }[];
	/** Largest count, to scale the bars. */
	max: number;
}

export function growthTable(result: AnalysisResult, dates: ReadonlyMap<string, number>, period: Period): GrowthTable {
	const of = new Map([...result.notes].map(([id, n]) => [id, n.cluster]));
	const g = clusterGrowth(of, dates, period);
	const rows = result.clusters.map((c) => ({
		cluster: c.id,
		name: c.name,
		counts: g.counts.get(c.id) ?? new Array<number>(g.periods.length).fill(0),
		undated: g.undated.get(c.id) ?? 0,
	}));
	return { periods: g.periods, rows, max: Math.max(0, ...rows.flatMap((r) => r.counts)) };
}

export interface AxisTable {
	axes: string[];
	/** Mean centile (0 to 100) of the cluster's notes on each axis, in the order of the axes. */
	rows: { cluster: number; name: string; centiles: number[] }[];
	/** Notes closest to each axis, best first. */
	top: Map<string, { id: string; score: number; centile: number }[]>;
	/** Notes whose closest axis is this one. */
	nearest: Map<string, number>;
}

export function axisTable(result: AnalysisResult, vectors: ReadonlyMap<string, Float32Array>, axes: readonly Axis[], topCount = 8): AxisTable {
	const scored = scoreAxes(vectors, axes);
	const rows = result.clusters.map((c) => {
		const centiles = axes.map((_, k) => {
			let sum = 0;
			let n = 0;
			for (const id of c.members) {
				const s = scored.notes.get(id);
				if (s) {
					sum += s.centiles[k]!;
					n++;
				}
			}
			return n > 0 ? sum / n : 0;
		});
		return { cluster: c.id, name: c.name, centiles };
	});
	const top = new Map(
		axes.map((a, k) => [
			a.id,
			[...scored.notes]
				.map(([id, s]) => ({ id, score: s.scores[k]!, centile: s.centiles[k]! }))
				.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1))
				.slice(0, topCount),
		]),
	);
	return { axes: axes.map((a) => a.id), rows, top, nearest: scored.countByAxis };
}
