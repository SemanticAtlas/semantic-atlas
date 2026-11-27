// Fails when main.js exceeds its budget (docs/SPEC.md section 7.3).
// Obsidian Sync Standard does not sync files over 5 MB, so 4.5 MB is a hard limit.
import { statSync } from 'node:fs';

const HARD_LIMIT = 4.5 * 1024 * 1024;
const TARGET = 3 * 1024 * 1024;

const { size } = statSync('main.js');
const mb = (n) => (n / 1024 / 1024).toFixed(2);
console.log(`main.js: ${mb(size)} MB (target ${mb(TARGET)} MB, hard limit ${mb(HARD_LIMIT)} MB)`);
if (size > HARD_LIMIT) {
	console.error('main.js exceeds the hard size limit.');
	process.exit(1);
}
if (size > TARGET) console.warn('main.js exceeds the target size.');
