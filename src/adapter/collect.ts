/**
 * Turns the notes and their references (from Obsidian's metadata cache) into the neutral data of
 * the Relations view. Pure: the caller provides the references and the link resolver, so this
 * module does not depend on the Obsidian API and is tested on its own.
 */
import type { EdgeInput, RelationsData } from '@semanticatlas/core';

export type ReferenceKind = 'link' | 'embed' | 'property';

export interface SourceReference {
	kind: ReferenceKind;
	/** Link destination as in `LinkCache.link`: path, optionally followed by `#heading` or `#^block`. */
	link: string;
	/** Original text, e.g. `[[Beta|alias]]` or `[beta](Beta.md)`. */
	original: string;
}

export interface SourceNote {
	path: string;
	title: string;
	references: SourceReference[];
}

/** Resolves a link path from a source note to a file path, or null when no file matches. */
export type LinkResolver = (linkpath: string, sourcePath: string) => string | null;

export interface CollectedRelations extends RelationsData {
	/** Links to existing files that are not notes (attachments), left out of the graph. */
	attachmentLinks: number;
}

const linkpathOf = (link: string): string => {
	const hash = link.indexOf('#');
	return hash < 0 ? link : link.slice(0, hash);
};

const syntaxOf = (original: string): 'wiki' | 'markdown' =>
	original.startsWith('[[') || original.startsWith('![[') ? 'wiki' : 'markdown';

const isNote = (path: string): boolean => path.toLowerCase().endsWith('.md');

export function collectRelations(notes: readonly SourceNote[], resolve: LinkResolver): CollectedRelations {
	const counts = new Map<string, EdgeInput>();
	let attachmentLinks = 0;
	for (const note of notes) {
		for (const ref of note.references) {
			const linkpath = linkpathOf(ref.link);
			const syntax = syntaxOf(ref.original);
			// `[[#Heading]]` points inside the note itself.
			const resolved = linkpath === '' ? note.path : resolve(linkpath, note.path);
			let edge: EdgeInput;
			if (resolved === null) {
				edge = { from: note.path, to: linkpath, kind: 'unresolved', syntax, count: 0 };
			} else if (isNote(resolved)) {
				edge = { from: note.path, to: resolved, kind: ref.kind, syntax, target: 'note', count: 0 };
			} else {
				attachmentLinks++;
				continue;
			}
			const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}\u0000${syntax}`;
			const existing = counts.get(key);
			if (existing) existing.count++;
			else counts.set(key, { ...edge, count: 1 });
		}
	}
	const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
	const edges = [...counts.values()].sort(
		(a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind) || cmp(a.syntax ?? '', b.syntax ?? ''),
	);
	return { nodes: notes.map((n) => ({ id: n.path, label: n.title })), edges, attachmentLinks };
}
