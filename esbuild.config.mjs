import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';

// The release main.js must be byte-for-byte reproducible: the community directory
// rebuilds it from source and compares. No timestamps, no environment-dependent paths.
const banner = `/*
Semantic Atlas - bundled file, see the source at https://github.com/SemanticAtlas/semantic-atlas
*/
`;

const prod = process.argv[2] === 'production';

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
	],
	format: 'cjs',
	target: 'es2021',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	legalComments: prod ? 'eof' : 'inline',
	outfile: 'main.js',
	minify: prod,
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
