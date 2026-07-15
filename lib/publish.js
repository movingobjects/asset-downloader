import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * The two folders that appear beside the output folder during a swap. Both are siblings of it, and
 * so on the same volume, because a rename cannot cross volumes — and on a kiosk the content folder
 * is very often on a different drive from the system temp folder.
 */
export const tempPath = (baseOutputDir) => sibling(baseOutputDir, 'tmp');
const oldFor = (baseOutputDir) => sibling(baseOutputDir, 'old');

const sibling = (baseOutputDir, suffix) =>
  path.join(path.dirname(baseOutputDir), `.${path.basename(baseOutputDir)}.asset-sync-${suffix}`);

/** An empty folder to build the next copy of the content in, on the right volume to swap it in. */
export async function prepare(baseOutputDir) {
  const temp = tempPath(baseOutputDir);

  await mkdir(path.dirname(baseOutputDir), { recursive: true });
  await rm(temp, { recursive: true, force: true }); // whatever a run that died left behind
  await mkdir(temp, { recursive: true });

  return temp;
}

/**
 * Swaps the freshly built folder in for the live one. Two renames, each instant, so the moment
 * where the content is not there is measured in microseconds — and `recover` covers even that.
 */
export async function commit(baseOutputDir, temp) {
  const old = oldFor(baseOutputDir);
  const replacing = await exists(baseOutputDir);

  if (replacing) await rename(baseOutputDir, old);

  try {
    await rename(temp, baseOutputDir);
  } catch (error) {
    if (replacing) await rename(old, baseOutputDir); // last night's content beats no content at all
    throw error;
  }

  if (replacing) await rm(old, { recursive: true, force: true });
}

/**
 * Puts right a swap that was cut short. Losing power between `commit`'s two renames leaves the
 * content parked under the `.old` name with nothing in its place — the one moment in a run when
 * the output folder does not exist. Every run starts by checking for it.
 *
 * Returns true only when content was actually rescued, so the run can say so.
 */
export async function recover(baseOutputDir) {
  const old = oldFor(baseOutputDir);

  if (!(await exists(old))) return false;

  if (await exists(baseOutputDir)) {
    await rm(old, { recursive: true, force: true }); // died after the swap, before the cleanup
    return false;
  }

  await rename(old, baseOutputDir);
  return true;
}

export const discard = (temp) => rm(temp, { recursive: true, force: true });

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
