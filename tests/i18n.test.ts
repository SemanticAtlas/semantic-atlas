import { describe, expect, it } from 'vitest';
import { createTranslator, pickLocale } from '../src/i18n';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';

describe('pickLocale', () => {
	it('uses French for French variants of the Obsidian language', () => {
		for (const lang of ['fr', 'fr-FR', 'fr-CA', 'FR']) expect(pickLocale(lang)).toBe('fr');
	});

	it('falls back to English for any other or missing language', () => {
		for (const lang of ['en', 'en-GB', 'de', 'zh-TW', '', 'french']) expect(pickLocale(lang)).toBe('en');
	});
});

describe('catalogues', () => {
	it('French translates every English key and nothing else', () => {
		expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
	});

	it('has no empty string', () => {
		for (const catalogue of [en, fr]) {
			for (const value of Object.values(catalogue)) expect(value.trim()).not.toBe('');
		}
	});
});

describe('createTranslator', () => {
	it('returns the string of the chosen locale', () => {
		expect(createTranslator('fr')('settings.debug.name')).toBe(fr['settings.debug.name']);
		expect(createTranslator('en')('settings.debug.name')).toBe(en['settings.debug.name']);
	});

	it('replaces placeholders and leaves unknown ones as they are', () => {
		const t = createTranslator('en');
		expect(t('relations.summary', { notes: 4, links: 2, unresolved: 1 })).toBe('Notes: 4, links: 2, unresolved links: 1');
		expect(t('relations.selected', {})).toBe('Selected: {label}');
	});

	it('keeps the same placeholders in every language', () => {
		const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const key of Object.keys(en) as (keyof typeof en)[]) expect(names(fr[key])).toEqual(names(en[key]));
	});
});
