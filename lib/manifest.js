import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { STATE_DIR } from './config.js';

const FILE = 'manifest.json';
const VERSION = 1;

export const manifestPath = (root) => path.join(root, STATE_DIR, FILE);

/**
 * What the last successful sync left on disk: for every asset URL, the file it became and whatever
 * the server said about its version. It is written into the folder it describes and swapped in with
 * it, so the two can never drift apart.
 *
 * A missing or damaged manifest is not an error. It only means nothing can be reused, and every
 * asset is downloaded again — slower, but never wrong.
 */
export async function readManifest(root) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(root), 'utf8'));
    if (parsed?.version !== VERSION || !isObject(parsed.assets)) return { assets: {} };
    return { assets: parsed.assets };
  } catch {
    return { assets: {} };
  }
}

export async function writeManifest(root, assets) {
  const file = manifestPath(root);
  const body = { version: VERSION, syncedAt: new Date().toISOString(), assets };

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2));
}

/**
 * What we can tell the server about the copy we already have, so it can answer "has this changed?"
 * with a 304 instead of the file. A server that sent neither an ETag nor a Last-Modified has given
 * us nothing to ask with, so there is no question to put to it and the asset is downloaded again.
 */
export function revalidationHeaders(entry) {
  const headers = {};

  if (entry?.etag) headers['if-none-match'] = entry.etag;
  if (entry?.lastModified) headers['if-modified-since'] = entry.lastModified;

  return Object.keys(headers).length > 0 ? headers : null;
}

/** The copy we already have, if it is still sitting where the manifest says it is. */
export async function cachedFile(entry, liveDir) {
  if (!entry?.file) return null;

  const file = path.resolve(liveDir, ...entry.file.split('/'));

  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null; // the manifest remembers it, but the file is gone
  }
}

/** The extension a reused file already carries, so its name stays what it was. */
export const extensionOf = (entry) => path.posix.extname(entry.file).slice(1);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
