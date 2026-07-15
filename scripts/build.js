#!/usr/bin/env node

// Compiles asset-sync into a standalone binary per platform, so a kiosk needs nothing installed —
// no Node, no npm, no project. Bun is used only here, at build time; the binaries it produces
// depend on nothing at all.
//
// Bun cross-compiles, which is the whole reason it is here: the Windows kiosk binary can be built
// on a Mac. Node's own single-executable support cannot, and would need a Windows machine or CI.

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const DIST = path.join(ROOT, 'dist');

const TARGETS = [
  ['bun-darwin-arm64', 'asset-sync-macos-arm64'],
  ['bun-darwin-x64', 'asset-sync-macos-x64'],
  ['bun-windows-x64', 'asset-sync-windows-x64.exe'],
  ['bun-linux-x64', 'asset-sync-linux-x64']
];

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));

// A compiled binary has no package.json to read, so the version has to be baked into the source.
await writeFile(
  path.join(ROOT, 'lib', 'version.js'),
  `// Kept in step with package.json by \`npm run build\`, and checked by test/version.test.js.\n` +
    `// A compiled binary has no package.json to read at runtime, so the version has to live in the code.\n` +
    `export const VERSION = '${pkg.version}';\n`
);

try {
  execFileSync('bun', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('\n  Building binaries needs bun: https://bun.sh\n  (lib/version.js is up to date either way.)\n');
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const [target, name] of TARGETS) {
  process.stdout.write(`  ${name} … `);

  execFileSync(
    'bun',
    ['build', '--compile', `--target=${target}`, 'asset-sync.js', '--outfile', path.join(DIST, name)],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
  );

  console.log('ok');
}

console.log(`\n  asset-sync ${pkg.version} → ${DIST}\n`);
