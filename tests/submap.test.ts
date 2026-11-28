import { describe, expect, it } from 'vitest';
import { subsetFor, SUBMAP_MAX, SUBMAP_MIN } from '../src/explorer/submap';
import type { NoteFacts } from '../src/explorer/variables';

const n = 30;
const ids = Array.from({ length: n }, (_, i) => `n${i}`);
const result = {
	clusters: [
		{ id: 1, name: 'Big', members: ids.slice(0, 25) },
		{ id: 2, name: 'Small', members: ids.slice(25) },
	],
	notes: new Map(ids.map((id, i) => [id, { cluster: i < 25 ? 1 : 2 }])),
};
const facts = new Map<string, NoteFacts>(ids.map((id, i) => [id, { folder: i < 22 ? 'A' : 'B', tags: i < 21 ? ['x', 'y'] : ['y'], date: undefined, modified: 0, degree: 0 }]));

describe('subsetFor', () => {
	it('takes the cluster, folder or main tag of the selected note', () => {
		expect(subsetFor('cluster', { selected: 'n0', result, facts })).toEqual({ ids: ids.slice(0, 25), label: 'Big' });
		expect(subsetFor('folder', { selected: 'n0', result, facts })).toEqual({ ids: ids.slice(0, 22), label: 'A' });
		// Main tag of n0: y (used by all notes) rather than x.
		expect(subsetFor('tag', { selected: 'n0', result, facts })).toEqual({ ids, label: '#y' });
	});

	it('takes the notes shown or the drift path', () => {
		expect(subsetFor('shown', { selected: null, result, facts, shown: ids.slice(3, 24), label: 'jazz' })).toEqual({ ids: ids.slice(3, 24), label: 'jazz' });
		expect(subsetFor('path', { selected: null, result, facts, path: ids.slice(0, 20), label: 'Drift' })).toEqual({ ids: ids.slice(0, 20), label: 'Drift' });
	});

	it('refuses without selection, below the minimum and above the maximum', () => {
		expect(subsetFor('cluster', { selected: null, result, facts })).toEqual({ error: 'noSelection' });
		expect(subsetFor('cluster', { selected: 'n29', result, facts })).toEqual({ error: 'tooFew', count: 5 });
		expect(subsetFor('shown', { selected: null, result, facts, shown: Array.from({ length: SUBMAP_MAX + 1 }, (_, i) => `x${i}`) })).toEqual({ error: 'tooMany', count: SUBMAP_MAX + 1 });
		expect(SUBMAP_MIN).toBe(20);
	});
});
