import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, migrateSettings } from '../src/settings/schema';

describe('migrateSettings', () => {
	it('returns the defaults when nothing was saved yet', () => {
		for (const raw of [null, undefined]) {
			const result = migrateSettings(raw);
			expect(result.settings).toEqual(DEFAULT_SETTINGS);
			expect(result.readOnly).toBe(false);
			expect(result.changed).toBe(true);
		}
	});

	it('keeps valid current-version settings unchanged', () => {
		const saved = { ...DEFAULT_SETTINGS, debug: true, index: { ...DEFAULT_SETTINGS.index }, analysis: { ...DEFAULT_SETTINGS.analysis } };
		const result = migrateSettings(saved);
		expect(result.settings).toEqual(saved);
		expect(result.changed).toBe(false);
	});

	it('migrates unversioned data (version 0) to the current version', () => {
		const result = migrateSettings({ debug: true });
		expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, debug: true });
		expect(result.changed).toBe(true);
	});

	it('replaces fields of the wrong type by their default and reports it', () => {
		const result = migrateSettings({ version: SETTINGS_VERSION, debug: 'yes' });
		expect(result.settings.debug).toBe(DEFAULT_SETTINGS.debug);
		expect(result.changed).toBe(true);
	});

	it('never overwrites settings written by a newer version of the plugin', () => {
		const newer = { version: SETTINGS_VERSION + 1, debug: true, futureField: 42 };
		const result = migrateSettings(newer);
		expect(result.readOnly).toBe(true);
		expect(result.changed).toBe(false);
		expect(result.settings.debug).toBe(true);
	});

	it('does not mutate its input', () => {
		const saved = { debug: true };
		migrateSettings(saved);
		expect(saved).toEqual({ debug: true });
	});

	it('always yields a well-formed current-version object for any input', () => {
		fc.assert(
			fc.property(fc.anything(), (raw) => {
				const { settings, readOnly } = migrateSettings(raw);
				expect(typeof settings.debug).toBe('boolean');
				if (!readOnly) expect(settings.version).toBe(SETTINGS_VERSION);
			}),
		);
	});
});

describe('settings version 2 (semantic index)', () => {
	it('migrates version 1 by adding the index settings with their defaults', () => {
		const { settings, changed } = migrateSettings({ version: 1, debug: true });
		expect(changed).toBe(true);
		expect(settings).toMatchObject({ version: SETTINGS_VERSION, debug: true, index: DEFAULT_SETTINGS.index, analysis: DEFAULT_SETTINGS.analysis });
	});

	it('keeps valid index settings and repairs invalid ones', () => {
		const stored = { ...DEFAULT_SETTINGS, index: { ...DEFAULT_SETTINGS.index, titleWeight: 0.5, excludeFolders: ['Archive'], maxChunkTokens: 'big' } };
		const { settings } = migrateSettings(stored);
		expect(settings.index.titleWeight).toBe(0.5);
		expect(settings.index.excludeFolders).toEqual(['Archive']);
		expect(settings.index.maxChunkTokens).toBe(DEFAULT_SETTINGS.index.maxChunkTokens);
	});

	it('clamps numbers into their allowed range', () => {
		const { settings } = migrateSettings({ ...DEFAULT_SETTINGS, index: { ...DEFAULT_SETTINGS.index, titleWeight: 3, maxChunkTokens: 5000, workers: 0 } });
		expect(settings.index.titleWeight).toBe(1);
		expect(settings.index.maxChunkTokens).toBe(512);
		expect(settings.index.workers).toBe(1);
	});
});

describe('settings version 3 (analysis, axes, names)', () => {
	it('migrates version 2 by adding the analysis section', () => {
		const v2 = { version: 2, debug: false, index: { ...DEFAULT_SETTINGS.index, titleWeight: 0.4 } };
		const { settings } = migrateSettings(v2);
		expect(settings.version).toBe(SETTINGS_VERSION);
		expect(settings.index.titleWeight).toBe(0.4);
		expect(settings.analysis).toEqual(DEFAULT_SETTINGS.analysis);
	});

	it('keeps valid axes and names given by hand, drops malformed entries', () => {
		const stored = {
			...DEFAULT_SETTINGS,
			analysis: {
				...DEFAULT_SETTINGS.analysis,
				axes: [{ name: 'Climate', description: 'climate change and energy' }, { name: 42 }, { name: 'Health', description: '' }],
				names: [{ name: 'Sky', anchors: ['a.md', 'b.md', 3] }, { name: 4, anchors: [] }, { name: 'No anchors' }],
				resolution: 1.5,
				dateSource: 'property',
			},
		};
		const { settings } = migrateSettings(stored);
		expect(settings.analysis.axes).toEqual([
			{ name: 'Climate', description: 'climate change and energy' },
			{ name: 'Health', description: '' },
		]);
		expect(settings.analysis.names).toEqual([{ name: 'Sky', anchors: ['a.md', 'b.md'] }]);
		expect(settings.analysis.resolution).toBe(1.5);
		expect(settings.analysis.dateSource).toBe('property');
	});

	it('repairs an unknown date source and an out-of-range resolution', () => {
		const { settings } = migrateSettings({ ...DEFAULT_SETTINGS, analysis: { ...DEFAULT_SETTINGS.analysis, dateSource: 'moon', resolution: 99 } });
		expect(settings.analysis.dateSource).toBe(DEFAULT_SETTINGS.analysis.dateSource);
		expect(settings.analysis.resolution).toBe(5);
	});
});
