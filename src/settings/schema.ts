/**
 * Versioned settings schema and migrations.
 *
 * Every saved object carries a `version`. Older versions are migrated step by step;
 * a version newer than this build is never overwritten (`readOnly`), so that a
 * downgrade does not destroy settings written by a later release.
 */

export const SETTINGS_VERSION = 1;

export interface SemanticAtlasSettings {
	version: typeof SETTINGS_VERSION;
	/** Show debug and warning messages in the developer console. */
	debug: boolean;
}

export const DEFAULT_SETTINGS: Readonly<SemanticAtlasSettings> = Object.freeze({
	version: SETTINGS_VERSION,
	debug: false,
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
];

const normalize = (raw: Raw): SemanticAtlasSettings => ({
	version: SETTINGS_VERSION,
	debug: typeof raw.debug === 'boolean' ? raw.debug : DEFAULT_SETTINGS.debug,
});

const sameSettings = (raw: Raw, settings: SemanticAtlasSettings): boolean =>
	Object.keys(raw).length === Object.keys(settings).length &&
	(Object.keys(settings) as (keyof SemanticAtlasSettings)[]).every((key) => raw[key] === settings[key]);

export function migrateSettings(stored: unknown): MigrationResult {
	if (!isRecord(stored)) {
		return { settings: { ...DEFAULT_SETTINGS }, changed: true, readOnly: false };
	}

	const version = readVersion(stored);
	if (version > SETTINGS_VERSION) {
		const settings = normalize(stored);
		return { settings, changed: false, readOnly: true };
	}

	let raw: Raw = { ...stored };
	for (let v = version; v < SETTINGS_VERSION; v++) {
		const step = MIGRATIONS[v];
		if (!step) throw new Error(`Missing settings migration from version ${v}`);
		raw = step(raw);
	}

	const settings = normalize(raw);
	return { settings, changed: !sameSettings(stored, settings), readOnly: false };
}
