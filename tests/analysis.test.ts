import { describe, expect, it } from 'vitest';
import type { AnalysisResult, ClusterInfo, NoteAnalysis } from '@semanticatlas/core';
import { applyNames, autoName, nameCluster, toPrevious, toSnapshot } from '../src/analysis/snapshot';
import { qualityReport } from '../src/analysis/quality';
import { axisTable, growthTable } from '../src/analysis/tables';
import { docOf } from '../src/analysis/docs';

const note = (cluster: number, extra: Partial<NoteAnalysis> = {}): NoteAnalysis => ({
	cluster,
	stability: 1,
	role: 'core',
	participation: 0,
	withinModuleZ: 0,
	centrality: 0.5,
	isolation: 0.1,
	isolationCentile: 50,
	pagerank: 0,
	betweenness: 0,
	coreNumber: 0,
	articulation: false,
	x: 0,
	y: 0,
	...extra,
});

const cluster = (id: number, members: string[], extra: Partial<ClusterInfo> = {}): ClusterInfo => ({
	id,
	name: `auto ${id}`,
	manual: false,
	terms: [],
	size: members.length,
	stability: 0.9,
	conductance: 0.1,
	silhouette: 0.1,
	members,
	...extra,
});

const result = (): AnalysisResult => ({
	k: 5,
	hubSkewness: 1.4,
	hubCorrection: 'localScaling',
	clusters: [cluster(0, ['a.md', 'b.md']), cluster(7, ['c.md'], { name: 'Mine', manual: true, stability: 0.4 })],
	notes: new Map([
		['a.md', note(0, { x: 1, y: 2, isolation: 0.3 })],
		['b.md', note(0, { x: 3, y: 4, isolation: 0.05 })],
		['c.md', note(7, { x: Number.NaN, y: Number.NaN, isolation: 0.6 })],
	]),
	nearDuplicates: [{ a: 'a.md', b: 'b.md', similarity: 0.98 }],
	quality: { modularity: 0.42, silhouette: 0.08, clusterCount: 2, sizes: [2, 1], mergedClusters: 1 },
	similarityCentiles: new Float64Array(101),
});

describe('snapshot', () => {
	it('keeps clusters, names and finite positions', () => {
		const s = toSnapshot(result(), 123);
		expect(s.createdAt).toBe(123);
		expect(s.clusterOf).toEqual({ 'a.md': 0, 'b.md': 0, 'c.md': 7 });
		expect(s.positions).toEqual({ 'a.md': [1, 2], 'b.md': [3, 4] });
		expect(s.clusters).toEqual([
			{ id: 0, name: 'auto 0', manual: false, members: ['a.md', 'b.md'] },
			{ id: 7, name: 'Mine', manual: true, members: ['c.md'] },
		]);
	});

	it('gives the previous run to the pipeline, with the keyword names only', () => {
		const p = toPrevious(toSnapshot(result(), 1));
		expect(p.clusterOf.get('b.md')).toBe(0);
		expect(p.positions?.get('a.md')).toEqual([1, 2]);
		expect(p.named.map((n) => ({ name: n.name, manual: n.manual, members: [...n.members] }))).toEqual([{ name: 'auto 0', manual: false, members: ['a.md', 'b.md'] }]);
		expect(toPrevious(null).named).toEqual([]);
	});

	it('rebuilds the keyword name from the terms', () => {
		expect(autoName(['jazz', 'bebop', 'swing'])).toBe('Jazz, bebop');
		expect(autoName([])).toBe('');
	});
});

describe('names given by hand', () => {
	const big = (): AnalysisResult => {
		const r = result();
		r.clusters = [
			cluster(1, ['a', 'b', 'c', 'd', 'e', 'f'], { terms: ['jazz', 'bebop'], name: 'Jazz, bebop' }),
			cluster(2, ['g', 'h', 'i'], { terms: ['plantes'], name: 'Plantes' }),
		];
		r.notes = new Map([...'abcdefghi'].map((id, i) => [id, note(i < 6 ? 1 : 2)]));
		return r;
	};

	it('names a cluster after its most central notes', () => {
		const r = big();
		const names = nameCluster(r, 1, 'Music', []);
		expect(names).toEqual([{ name: 'Music', anchors: ['a', 'b', 'c', 'd', 'e'] }]);
		expect(r.clusters[0]).toMatchObject({ name: 'Music', manual: true });
	});

	it('replaces the name of the same cluster, and gives back the keyword name when empty', () => {
		const r = big();
		let names = nameCluster(r, 1, 'Music', []);
		names = nameCluster(r, 1, 'Jazz', names);
		expect(names.map((n) => n.name)).toEqual(['Jazz']);
		names = nameCluster(r, 1, '  ', names);
		expect(names).toEqual([]);
		expect(r.clusters[0]).toMatchObject({ name: 'Jazz, bebop', manual: false });
	});

	it('finds the cluster holding most of the anchors, whatever its identifier (another device, data cleared)', () => {
		const r = big();
		const out = applyNames(r, [{ name: 'Garden', anchors: ['g', 'h', 'x'] }, { name: 'Music', anchors: ['a', 'b', 'c', 'g', 'h'] }]);
		expect(r.clusters.map((c) => [c.name, c.manual])).toEqual([
			['Music', true],
			['Garden', true],
		]);
		// Anchors follow the cluster's current most central notes.
		expect(out).toEqual([
			{ name: 'Garden', anchors: ['g', 'h', 'i'] },
			{ name: 'Music', anchors: ['a', 'b', 'c', 'd', 'e'] },
		]);
	});

	it('keeps a name whose anchors are not analysed yet, drops one whose theme split', () => {
		const r = big();
		const out = applyNames(r, [
			{ name: 'Later', anchors: ['p', 'q', 'r'] },
			{ name: 'Split', anchors: ['a', 'g', 'z'] },
		]);
		expect(out).toEqual([{ name: 'Later', anchors: ['p', 'q', 'r'] }]);
		expect(r.clusters.every((c) => !c.manual)).toBe(true);
	});

	it('gives a cluster only one name, the one with the most anchors in it', () => {
		const r = big();
		applyNames(r, [{ name: 'Few', anchors: ['a', 'b', 'g'] }, { name: 'Many', anchors: ['a', 'b', 'c', 'd'] }]);
		expect(r.clusters[0]!.name).toBe('Many');
	});
});

