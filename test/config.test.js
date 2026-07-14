import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { normalizeConfig } from '../lib/config.js';

const source = (props) => ({ url: 'http://example.com/data.json', outputDir: '/out', ...props });
const config = (...sources) => ({ sources: sources.map(source) });

describe('normalizeConfig', () => {
  test('applies defaults', () => {
    const [s] = normalizeConfig(config({})).sources;

    assert.equal(s.dataFile, 'data.json');
    assert.equal(s.assetFolder, 'assets');
    assert.deepEqual(s.assetFields, []);
  });

  test('resolves the two paths a source writes to', () => {
    const [s] = normalizeConfig(config({ outputDir: '/out/Pugs', dataFile: 'pugs.json', assetFolder: 'images' })).sources;

    assert.equal(s.dataPath, '/out/Pugs/pugs.json');
    assert.equal(s.assetPath, '/out/Pugs/images');
  });

  test('expands ~ to the home directory', () => {
    const [s] = normalizeConfig(config({ outputDir: '~/out' })).sources;

    assert.equal(s.dataPath, path.join(homedir(), 'out', 'data.json'));
  });

  describe('colliding sources', () => {
    test('rejects two sources writing the same JSON file', () => {
      assert.throws(() => normalizeConfig(config({}, {})), /Two sources both write/);
    });

    test('rejects two sources downloading assets into the same folder', () => {
      const input = config({ dataFile: 'a.json', assetFields: ['img'] }, { dataFile: 'b.json', assetFields: ['img'] });

      assert.throws(() => normalizeConfig(input), /both download assets into/);
    });

    test('allows two sources to share an outputDir when only one has assets', () => {
      const input = config({ dataFile: 'a.json', assetFields: ['img'] }, { dataFile: 'b.json' });

      assert.equal(normalizeConfig(input).sources.length, 2);
    });
  });

  // An asset folder is emptied and rewritten on every run. Its own source's JSON is a sibling, so
  // it is never at risk — but another source parked inside the folder would be deleted with it.
  test('rejects an assetFolder holding another source\'s outputDir', () => {
    const input = config(
      { outputDir: '/out', assetFields: ['img'] },
      { outputDir: '/out/assets/Pugs' }
    );

    assert.throws(() => normalizeConfig(input), /sits inside it/);
  });

  for (const [label, input, message] of [
    ['an empty sources array', { sources: [] }, /sources/],
    ['a source with no url', { sources: [{ outputDir: '/out' }] }, /url/],
    ['a source with a bad url', { sources: [{ url: 'nope', outputDir: '/out' }] }, /valid URL/],
    ['a source with no outputDir', { sources: [{ url: 'http://e.com' }] }, /outputDir/],
    ['a dataFile with a path in it', config({ dataFile: 'nested/data.json' }), /dataFile/],
    ['an empty dataFile', config({ dataFile: '' }), /dataFile/],
    ['assetFields that are not strings', config({ assetFields: [{}] }), /assetFields/]
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => normalizeConfig(input), message);
    });
  }

  // assetFolder names a folder inside outputDir, and nothing else — no separators, no climbing out
  for (const assetFolder of ['../../public/assets', '..', '.', 'nested/assets', 'nested\\assets', '/var/assets', '']) {
    test(`rejects an assetFolder of ${JSON.stringify(assetFolder)}`, () => {
      assert.throws(() => normalizeConfig(config({ assetFolder })), /assetFolder must be a folder name/);
    });
  }
});
