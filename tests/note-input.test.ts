import { describe, expect, it } from 'vitest';
import { toNoteInput, type CacheLike } from '../src/adapter/note-input';

const pos = (start: number, end: number) => ({ start: { offset: start }, end: { offset: end } });

const content = '---\ntags: [a]\ndate: 2024-05-01\n---\n# Title\nSee [[Other|the other]] and ![[img.png]].\n\n```dataview\nLIST\n```\n\n```js\nx\n```\n';
const fm = content.indexOf('---\n# Title') + 3;
const at = (s: string) => content.indexOf(s);
const cache: CacheLike = {
	frontmatterPosition: pos(0, fm),
	frontmatter: { tags: ['a'], date: '2024-05-01' },
	sections: [
		{ type: 'yaml', position: pos(0, fm) },
		{ type: 'heading', position: pos(at('# Title'), at('# Title') + 7) },
		{ type: 'paragraph', position: pos(at('See'), at('png]].') + 6), id: 'blk' },
		{ type: 'code', position: pos(at('```dataview'), at('LIST\n```') + 8) },
		{ type: 'code', position: pos(at('```js'), at('x\n```') + 5) },
	],
	headings: [{ heading: 'Title', level: 1, position: pos(at('# Title'), at('# Title') + 7) }],
	links: [{ link: 'Other', displayText: 'the other', original: '[[Other|the other]]', position: pos(at('[[Other'), at('[[Other') + 19) }],
	embeds: [{ link: 'img.png', original: '![[img.png]]', position: pos(at('![[img'), at('![[img') + 12) }],
};
const meta = { path: 'dir/Note.md', title: 'Note', folder: 'dir', ctime: 1000, mtime: 2000, tags: ['a', 'b'], aliases: ['N'] };

describe('toNoteInput', () => {
	const n = toNoteInput(meta, content, cache, { dateProperty: 'date' });

	it('drops the front matter and shifts every offset accordingly', () => {
		expect(n.text.startsWith('\n# Title')).toBe(true);
		const heading = n.sections.find((s) => s.kind === 'heading')!;
		expect(n.text.slice(heading.start, heading.end)).toBe('# Title');
		expect(heading).toMatchObject({ heading: 'Title', level: 1 });
	});

	it('maps section types, marks embedded queries and keeps block ids', () => {
		expect(n.sections.map((s) => s.kind)).toEqual(['heading', 'paragraph', 'query', 'code']);
		expect(n.sections[1]!.id).toBe('blk');
	});

	it('turns links into spans showing their text, and embeds into empty spans', () => {
		expect(n.linkSpans).toHaveLength(2);
		const [link, embed] = n.linkSpans;
		expect(n.text.slice(link!.start, link!.end)).toBe('[[Other|the other]]');
		expect(link!.display).toBe('the other');
		expect(embed!.display).toBe('');
	});

	it('takes dates from the file and from the chosen property, never 0 when unknown', () => {
		expect(n.dates).toEqual({ created: 1000, modified: 2000, property: Date.parse('2024-05-01') });
		expect(n.dateSources).toEqual({ created: 'filesystem', modified: 'filesystem', property: 'property' });
		const noDate = toNoteInput(meta, 'x', null, { dateProperty: 'missing' });
		expect('property' in noDate.dates).toBe(false);
	});

	it('copies the identity fields and copes with a note that has no cache yet', () => {
		expect(n).toMatchObject({ id: 'dir/Note.md', title: 'Note', folder: 'dir', tags: ['a', 'b'], aliases: ['N'] });
		const bare = toNoteInput(meta, 'Just text.', null, {});
		expect(bare.text).toBe('Just text.');
		expect(bare.sections).toEqual([]);
		expect(bare.linkSpans).toEqual([]);
	});
});
