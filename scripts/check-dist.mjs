// Fails the build when dist/ carries a WASM file or weighs more than 3 MB.
// Usage: node scripts/check-dist.mjs [dir]
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIMIT_MB = 3;
const dir = process.argv[2] || 'dist';
let total = 0;
const wasm = [];

const walk = (path) => {
  for (const name of readdirSync(path)) {
    const full = join(path, name);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    total += statSync(full).size;
    if (name.endsWith('.wasm')) wasm.push(full);
  }
};
walk(dir);

const mb = total / (1024 * 1024);
console.log(`dist: ${mb.toFixed(1)} MB`);
for (const file of wasm) console.log(`wasm: ${file}`);
if (wasm.length || mb > LIMIT_MB) {
  console.error(wasm.length ? 'dist contains WASM files, which the page never requests.' : `dist is over ${LIMIT_MB} MB.`);
  process.exit(1);
}
