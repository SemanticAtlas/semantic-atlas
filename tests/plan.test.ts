import { describe, expect, it } from 'vitest';
import { isExcluded, planWork, settingsHash } from '../src/indexing/plan';
import { DEFAULT_INDEX_SETTINGS } from '../src/settings/schema';

describe('isExcluded', () => {
	const s = { ...DEFAULT_INDEX_SETTINGS, excludeFolders: ['Archive', 'Daily/2020'], excludeTags: ['private'] };
	it('leaves out notes in excluded folders and their subfolders', () => {
		expect(isExcluded('Archive/old.md', [], s)).toBe(true);
		expect(isExcluded('Daily/2020/01.md', [], s)).toBe(true);
		expect(isExcluded('Daily/2021/01.md', [], s)).toBe(false);
		expect(isExcluded('Archived.md', [], s)).toBe(false);
	});
	it('leaves out notes with an excluded tag or a child of it', () => {
		expect(isExcluded('a.md', ['private'], s)).toBe(true);
		expect(isExcluded('a.md', ['private/diary'], s)).toBe(true);
		expect(isExcluded('a.md', ['privacy'], s)).toBe(false);
	});
	it('leaves out the configuration folder', () => {
		expect(isExcluded('.obsidian/x.md', [], s, '.obsidian')).toBe(true);
	});
});

describe('planWork', () => {
	const indexed = new Map([
		['a.md', 'ha'],
		['b.md', 'hb'],
		['gone.md', 'hg'],
	]);
	const files = [
		{ id: 'a.md', hash: 'ha', mtime: 5 },
		{ id: 'b.md', hash: 'changed', mtime: 1 },
		{ id: 'c.md', hash: 'hc', mtime: 9 },
		{ id: 'd.md', hash: 'hd', mtime: 3 },
	];
	it('embeds new and changed notes, active note first, then the most recent, and deletes the vanished', () => {
		const plan = planWork(indexed, files, 'd.md');
		expect(plan.toEmbed).toEqual(['d.md', 'c.md', 'b.md']);
		expect(plan.toDelete).toEqual(['gone.md']);
		expect(plan.unchanged).toBe(1);
	});
	it('has nothing to do when everything is up to date', () => {
		const plan = planWork(new Map([['a.md', 'ha']]), [{ id: 'a.md', hash: 'ha', mtime: 1 }], null);
		expect(plan).toEqual({ toEmbed: [], toDelete: [], unchanged: 1 });
	});
});

describe('settingsHash', () => {
	it('changes with what changes the vectors, not with the rest', () => {
		const base = settingsHash(DEFAULT_INDEX_SETTINGS, 'model-sha');
		expect(settingsHash({ ...DEFAULT_INDEX_SETTINGS, titleWeight: 0.5 }, 'model-sha')).not.toBe(base);
		expect(settingsHash(DEFAULT_INDEX_SETTINGS, 'other-model')).not.toBe(base);
		expect(settingsHash({ ...DEFAULT_INDEX_SETTINGS, workers: 3, onMobile: true }, 'model-sha')).toBe(base);
	});
});
