import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import test, { describe } from 'node:test';

import { normalizeConfig } from '../lib/config.js';

describe('normalizeConfig', () => {
  const valid = { outDir: '~/out', sources: [{ url: 'http://example.com/data.json' }] };

  test('applies defaults', () => {
    const config = normalizeConfig(valid);

    assert.equal(config.pathPrefix, '');
    assert.equal(config.sources[0].dir, '');
    assert.equal(config.sources[0].file, 'data.json');
    assert.deepEqual(config.sources[0].assets, []);
  });

  test('expands ~ to the home directory', () => {
    assert.equal(normalizeConfig(valid).outDir, `${homedir()}/out`);
  });

  test('trims stray slashes from a source dir', () => {
    const config = normalizeConfig({ ...valid, sources: [{ url: 'http://example.com', dir: '/Pugs/' }] });

    assert.equal(config.sources[0].dir, 'Pugs');
  });

  test('keeps a leading slash on pathPrefix, dropping only the trailing one', () => {
    // "/assets" resolves against the site root, "assets" against the page — not interchangeable
    assert.equal(normalizeConfig({ ...valid, pathPrefix: '/assets/' }).pathPrefix, '/assets');
    assert.equal(normalizeConfig({ ...valid, pathPrefix: 'assets/' }).pathPrefix, 'assets');
    assert.equal(normalizeConfig({ ...valid, pathPrefix: '/' }).pathPrefix, '/');
  });

  describe('colliding sources', () => {
    const twoSources = (a, b) => ({ outDir: '/out', sources: [{ url: 'http://e.com/a', ...a }, { url: 'http://e.com/b', ...b }] });

    test('rejects two sources writing the same JSON file to the same dir', () => {
      assert.throws(() => normalizeConfig(twoSources({ dir: 'Pugs' }, { dir: 'Pugs' })), /both write "data\.json"/);
    });

    test('rejects two sources downloading assets into the same dir', () => {
      const config = twoSources({ dir: 'Pugs', file: 'a.json', assets: ['img'] }, { dir: 'Pugs', file: 'b.json', assets: ['img'] });

      assert.throws(() => normalizeConfig(config), /both download assets/);
    });

    test('allows two sources to share a dir when only one has assets', () => {
      const config = twoSources({ file: 'a.json', assets: ['img'] }, { file: 'b.json' });

      assert.equal(normalizeConfig(config).sources.length, 2);
    });
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
