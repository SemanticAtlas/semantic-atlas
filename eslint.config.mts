import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'main.js',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'scripts',
		'docs',
	]),
	{
		languageOptions: {
			globals: { ...globals.browser },
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: decodeURIComponent(new URL('.', import.meta.url).pathname),
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		files: ['src/**/*.ts'],
		rules: {
			'obsidianmd/ui/sentence-case': 'error',
		},
	},
);
