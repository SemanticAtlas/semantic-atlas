// Generates llms.txt (index) and llms-full.txt (full text) from README.md and docs/*.md.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const REPO = 'https://github.com/SemanticAtlas/semantic-atlas/blob/main';
const docs = readdirSync('docs')
	.filter((f) => f.endsWith('.md'))
	.sort()
	.map((f) => `docs/${f}`);
const sources = ['README.md', 'CHANGELOG.md', ...docs];

const title = (text, fallback) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? fallback;
const summary = (text) =>
	text
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('|') && !l.startsWith('<')) ?? '';

const entries = sources.map((path) => {
	const text = readFileSync(path, 'utf8');
	return { path, text, title: title(text, path), summary: summary(text) };
});

const index = [
	'# Semantic Atlas',
	'',
	'> Obsidian community plugin that maps a vault by meaning: related notes, semantic search, themes, bridges between topics, missing links, and a comparison of the structure built by hand with the one meaning reveals. Computed on the device.',
	'',
	'## Documentation',
	'',
	...entries.map((e) => `- [${e.title}](${REPO}/${e.path}): ${e.summary}`),
	'',
].join('\n');

const full = entries.map((e) => `<!-- ${e.path} -->\n\n${e.text.trim()}\n`).join('\n\n');

writeFileSync('llms.txt', index);
writeFileSync('llms-full.txt', full);
console.log(`llms.txt and llms-full.txt written from ${entries.length} files`);
