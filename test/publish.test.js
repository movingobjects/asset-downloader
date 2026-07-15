import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { afterEach, beforeEach, describe } from 'node:test';

import { commit, discard, prepare, recover } from '../lib/publish.js';

let root, outputDir;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'publish-test-'));
  outputDir = path.join(root, 'content');
});

afterEach(() => rm(root, { recursive: true, force: true }));

const oldDir = () => path.join(root, '.content.asset-sync-old');

const write = async (dir, name, body) => {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), body);
};

const read = (dir, name) => readFile(path.join(dir, name), 'utf8');

const exists = async (file) => {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    return error.code !== 'ENOENT';
  }
};

describe('prepare', () => {
  // The swap is a rename, and a rename cannot cross volumes. The system temp folder is on another
  // drive often enough on a kiosk that building there would fail at the very last step.
  test('builds the temp folder beside the output folder, on the same volume', async () => {
    const temp = await prepare(outputDir);

    assert.equal(path.dirname(temp), path.dirname(outputDir));
  });

  test('clears out whatever a run that died left behind', async () => {
    const temp = await prepare(outputDir);
    await write(temp, 'half-downloaded.jpg', 'junk');

    const again = await prepare(outputDir);

    assert.equal(await exists(path.join(again, 'half-downloaded.jpg')), false);
  });
});

describe('commit', () => {
  test('swaps the new folder in, whole', async () => {
    await write(outputDir, 'data.json', 'old');

    const temp = await prepare(outputDir);
    await write(temp, 'data.json', 'new');
    await commit(outputDir, temp);

    assert.equal(await read(outputDir, 'data.json'), 'new');
    assert.equal(await exists(temp), false);
    assert.equal(await exists(oldDir()), false, 'the old folder should be cleaned up');
  });

  test('publishes into a folder that does not exist yet', async () => {
    const temp = await prepare(outputDir);
    await write(temp, 'data.json', 'first');

    await commit(outputDir, temp);

    assert.equal(await read(outputDir, 'data.json'), 'first');
  });

  test('leaves nothing of the old content behind', async () => {
    await write(outputDir, 'gone.json', 'stale');

    const temp = await prepare(outputDir);
    await write(temp, 'data.json', 'new');
    await commit(outputDir, temp);

    assert.equal(await exists(path.join(outputDir, 'gone.json')), false);
  });
});

describe('recover', () => {
  // commit renames twice. Losing power between the two is the one moment in a run where the output
  // folder does not exist at all — the next run has to put that right before it does anything else.
  test('restores content parked under .old when the output folder is missing', async () => {
    await write(oldDir(), 'data.json', 'last night');

    assert.equal(await recover(outputDir), true);
    assert.equal(await read(outputDir, 'data.json'), 'last night');
    assert.equal(await exists(oldDir()), false);
  });

  test('throws away a .old left by a run that died after the swap', async () => {
    await write(outputDir, 'data.json', 'new');
    await write(oldDir(), 'data.json', 'superseded');

    assert.equal(await recover(outputDir), false, 'nothing was rescued — the new content is already live');
    assert.equal(await read(outputDir, 'data.json'), 'new');
    assert.equal(await exists(oldDir()), false);
  });

  test('does nothing when there is nothing to recover', async () => {
    await write(outputDir, 'data.json', 'fine');

    assert.equal(await recover(outputDir), false);
    assert.equal(await read(outputDir, 'data.json'), 'fine');
  });
});

describe('discard', () => {
  test('leaves the live folder alone', async () => {
    await write(outputDir, 'data.json', 'live');

    const temp = await prepare(outputDir);
    await write(temp, 'data.json', 'abandoned');
    await discard(temp);

    assert.equal(await read(outputDir, 'data.json'), 'live');
    assert.equal(await exists(temp), false);
  });

  test('is happy to discard a folder already swapped into place', async () => {
    const temp = await prepare(outputDir);
    await write(temp, 'data.json', 'new');
    await commit(outputDir, temp);

    await discard(temp); // what the `finally` in a successful run does

    assert.equal(await read(outputDir, 'data.json'), 'new');
  });
});
