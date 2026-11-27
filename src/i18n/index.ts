import { en, type MessageKey } from './en';
import { fr } from './fr';

export type Locale = 'en' | 'fr';
export type Translate = (key: MessageKey) => string;

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Chooses the interface language from Obsidian's language code (`getLanguage()`). */
export function pickLocale(language: string): Locale {
	const primary = language.toLowerCase().split(/[-_]/)[0];
	return primary === 'fr' ? 'fr' : 'en';
}

export function createTranslator(locale: Locale): Translate {
	const catalogue = CATALOGUES[locale];
	return (key) => catalogue[key] ?? en[key];
}

export type { MessageKey };
