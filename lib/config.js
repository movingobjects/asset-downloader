import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { check, UserError } from './error.js';

/** The one folder inside `baseOutputDir` that belongs to us, not to a source. */
export const STATE_DIR = 'asset-sync';

export async function loadConfig(file) {
  const abs = path.resolve(file);

  let raw;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new UserError(`Config file not found: ${abs}`);
  }

  try {
    // A relative baseOutputDir is anchored to the config file, not to wherever we were started
    // from. See normalizeConfig.
    return { ...normalizeConfig(JSON.parse(raw), path.dirname(abs)), file: abs };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Config file is not valid JSON: ${abs}\n  ${error.message}`);
  }
}

/**
 * `from` is what a relative `baseOutputDir` is measured against, and it is the folder holding the
 * config file — never the working directory.
 *
 * The working directory is not ours to rely on. A scheduler hands us whatever it likes: launchd
 * starts the job in `/`, where `./content` means `/content` and the run dies on a read-only disk.
 * The config file, on the other hand, is somewhere we were told about and is sitting still, so a
 * path written next to it means the same thing at 3am as it did when it was typed.
 */
export function normalizeConfig(config, from = process.cwd()) {
  check(isObject(config), `Config must be a JSON object`);
  check(isText(config.baseOutputDir), `Config must include a "baseOutputDir" string`);
  check(
    Array.isArray(config.sources) && config.sources.length > 0,
    `Config must include a non-empty "sources" array`
  );

  const sources = config.sources.map(normalizeSource);
  checkSourcesDoNotShareAFolder(sources);

  return { baseOutputDir: path.resolve(from, expandHome(config.baseOutputDir)), sources };
}

/**
 * A source owns one folder inside `baseOutputDir`, holding its JSON and the assets that JSON points
 * at. Every name here is a plain one — no separators, nothing that climbs out — which is what lets
 * `assetFolder` do double duty: it is the folder on disk, and, being a sibling of the JSON file,
 * it is also the path written into the JSON. The two cannot disagree.
 */
function normalizeSource(source, i) {
  const at = `sources[${i}]`;

  check(isObject(source), `${at} must be an object`);
  check(isText(source.url), `${at} must include a "url" string`);
  check(URL.canParse(source.url), `${at}.url is not a valid URL: ${source.url}`);

  const outputFolder = source.outputFolder;
  check(isPlainName(outputFolder), `${at} must include an "outputFolder" name, e.g. "stories"`);
  check(
    outputFolder !== STATE_DIR,
    `${at}.outputFolder cannot be "${STATE_DIR}" — Asset Sync keeps its manifest there`
  );

  const dataFile = source.dataFile ?? 'data.json';
  check(isPlainName(dataFile), `${at}.dataFile must be a file name, e.g. "data.json"`);

  const assetFolder = source.assetFolder ?? 'assets';
  check(isPlainName(assetFolder), `${at}.assetFolder must be a folder name, e.g. "assets"`);

  const assetFields = source.assetFields ?? [];
  check(
    Array.isArray(assetFields) && assetFields.every(isText),
    `${at}.assetFields must be an array of field paths, e.g. ["stories.img"]`
  );

  return { url: source.url, outputFolder, dataFile, assetFolder, assetFields };
}

/**
 * Asset file names come from the JSON fields that found them, so two sources sharing a folder can
 * quietly overwrite each other's files. Giving every source a folder of its own rules that out for
 * good, and costs nothing: a folder is free.
 */
function checkSourcesDoNotShareAFolder(sources) {
  const taken = new Set();

  for (const [i, { outputFolder }] of sources.entries()) {
    check(
      !taken.has(outputFolder),
      `sources[${i}] uses the "outputFolder" ${JSON.stringify(outputFolder)}, and so does an earlier source — give each source its own folder`
    );
    taken.add(outputFolder);
  }
}

/** Where a source's files sit under `root` — the live output folder, or the temp one being built. */
export function pathsFor(source, root) {
  const folder = path.join(root, source.outputFolder);

  return {
    folder,
    dataPath: path.join(folder, source.dataFile),
    assetPath: path.join(folder, source.assetFolder)
  };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** A file or folder sitting directly inside its parent: no separators, and no climbing out of it. */
const isPlainName = (value) => isText(value) && !/[/\\]/.test(value) && !/^\.+$/.test(value);

const expandHome = (p) => (p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p);
