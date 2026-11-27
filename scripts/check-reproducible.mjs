// Builds main.js twice and fails if the outputs differ. The community directory
// rebuilds the plugin from source and compares it with the released main.js.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const build = () => {
	execSync('node esbuild.config.mjs production', { stdio: 'ignore' });
	return createHash('sha256').update(readFileSync('main.js')).digest('hex');
};

const first = build();
const second = build();
console.log(`main.js sha256: ${first}`);
if (first !== second) {
	console.error(`Build is not reproducible: second build gave ${second}`);
	process.exit(1);
}