describe('qualityReport', () => {
	it('summarises the measures with indicative verdicts', () => {
		const q = qualityReport(result());
		expect(q.notes).toBe(3);
		expect(q.clusters).toBe(2);
		expect(q.modularity).toEqual({ value: 0.42, level: 'fair' });
		expect(q.silhouette).toEqual({ value: 0.08, level: 'fair' });
		expect(q.unstable).toEqual([7]);
		expect(q.hubs).toEqual({ skewness: 1.4, correction: 'localScaling', k: 5 });
		expect(q.nearDuplicates).toBe(1);
		expect(q.mergedClusters).toBe(1);
		expect(q.mostIsolated.map((n) => n.id)).toEqual(['c.md', 'a.md', 'b.md']);
	});

	it('grades modularity and silhouette', () => {
		const r = result();
		r.quality.modularity = 0.2;
		r.quality.silhouette = 0.2;
		expect(qualityReport(r).modularity.level).toBe('weak');
		expect(qualityReport(r).silhouette.level).toBe('good');
		r.quality.modularity = 0.6;
		r.quality.silhouette = 0.01;
		expect(qualityReport(r).modularity.level).toBe('good');
		expect(qualityReport(r).silhouette.level).toBe('weak');
	});
});

describe('growthTable', () => {
	it('counts notes per cluster and per period, largest clusters first', () => {
		const day = 86_400_000;
		const jan = Date.UTC(2024, 0, 10);
		const t = growthTable(result(), new Map([['a.md', jan], ['b.md', jan + 40 * day]]), 'month');
		expect(t.periods).toEqual(['2024-01', '2024-02']);
		expect(t.rows).toEqual([
			{ cluster: 0, name: 'auto 0', counts: [1, 1], undated: 0 },
			{ cluster: 7, name: 'Mine', counts: [0, 0], undated: 1 },
		]);
		expect(t.max).toBe(1);
	});
});

describe('axisTable', () => {
	it('gives the mean centile of each cluster on each axis and the closest notes of each axis', () => {
		const v = (...x: number[]): Float32Array => Float32Array.from(x);
		const vectors = new Map([
			['a.md', v(1, 0)],
			['b.md', v(0.8, 0.6)],
			['c.md', v(0, 1)],
		]);
		const t = axisTable(result(), vectors, [
			{ id: 'x', vector: v(1, 0) },
			{ id: 'y', vector: v(0, 1) },
		], 2);
		expect(t.axes).toEqual(['x', 'y']);
		expect(t.rows[0]!.cluster).toBe(0);
		expect(t.rows[0]!.centiles[0]!).toBeGreaterThan(t.rows[1]!.centiles[0]!);
		expect(t.rows[1]!.centiles[1]!).toBeGreaterThan(t.rows[0]!.centiles[1]!);
		expect(t.top.get('x')!.map((h) => h.id)).toEqual(['a.md', 'b.md']);
		expect(t.top.get('y')!.map((h) => h.id)).toEqual(['c.md', 'b.md']);
		expect(t.nearest.get('x')).toBe(2);
		expect(t.nearest.get('y')).toBe(1);
	});
});

describe('docOf', () => {
	it('keeps title, headings, tags and a bounded cleaned text', () => {
		const d = docOf('Title', { headings: [{ heading: 'Intro' }], tags: [{ tag: '#music/jazz' }], frontmatter: { tags: ['bebop'] } }, '# Intro\n\nSome **bold** text', 12);
		expect(d.title).toBe('Title');
		expect(d.headings).toEqual(['Intro']);
		expect(d.tags).toEqual(['music/jazz', 'bebop']);
		expect(d.text!.length).toBeLessThanOrEqual(12);
		expect(d.text).not.toContain('**');
	});
});
