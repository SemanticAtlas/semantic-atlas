import { en, type MessageKey } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';
/** Translates a key; `{name}` placeholders are replaced by `vars.name`. */
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Chooses the interface language from Obsidian's language code (`getLanguage()`). */
export function pickLocale(language: string): Locale {
	const primary = language.toLowerCase().split(/[-_]/)[0];
	return primary === 'fr' ? 'fr' : 'en';
}

export function createTranslator(locale: Locale): Translate {
	const catalogue = CATALOGUES[locale];
	return (key, vars) => {
		const text = catalogue[key];
		return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
	};
}

export type { MessageKey };
