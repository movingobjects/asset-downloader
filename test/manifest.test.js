import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, describe } from 'node:test';

import { cachedFile, extensionOf, manifestPath, readManifest, revalidationHeaders, writeManifest } from '../lib/manifest.js';

let root;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'manifest-test-'));
});

afterEach(() => rm(root, { recursive: true, force: true }));

const entry = (props) => ({ file: 'stories/assets/hero.jpg', etag: '"abc"', lastModified: null, size: 10, ...props });

describe('readManifest / writeManifest', () => {
  test('remembers what the last sync downloaded', async () => {
    await writeManifest(root, { 'http://example.com/hero.jpg': entry() });

    const manifest = await readManifest(root);

    assert.deepEqual(manifest.assets['http://example.com/hero.jpg'], entry());
  });

  test('lives in the asset-sync folder, so it is swapped in with the content it describes', async () => {
    await writeManifest(root, {});

    assert.equal(manifestPath(root), path.join(root, 'asset-sync', 'manifest.json'));
  });

  // Nothing to reuse is always a safe answer: every asset simply gets downloaded again.
  test('reads a missing manifest as empty', async () => {
    assert.deepEqual((await readManifest(root)).assets, {});
  });

  test('reads a damaged manifest as empty', async () => {
    await mkdir(path.join(root, 'asset-sync'), { recursive: true });
    await writeFile(manifestPath(root), '{ not json');

    assert.deepEqual((await readManifest(root)).assets, {});
  });

  test('reads a manifest from a future version as empty', async () => {
    await mkdir(path.join(root, 'asset-sync'), { recursive: true });
    await writeFile(manifestPath(root), JSON.stringify({ version: 99, assets: { 'http://e.com': entry() } }));

    assert.deepEqual((await readManifest(root)).assets, {});
  });
});

describe('revalidationHeaders', () => {
  test('asks with an ETag', () => {
    assert.deepEqual(revalidationHeaders(entry()), { 'if-none-match': '"abc"' });
  });

  test('asks with a Last-Modified', () => {
    const headers = revalidationHeaders(entry({ etag: null, lastModified: 'Tue, 01 Jul 2026 12:00:00 GMT' }));

    assert.deepEqual(headers, { 'if-modified-since': 'Tue, 01 Jul 2026 12:00:00 GMT' });
  });

  // Without one of these the server has no way to answer "has this changed?", so there is no
  // question worth asking and the asset gets downloaded again.
  test('has nothing to ask when the server gave us neither', () => {
    assert.equal(revalidationHeaders(entry({ etag: null, lastModified: null })), null);
    assert.equal(revalidationHeaders(undefined), null);
  });
});

describe('cachedFile', () => {
  test('finds the copy the manifest points at', async () => {
    await mkdir(path.join(root, 'stories', 'assets'), { recursive: true });
    await writeFile(path.join(root, 'stories', 'assets', 'hero.jpg'), 'bytes');

    assert.equal(await cachedFile(entry(), root), path.join(root, 'stories', 'assets', 'hero.jpg'));
  });

  // The manifest remembers it, but somebody emptied the folder. Download it again.
  test('reports nothing when the file is gone', async () => {
    assert.equal(await cachedFile(entry(), root), null);
  });

  test('reports nothing for an asset that was never downloaded', async () => {
    assert.equal(await cachedFile(undefined, root), null);
  });
});

describe('extensionOf', () => {
  test('keeps a reused file named the way it already was', () => {
    assert.equal(extensionOf(entry({ file: 'stories/assets/clip.mp4' })), 'mp4');
  });
});
