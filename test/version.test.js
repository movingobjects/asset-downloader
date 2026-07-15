import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { VERSION } from '../lib/version.js';

// A compiled binary has no package.json to read at runtime, so the version is baked into the source
// by `npm run build`. This is what catches a release where the bake was forgotten.
test('the baked-in version matches package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(VERSION, pkg.version, 'run `npm run build` to bring lib/version.js back into step');
});
