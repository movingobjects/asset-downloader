import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import test, { describe } from 'node:test';

import { normalizeConfig } from '../lib/config.js';

describe('normalizeConfig', () => {
  const valid = { outDir: '~/out', sources: [{ url: 'http://example.com/data.json' }] };

  test('applies defaults', () => {
    const config = normalizeConfig(valid);

    assert.equal(config.publicPath, '');
    assert.equal(config.sources[0].dir, '');
    assert.equal(config.sources[0].file, 'data.json');
    assert.deepEqual(config.sources[0].assets, []);
  });

  test('expands ~ to the home directory', () => {
    assert.equal(normalizeConfig(valid).outDir, `${homedir()}/out`);
  });

  test('trims stray slashes from paths', () => {
    const config = normalizeConfig({
      ...valid,
      publicPath: '/assets/',
      sources: [{ url: 'http://example.com', dir: '/Pugs/' }]
    });

    assert.equal(config.publicPath, 'assets');
    assert.equal(config.sources[0].dir, 'Pugs');
  });

  for (const [label, config, message] of [
    ['a missing outDir', { sources: [{ url: 'http://e.com' }] }, /outDir/],
    ['an empty sources array', { outDir: '/out', sources: [] }, /sources/],
    ['a source with no url', { outDir: '/out', sources: [{}] }, /url/],
    ['a source with a bad url', { outDir: '/out', sources: [{ url: 'nope' }] }, /valid URL/],
    ['assets that are not strings', { outDir: '/out', sources: [{ url: 'http://e.com', assets: [{}] }] }, /assets/]
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => normalizeConfig(config), message);
    });
  }
});
