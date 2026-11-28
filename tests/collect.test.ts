import { describe, expect, it } from 'vitest';
import { collectRelations, type SourceNote } from '../src/adapter/collect';

// A resolver like metadataCache.getFirstLinkpathDest: link path + source path -> target path.
const files = new Set(['Alpha.md', 'notes/Beta.md', 'Gamma.md', 'img/photo.png']);
const resolve = (linkpath: string): string | null => {
	const candidates = [...files].filter((f) => f === linkpath || f === `${linkpath}.md` || f.endsWith(`/${linkpath}.md`) || f.endsWith(`/${linkpath}`));
	return candidates[0] ?? null;
};

const notes: SourceNote[] = [
	{
		path: 'Alpha.md',
		title: 'Alpha',
		references: [
			{ kind: 'link', link: 'Beta', original: '[[Beta]]' },
			{ kind: 'link', link: 'Beta#Heading', original: '[[Beta#Heading|the beta]]' },
			{ kind: 'link', link: 'Gamma.md', original: '[gamma](Gamma.md)' },
			{ kind: 'embed', link: 'Gamma', original: '![[Gamma]]' },
			{ kind: 'embed', link: 'photo.png', original: '![[photo.png]]' },
			{ kind: 'link', link: 'Not yet', original: '[[Not yet]]' },
			{ kind: 'link', link: 'Not yet', original: '[[Not yet]]' },
		],
	},
	{ path: 'notes/Beta.md', title: 'Beta', references: [{ kind: 'property', link: 'Alpha', original: '[[Alpha]]' }] },
	{ path: 'Gamma.md', title: 'Gamma', references: [] },
];

describe('collectRelations', () => {
	const data = collectRelations(notes, resolve);

	it('lists every Markdown note with its title', () => {
		expect(data.nodes).toEqual([
			{ id: 'Alpha.md', label: 'Alpha' },
			{ id: 'notes/Beta.md', label: 'Beta' },
			{ id: 'Gamma.md', label: 'Gamma' },
		]);
	});

	it('counts occurrences per target, kind and syntax, whatever the heading or alias', () => {
		const wiki = data.edges.find((e) => e.from === 'Alpha.md' && e.to === 'notes/Beta.md');
		expect(wiki).toMatchObject({ kind: 'link', syntax: 'wiki', target: 'note', count: 2 });
		expect(data.edges.find((e) => e.to === 'Gamma.md' && e.kind === 'link')).toMatchObject({ syntax: 'markdown', count: 1 });
		expect(data.edges.find((e) => e.to === 'Gamma.md' && e.kind === 'embed')).toMatchObject({ syntax: 'wiki', count: 1 });
		expect(data.edges.find((e) => e.kind === 'property')).toMatchObject({ from: 'notes/Beta.md', to: 'Alpha.md', count: 1 });
	});

	it('keeps links to missing notes as unresolved, by their link path', () => {
		expect(data.edges.find((e) => e.kind === 'unresolved')).toEqual({ from: 'Alpha.md', to: 'Not yet', kind: 'unresolved', syntax: 'wiki', count: 2 });
	});

	it('leaves out links to attachments (only notes are drawn for now) and reports them', () => {
		expect(data.edges.some((e) => e.to === 'img/photo.png')).toBe(false);
		expect(data.attachmentLinks).toBe(1);
	});

	it('is deterministic: edges sorted by source, target, kind and syntax', () => {
		const again = collectRelations([...notes].reverse(), resolve);
		expect(again.edges).toEqual(data.edges);
	});
});
