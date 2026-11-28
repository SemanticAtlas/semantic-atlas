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

// The workers (from @semanticatlas/core) are bundled on their own, then inlined in main.js
// as source text and started from a blob URL: Obsidian installs a single main.js.
const WORKERS = { 'embed-worker': '@semanticatlas/core/embed-worker', 'analysis-worker': '@semanticatlas/core/analysis-worker' };
const embedWorker = {
	name: 'workers',
	setup(build) {
		build.onResolve({ filter: /^virtual:(embed|analysis)-worker$/ }, (args) => ({ path: args.path.slice('virtual:'.length), namespace: 'worker' }));
		build.onLoad({ filter: /.*/, namespace: 'worker' }, async (args) => {
			const result = await esbuild.build({
				entryPoints: [WORKERS[args.path]],
				bundle: true,
				format: 'iife',
				platform: 'browser',
				target: 'es2021',
				minify: prod,
				write: false,
				legalComments: 'eof',
				logLevel: 'warning',
			});
			return { contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`, loader: 'js' };
		});
	},
};

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
	// The compute engine (WebAssembly) is embedded in main.js: nothing is downloaded.
	loader: { '.wasm': 'binary' },
	plugins: [embedWorker],
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
