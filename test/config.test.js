import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';

import { normalizeConfig, pathsFor } from '../lib/config.js';

const source = (props) => ({ url: 'http://example.com/data.json', outputFolder: 'stories', ...props });
const config = (...sources) => ({ baseOutputDir: '/out', sources: sources.map(source) });

describe('normalizeConfig', () => {
  test('applies defaults', () => {
    const [s] = normalizeConfig(config({})).sources;

    assert.equal(s.dataFile, 'data.json');
    assert.equal(s.assetFolder, 'assets');
    assert.deepEqual(s.assetFields, []);
  });

  test('resolves baseOutputDir, and leaves each source a folder inside it', () => {
    const { baseOutputDir, sources } = normalizeConfig(config({ outputFolder: 'pugs' }));

    assert.equal(baseOutputDir, path.resolve('/out'));
    assert.equal(sources[0].outputFolder, 'pugs');
  });

  test('expands ~ in baseOutputDir', () => {
    const { baseOutputDir } = normalizeConfig({ ...config({}), baseOutputDir: '~/kiosk' });

    assert.equal(baseOutputDir, path.join(homedir(), 'kiosk'));
  });

  // A scheduler starts the job in a directory of its own choosing — launchd uses `/` — so a
  // relative path can only mean one thing: relative to the config file it was written in.
  test('measures a relative baseOutputDir from the config file, not the working directory', () => {
    const { baseOutputDir } = normalizeConfig({ ...config({}), baseOutputDir: './content' }, '/opt/kiosk');

    assert.equal(baseOutputDir, path.resolve('/opt/kiosk/content'));
  });

  test('leaves an absolute baseOutputDir alone', () => {
    const { baseOutputDir } = normalizeConfig({ ...config({}), baseOutputDir: '/srv/content' }, '/opt/kiosk');

    assert.equal(baseOutputDir, path.resolve('/srv/content'));
  });

  test('rejects two sources sharing a folder', () => {
    assert.throws(() => normalizeConfig(config({ outputFolder: 'a' }, { outputFolder: 'a' })), /own folder/);
  });

  test('allows sources with different folders', () => {
    assert.equal(normalizeConfig(config({ outputFolder: 'a' }, { outputFolder: 'b' })).sources.length, 2);
  });

  // Asset Sync keeps the manifest in there, and it is not a source's to overwrite.
  test('rejects a source claiming the asset-sync folder', () => {
    assert.throws(
      () => normalizeConfig(config({ outputFolder: 'asset-sync' })),
      /Asset Sync keeps its manifest/
    );
  });

  for (const [label, input, message] of [
    ['an empty sources array', { baseOutputDir: '/out', sources: [] }, /sources/],
    ['a config with no baseOutputDir', { sources: [source({})] }, /baseOutputDir/],
    ['a source with no url', { baseOutputDir: '/out', sources: [{ outputFolder: 'a' }] }, /url/],
    ['a source with a bad url', { baseOutputDir: '/out', sources: [{ url: 'nope', outputFolder: 'a' }] }, /valid URL/],
    ['a source with no outputFolder', { baseOutputDir: '/out', sources: [{ url: 'http://e.com' }] }, /"outputFolder"/],
    ['a dataFile with a path in it', config({ dataFile: 'nested/data.json' }), /dataFile/],
    ['an empty dataFile', config({ dataFile: '' }), /dataFile/],
    ['assetFields that are not strings', config({ assetFields: [{}] }), /assetFields/]
  ]) {
    test(`rejects ${label}`, () => {
      assert.throws(() => normalizeConfig(input), message);
    });
  }

  // Every name is a folder or file inside its parent, and nothing else — no separators, no climbing out
  for (const key of ['outputFolder', 'assetFolder']) {
    for (const name of ['../../public', '..', '.', 'nested/assets', 'nested\\assets', '/var/assets', '']) {
      test(`rejects a ${key} of ${JSON.stringify(name)}`, () => {
        assert.throws(() => normalizeConfig(config({ [key]: name })), new RegExp(key));
      });
    }
  }
});

describe('pathsFor', () => {
  test('places a source under whichever root it is given', () => {
    const input = config({ outputFolder: 'pugs', dataFile: 'pugs.json', assetFolder: 'images' });
    const [s] = normalizeConfig(input).sources;

    assert.deepEqual(pathsFor(s, '/tmp/build'), {
      folder: path.join('/tmp/build/pugs'),
      dataPath: path.join('/tmp/build/pugs/pugs.json'),
      assetPath: path.join('/tmp/build/pugs/images')
    });
  });
});
