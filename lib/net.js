import { createWriteStream } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { extensionFor, joinPath, localize, targetsFor } from './assets.js';
import { cachedFile, extensionOf, revalidationHeaders } from './manifest.js';

const RETRIES = 2;

export async function fetchJson(url) {
  const res = await fetchWithRetry(url, { headers: { accept: 'application/json' } });
  return res.json();
}

/**
 * Brings every job's asset into the temp folder — by downloading it, or, when the server says the
 * copy we already have is still current, by copying that one across. Either way the temp folder
 * ends up holding a real file, and the JSON is pointed at it.
 *
 * A failed asset is collected rather than thrown, so one dead URL doesn't stop the run short of
 * finding out what else is broken.
 */
export async function downloadAssets(jobs, limit, options) {
  const { manifest, liveDir, reuseOnly = false, onProgress } = options;

  const failures = [];
  const assets = {}; // url -> entry, becoming the manifest of what we just built
  let downloaded = 0;
  let reused = 0;
  let bytes = 0;
  let done = 0;

  await pool(jobs, limit, async (job) => {
    try {
      const result = await syncAsset(job, {
        manifest,
        liveDir,
        reuseOnly,
        onBytes: (n) => onProgress(done, jobs.length, (bytes += n))
      });

      assets[job.url] = result.entry;
      result.reused ? reused++ : downloaded++;
    } catch (error) {
      failures.push({ url: job.url, error });
    }

    onProgress(++done, jobs.length, bytes);
  });

  return { failures, assets, downloaded, reused, bytes };
}

/** Decides, for one asset, whether the copy on disk will do — and gets the bytes either way. */
async function syncAsset(job, { manifest, liveDir, reuseOnly, onBytes }) {
  const entry = manifest.assets[job.url];
  const local = await cachedFile(entry, liveDir);

  if (reuseOnly) {
    if (!local) throw new Error('No local copy to reuse — run a full sync first');
    return { entry: await reuse(job, entry, local), reused: true };
  }

  const headers = local ? revalidationHeaders(entry) : null;
  const res = await fetchWithRetry(job.url, headers ? { headers } : undefined);

  // 304: the server has looked at what we have and told us not to bother.
  if (res.status === 304) return { entry: await reuse(job, entry, local), reused: true };

  return { entry: await download(job, res, onBytes), reused: false };
}

/** Copies the file we already had into the temp folder, under whatever names this run wants. */
async function reuse(job, entry, local) {
  const targets = targetsFor(job, extensionOf(entry));

  await copyInto(targets, local);
  localize(targets);

  return { ...record(targets[0]), etag: entry.etag, lastModified: entry.lastModified, size: entry.size };
}

/**
 * Fetches one asset and writes it to each of its refs' filenames. The extension comes from the
 * final URL after redirects, so no separate HEAD request is needed.
 */
async function download(job, res, onBytes) {
  const targets = targetsFor(job, extensionFor(res.url, res.headers.get('content-type')));

  const [primary, ...copies] = targets;
  const primaryPath = path.join(primary.ref.tempDir, primary.file);
  let size = 0;

  const count = (n) => {
    size += n;
    onBytes(n);
  };

  // A connection that dies mid-stream throws here, leaving a truncated file behind. That is fine:
  // the whole run is called off, and the temp folder it was building is thrown away unpublished.
  await mkdir(path.dirname(primaryPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), countBytes(count), createWriteStream(primaryPath));

  await copyInto(copies, primaryPath);
  localize(targets);

  return {
    ...record(primary),
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    size
  };
}

/** Where a target's file lands, said the way the manifest says it: relative to the output folder. */
const record = (target) => ({ file: joinPath(target.ref.relDir, target.file) });

async function copyInto(targets, file) {
  for (const target of targets) {
    const dest = path.join(target.ref.tempDir, target.file);

    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(file, dest);
  }
}

/** Passes chunks straight through, reporting how many bytes go by. */
const countBytes = (onBytes) =>
  async function* (chunks) {
    for await (const chunk of chunks) {
      onBytes(chunk.length);
      yield chunk;
    }
  };

/** Retries network errors and transient server errors, but not 4xx — those won't fix themselves. */
async function fetchWithRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    let retryable = true;

    try {
      const res = await fetch(url, init);
      if (res.ok || res.status === 304) return res; // 304 is an answer, not a failure

      retryable = res.status === 429 || res.status >= 500;
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (error) {
      if (!retryable || attempt >= RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    }
  }
}

/** Runs `worker` over `items`, `limit` at a time. */
async function pool(items, limit, worker) {
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await worker(items[next++]);
    }
  });

  await Promise.all(workers);
}
