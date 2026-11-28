/**
 * Versioned settings schema and migrations.
 *
 * Every saved object carries a `version`. Older versions are migrated step by step;
 * a version newer than this build is never overwritten (`readOnly`), so that a
 * downgrade does not destroy settings written by a later release.
 */

export const SETTINGS_VERSION = 3;

export interface IndexSettings {
	/** Index the vault (on desktop). Off until the user turns it on and the model is present. */
	enabled: boolean;
	/** Index on phones and tablets too (off by default: memory and battery). */
	onMobile: boolean;
	/** Weight of the title in a note's vector, 0 to 1. */
	titleWeight: number;
	/** Largest passage, in model tokens (64 to 512). */
	maxChunkTokens: number;
	/** Tokens repeated between consecutive passages. */
	overlapTokens: number;
	/** Notes shorter than this (in tokens) are indexed by their title only. */
	minTokens: number;
	/** Folders left out (paths, without trailing slash). */
	excludeFolders: string[];
	/** Notes with one of these tags are left out (without '#'). */
	excludeTags: string[];
	/** Keep code blocks in the passages (left out by default). */
	includeCode: boolean;
	/** Front-matter property holding a note's date, if any. */
	dateProperty: string;
	/** Embedding workers (1 to 4); each holds a copy of the model (about 130 MB). */
	workers: number;
}

export interface Axis {
	name: string;
	/** Free text describing the interest; embedded by the same model as the notes. */
	description: string;
}

/** A cluster name given by hand, with the notes that identify its cluster. */
export interface ManualName {
	name: string;
	/** Most central notes of the cluster when it was last analysed (paths). */
	anchors: string[];
}

export type DateSource = 'property' | 'created' | 'modified';

export interface AnalysisSettings {
	/** Leiden resolution: larger values give smaller clusters (0.2 to 5). */
	resolution: number;
	/** Interest axes declared by the user. */
	axes: Axis[];
	/** Names given by hand; a name follows the cluster holding most of its anchors. */
	names: ManualName[];
	/** Date of a note for the time views. */
	dateSource: DateSource;
}

export interface SemanticAtlasSettings {
	version: typeof SETTINGS_VERSION;
	/** Show debug and warning messages in the developer console. */
	debug: boolean;
	index: IndexSettings;
	analysis: AnalysisSettings;
}

export const DEFAULT_INDEX_SETTINGS: Readonly<IndexSettings> = Object.freeze({
	enabled: false,
	onMobile: false,
	titleWeight: 0.2,
	maxChunkTokens: 256,
	overlapTokens: 32,
	minTokens: 8,
	excludeFolders: [],
	excludeTags: [],
	includeCode: false,
	dateProperty: '',
	workers: 1,
});

export const DEFAULT_ANALYSIS_SETTINGS: Readonly<AnalysisSettings> = Object.freeze({
	resolution: 1,
	axes: [],
	names: [],
	dateSource: 'modified',
});

export const DEFAULT_SETTINGS: Readonly<SemanticAtlasSettings> = Object.freeze({
	version: SETTINGS_VERSION,
	debug: false,
	index: DEFAULT_INDEX_SETTINGS,
	analysis: DEFAULT_ANALYSIS_SETTINGS,
});

export interface MigrationResult {
	settings: SemanticAtlasSettings;
	/** True when the stored data differs from `settings` and should be saved. */
	changed: boolean;
	/** True when the data comes from a newer version: use it, never save over it. */
	readOnly: boolean;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readVersion = (raw: Raw): number => {
	const v = raw.version;
	return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0;
};

/** Migrations from version `n` to `n + 1`, indexed by `n`. */
const MIGRATIONS: ReadonlyArray<(raw: Raw) => Raw> = [
	// 0 -> 1: unversioned data, fields kept as they are.
	(raw) => ({ ...raw, version: 1 }),
	// 1 -> 2: semantic index settings, with their defaults.
	(raw) => ({ ...raw, version: 2, index: { ...DEFAULT_INDEX_SETTINGS } }),
	// 2 -> 3: analysis settings (resolution, axes, manual names, date source).
	(raw) => ({ ...raw, version: 3, analysis: { ...DEFAULT_ANALYSIS_SETTINGS } }),
];

const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number, min: number, max: number, integer = true): number =>
	typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, integer ? Math.round(v) : v)) : d;
const strings = (v: unknown, d: readonly string[]): string[] =>
	Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v)] : [...d];
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

const normalizeIndex = (raw: unknown): IndexSettings => {
	const r = isRecord(raw) ? raw : {};
	const d = DEFAULT_INDEX_SETTINGS;
	return {
		enabled: bool(r.enabled, d.enabled),
		onMobile: bool(r.onMobile, d.onMobile),
		titleWeight: num(r.titleWeight, d.titleWeight, 0, 1, false),
		maxChunkTokens: num(r.maxChunkTokens, d.maxChunkTokens, 64, 512),
		overlapTokens: num(r.overlapTokens, d.overlapTokens, 0, 128),
		minTokens: num(r.minTokens, d.minTokens, 0, 256),
		excludeFolders: strings(r.excludeFolders, d.excludeFolders),
		excludeTags: strings(r.excludeTags, d.excludeTags),
		includeCode: bool(r.includeCode, d.includeCode),
		dateProperty: str(r.dateProperty, d.dateProperty),
		workers: num(r.workers, d.workers, 1, 4),
	};
};

const DATE_SOURCES: readonly DateSource[] = ['property', 'created', 'modified'];

const normalizeAnalysis = (raw: unknown): AnalysisSettings => {
	const r = isRecord(raw) ? raw : {};
	const d = DEFAULT_ANALYSIS_SETTINGS;
	const axes = Array.isArray(r.axes)
		? r.axes.filter((a): a is Axis => isRecord(a) && typeof a.name === 'string' && typeof a.description === 'string').map((a) => ({ name: a.name, description: a.description }))
		: [];
	const names = Array.isArray(r.names)
		? r.names
				.filter((n): n is { name: string; anchors: unknown[] } => isRecord(n) && typeof n.name === 'string' && n.name !== '' && Array.isArray(n.anchors))
				.map((n) => ({ name: n.name, anchors: n.anchors.filter((a): a is string => typeof a === 'string') }))
				.filter((n) => n.anchors.length > 0)
		: [];
	return {
		resolution: num(r.resolution, d.resolution, 0.2, 5, false),
		axes,
		names,
		dateSource: DATE_SOURCES.includes(r.dateSource as DateSource) ? (r.dateSource as DateSource) : d.dateSource,
	};
};

const normalize = (raw: Raw): SemanticAtlasSettings => ({
	version: SETTINGS_VERSION,
	debug: typeof raw.debug === 'boolean' ? raw.debug : DEFAULT_SETTINGS.debug,
	index: normalizeIndex(raw.index),
	analysis: normalizeAnalysis(raw.analysis),
});

export function migrateSettings(stored: unknown): MigrationResult {
	if (!isRecord(stored)) {
		return { settings: normalize({}), changed: true, readOnly: false };
	}

	const version = readVersion(stored);
	if (version > SETTINGS_VERSION) {
		return { settings: normalize(stored), changed: false, readOnly: true };
	}

	let raw: Raw = { ...stored };
	for (let v = version; v < SETTINGS_VERSION; v++) {
		const step = MIGRATIONS[v];
		if (!step) throw new Error(`Missing settings migration from version ${v}`);
		raw = step(raw);
	}

	const settings = normalize(raw);
	return { settings, changed: JSON.stringify(stored) !== JSON.stringify(settings), readOnly: false };
}
