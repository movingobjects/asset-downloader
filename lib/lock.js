import { readFile, rm, writeFile } from 'node:fs/promises';

import { UserError } from './error.js';

const STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps two syncs from running at once. A nightly sync that outruns its window and meets the next
 * one would have both of them building the same temp folder, and neither would end up with a
 * folder worth publishing.
 *
 * Writing exclusively is what makes the claim safe: the file is only ever created, never opened
 * for writing, so two runs racing for it cannot both win.
 */
export async function acquire(file, { retry = true } = {}) {
  const held = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });

  try {
    await writeFile(file, held, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;

    // Somebody holds it. If they are dead or ancient, the lock outlived its run: take it over.
    if (!retry || !(await isAbandoned(file))) {
      throw new UserError(`Another sync is already running.\n  If it isn't, delete ${file} and try again.`);
    }

    await rm(file, { force: true });
    return acquire(file, { retry: false });
  }

  return () => rm(file, { force: true });
}

/** A lock whose run is no longer alive, or that is old enough that it cannot plausibly be. */
async function isAbandoned(file) {
  let held;

  try {
    held = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return true; // unreadable, so nothing to respect
  }

  if (Date.now() - Date.parse(held.startedAt) > STALE_MS) return true;

  try {
    process.kill(held.pid, 0); // no signal sent — this only asks whether the process is there
    return false;
  } catch (error) {
    return error.code === 'ESRCH'; // EPERM means it exists and isn't ours, so it is very much alive
  }
}
