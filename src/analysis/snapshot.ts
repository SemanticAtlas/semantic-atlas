/**
 * What is kept between two analyses (in the vault's index database, on this device) so that
 * cluster identifiers, names and map positions stay stable. Names given by hand live in the
 * settings (synced with the vault) with a few anchor notes, since identifiers are local.
 */
import type { AnalysisResult, AnalysisSnapshot, ClusterInfo, PreviousAnalysis } from '@semanticatlas/core';
import type { ManualName } from '../settings/schema';

export function toSnapshot(result: AnalysisResult, createdAt: number): AnalysisSnapshot {
	const clusterOf: Record<string, number> = {};
	const positions: Record<string, [number, number]> = {};
	for (const [id, n] of result.notes) {
		clusterOf[id] = n.cluster;
		if (Number.isFinite(n.x) && Number.isFinite(n.y)) positions[id] = [n.x, n.y];
	}
	return {
		createdAt,
		clusterOf,
		positions,
		clusters: result.clusters.map((c) => ({ id: c.id, name: c.name, manual: c.manual, members: [...c.members] })),
	};
}

/** The previous run as the pipeline expects it; only keyword names are carried (names given by hand follow their anchors). */
export function toPrevious(snapshot: AnalysisSnapshot | null): PreviousAnalysis {
	if (!snapshot) return { clusterOf: new Map(), named: [] };
	return {
		clusterOf: new Map(Object.entries(snapshot.clusterOf)),
		positions: new Map(Object.entries(snapshot.positions)),
		named: snapshot.clusters.filter((c) => !c.manual).map((c) => ({ members: new Set(c.members), name: c.name, manual: false })),
	};
}

/** Notes that identify a cluster named by hand: its most central notes when it was named. */
export const ANCHORS = 5;

const anchorsOf = (c: ClusterInfo): string[] => c.members.slice(0, ANCHORS);

/**
 * The cluster a name given by hand belongs to: the one holding a strict majority of its anchors
 * still analysed. `undefined` when none of its anchors is analysed (yet), `null` when they are
 * spread over several clusters (the theme split).
 */
function home(result: AnalysisResult, name: ManualName): { cluster: ClusterInfo; count: number } | null | undefined {
	const present = name.anchors.filter((id) => result.notes.has(id));
	if (present.length === 0) return undefined;
	const counts = new Map<number, number>();
	for (const id of present) {
		const c = result.notes.get(id)!.cluster;
		counts.set(c, (counts.get(c) ?? 0) + 1);
	}
	for (const [id, count] of counts) {
		if (count * 2 > present.length) {
			const cluster = result.clusters.find((c) => c.id === id);
			return cluster ? { cluster, count } : null;
		}
	}
	return null;
}

/**
 * Gives the clusters of a new run their names given by hand. Identifiers differ from one device
 * to another and after the data is cleared, so a name follows its anchors, not an identifier.
 * Returns the names to save: anchors refreshed, names of split or merged themes dropped, names
 * whose notes are not analysed yet kept as they are.
 */
export function applyNames(result: AnalysisResult, names: readonly ManualName[]): ManualName[] {
	const claims = names.map((n) => home(result, n));
	const winner = new Map<number, number>();
	claims.forEach((claim, i) => {
		if (!claim) return;
		const best = winner.get(claim.cluster.id);
		if (best === undefined || claim.count > claims[best]!.count) winner.set(claim.cluster.id, i);
	});
	const out: ManualName[] = [];
	names.forEach((n, i) => {
		const claim = claims[i];
		if (claim === undefined) {
			out.push(n);
			return;
		}
		if (claim === null || winner.get(claim.cluster.id) !== i) return;
		claim.cluster.name = n.name;
		claim.cluster.manual = true;
		out.push({ name: n.name, anchors: anchorsOf(claim.cluster) });
	});
	return out;
}

/** Names a cluster by hand, or gives it back its keyword name when `name` is blank. */
export function nameCluster(result: AnalysisResult, clusterId: number, name: string, names: readonly ManualName[]): ManualName[] {
	const cluster = result.clusters.find((c) => c.id === clusterId);
	if (!cluster) return [...names];
	const others = names.filter((n) => home(result, n)?.cluster.id !== clusterId);
	const trimmed = name.trim();
	cluster.manual = trimmed !== '';
	cluster.name = trimmed === '' ? autoName(cluster.terms) : trimmed;
	return trimmed === '' ? others : [...others, { name: trimmed, anchors: anchorsOf(cluster) }];
}

/** The keyword name of a cluster, as the pipeline builds it (first two terms). */
export function autoName(terms: readonly string[]): string {
	const first = terms.slice(0, 2).join(', ');
	return first ? first.charAt(0).toLocaleUpperCase() + first.slice(1) : '';
}
