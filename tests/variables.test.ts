import { describe, expect, it } from 'vitest';
import type { AnalysisResult, NoteAnalysis } from '@semanticatlas/core';
import { categoryValues, numericValues, sizeValues, sharedWords, type NoteFacts } from '../src/explorer/variables';

const note = (cluster: number, extra: Partial<NoteAnalysis> = {}): NoteAnalysis => ({
	cluster, stability: 1, role: 'core', participation: 0, withinModuleZ: 0, centrality: 0.5, isolation: 0.1, isolationCentile: 50,
	pagerank: 0.1, betweenness: 0, coreNumber: 0, articulation: false, x: 0, y: 0, ...extra,
});

const ids = ['a', 'b', 'c', 'd'];
const result = {
	clusters: [{ id: 3, name: 'Jazz', members: ['a', 'b'] }, { id: 5, name: 'Bread', members: ['c', 'd'] }],
	notes: new Map([
		['a', note(3, { role: 'connector', participation: 0.6, pagerank: 0.4, isolationCentile: 90, centrality: 0.9 })],
		['b', note(3, { pagerank: 0.2 })],
		['c', note(5, { role: 'peripheral' })],
		['d', note(5)],
	]),
	// Each note's 3 neighbours: the three others.
	knn: { k: 3, neighbours: Uint32Array.from([1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2]), similarities: new Float32Array(12).fill(0.5) },
} as unknown as AnalysisResult;

const DAY = 86_400_000;
const now = 1000 * DAY;
const facts = new Map<string, NoteFacts>([
	['a', { folder: 'Music', tags: ['jazz', 'music'], date: 10 * DAY, modified: now - DAY, degree: 3 }],
	['b', { folder: 'Music', tags: ['jazz'], date: 20 * DAY, modified: now - 2 * DAY, degree: 1 }],
	['c', { folder: '', tags: [], date: undefined, modified: now - 100 * DAY, degree: 0 }],
	['d', { folder: 'Food', tags: ['music'], date: 30 * DAY, modified: now - 3 * DAY, degree: 2 }],
]);
const ctx = { result, facts, now, activityDays: 30, minDated: 2 };

describe('categoryValues', () => {
	it('gives the cluster name, folder, main tag and role of each note; missing values are null', () => {
		expect(categoryValues('cluster', ids, ctx)).toEqual(['Jazz', 'Jazz', 'Bread', 'Bread']);
		expect(categoryValues('folder', ids, ctx)).toEqual(['Music', 'Music', null, 'Food']);
		// Main tag: the note's tag used by the most notes of the vault (tie: alphabetical).
		expect(categoryValues('tag', ids, ctx)).toEqual(['jazz', 'jazz', null, 'music']);
		expect(categoryValues('role', ids, ctx)).toEqual(['connector', 'core', 'peripheral', 'core']);
	});
});

describe('numericValues', () => {
	it('reads the measures of the analysis', () => {
		expect(numericValues('pagerank', ids, ctx)).toEqual([0.4, 0.2, 0.1, 0.1]);
		expect(numericValues('bridge', ids, ctx)).toEqual([0.6, 0, 0, 0]);
		expect(numericValues('isolation', ids, ctx)).toEqual([90, 50, 50, 50]);
	});

	it('gives dates, missing ones as NaN, never zero', () => {
		const d = numericValues('date', ids, ctx);
		expect(d[0]).toBe(10 * DAY);
		expect(Number.isNaN(d[2])).toBe(true);
	});

	it('computes recent activity among the neighbours, NaN below the minimum of dated neighbours', () => {
		const v = numericValues('activity', ids, { ...ctx, minDated: 3 });
		// a: neighbours b, c, d modified 2, 100 and 3 days ago: 2 of 3 in the last 30 days.
		expect(v[0]).toBeCloseTo(2 / 3);
		expect(Number.isNaN(numericValues('activity', ids, { ...ctx, minDated: 4 })[0])).toBe(true);
	});

	it('computes the precursor signal, NaN for undated notes', () => {
		const v = numericValues('precursor', ids, ctx);
		// a (day 10) precedes its dated neighbours b and d: observed 1, expected 2/2.
		expect(v[0]).toBeCloseTo(0);
		expect(Number.isNaN(v[2])).toBe(true);
	});

	it('uses the relevance given by the host, NaN without axes', () => {
		expect(numericValues('relevance', ids, { ...ctx, relevance: new Map([['a', 80]]) }).slice(0, 2)).toEqual([80, Number.NaN]);
		expect(numericValues('relevance', ids, ctx).every(Number.isNaN)).toBe(true);
	});
});

describe('sizeValues', () => {
	it('sizes by degree, PageRank, centrality or activity; fixed gives null', () => {
		expect(sizeValues('degree', ids, ctx)).toEqual([3, 1, 0, 2]);
		expect(sizeValues('centrality', ids, ctx)).toEqual([0.9, 0.5, 0.5, 0.5]);
		expect(sizeValues('fixed', ids, ctx)).toBeNull();
	});
});

describe('sharedWords', () => {
	it('lists the rare words both notes contain, rarest first, without stop words', () => {
		const df = new Map([['saxophone', 2], ['jazz', 10], ['bebop', 3]]);
		expect(sharedWords('Le saxophone et le bebop du jazz', 'Bebop, jazz et saxophone ténor', df, 100, 5)).toEqual(['saxophone', 'bebop', 'jazz']);
	});
});
