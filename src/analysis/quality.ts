/**
 * The "Quality of the analysis" panel: the measures of a run and indicative verdicts. The
 * thresholds are rules of thumb, not tests: they are shown as such.
 */
import type { AnalysisResult } from '@semanticatlas/core';

export type Level = 'weak' | 'fair' | 'good';

export interface QualityReport {
	notes: number;
	clusters: number;
	/** Modularity of the semantic graph: below 0.3 the clusters are weakly separated. */
	modularity: { value: number; level: Level };
	/** Mean silhouette (cosine) of the notes; low values are usual with text embeddings. */
	silhouette: { value: number; level: Level };
	/** Clusters whose runs disagree (stability below 0.6). */
	unstable: number[];
	meanStability: number;
	hubs: { skewness: number; correction: AnalysisResult['hubCorrection']; k: number };
	nearDuplicates: number;
	mergedClusters: number;
	/** Notes farthest from any other, the most isolated first. */
	mostIsolated: { id: string; isolation: number }[];
}

export const UNSTABLE = 0.6;

const grade = (x: number, fair: number, good: number): Level => (x >= good ? 'good' : x >= fair ? 'fair' : 'weak');

export function qualityReport(result: AnalysisResult, isolatedCount = 10): QualityReport {
	const notes = [...result.notes.entries()];
	const total = result.clusters.reduce((s, c) => s + c.size, 0);
	return {
		notes: notes.length,
		clusters: result.clusters.length,
		modularity: { value: result.quality.modularity, level: grade(result.quality.modularity, 0.3, 0.5) },
		silhouette: { value: result.quality.silhouette, level: grade(result.quality.silhouette, 0.05, 0.15) },
		unstable: result.clusters.filter((c) => c.stability < UNSTABLE).map((c) => c.id),
		meanStability: total > 0 ? result.clusters.reduce((s, c) => s + c.stability * c.size, 0) / total : 0,
		hubs: { skewness: result.hubSkewness, correction: result.hubCorrection, k: result.k },
		nearDuplicates: result.nearDuplicates.length,
		mergedClusters: result.quality.mergedClusters,
		mostIsolated: notes
			.map(([id, n]) => ({ id, isolation: n.isolation }))
			.sort((a, b) => b.isolation - a.isolation || (a.id < b.id ? -1 : 1))
			.slice(0, isolatedCount),
	};
}
