import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { check, UserError } from './error.js';

export async function loadConfig(file) {
  const abs = path.resolve(file);

  let raw;
  try {
    raw = await readFile(abs, 'utf8');
  } catch {
    throw new UserError(`Config file not found: ${abs}`);
  }

  try {
    return { ...normalizeConfig(JSON.parse(raw)), file: abs };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`Config file is not valid JSON: ${abs}\n  ${error.message}`);
  }
}

export function normalizeConfig(config) {
  check(isObject(config), `Config must be a JSON object`);
  check(isText(config.outputDir), `Config must include an "outputDir" string`);
  check(
    Array.isArray(config.sources) && config.sources.length > 0,
    `Config must include a non-empty "sources" array`
  );

  const outputDir = path.resolve(expandHome(config.outputDir));
  const sources = config.sources.map((source, i) => normalizeSource(source, i, outputDir));
  checkSourcesDoNotCollide(sources);

  return { outputDir, sources };
}

/**
 * A source writes two things, and both sit directly inside the shared `outputDir`: a JSON file,
 * and a folder of the assets that JSON points at. Keeping `assetsFolder` a plain name — no
 * separators, nothing that climbs out — is what lets it do double duty: it is the folder on disk,
 * and, being a sibling of the JSON file, it is also the path written into the JSON. The two cannot
 * disagree. `dataFile` and `assetsFolder` are required (rather than defaulted) because every
 * source shares one `outputDir`, so nothing keeps two sources apart unless each names its own.
 */
function normalizeSource(source, i, outputDir) {
  const at = `sources[${i}]`;

  check(isObject(source), `${at} must be an object`);
  check(isText(source.url), `${at} must include a "url" string`);
  check(URL.canParse(source.url), `${at}.url is not a valid URL: ${source.url}`);

  check(isText(source.dataFile), `${at} must include a "dataFile" string`);
  check(isPlainName(source.dataFile), `${at}.dataFile must be a file name, e.g. "data.json"`);

  check(isText(source.assetsFolder), `${at} must include an "assetsFolder" string`);
  check(isPlainName(source.assetsFolder), `${at}.assetsFolder must be a folder name, e.g. "assets"`);

  const assetFields = source.assetFields ?? [];
  check(
    Array.isArray(assetFields) && assetFields.every(isText),
    `${at}.assetFields must be an array of field paths, e.g. ["stories.img"]`
  );

  return {
    url: source.url,
    outputDir,
    dataFile: source.dataFile,
    assetsFolder: source.assetsFolder,
    assetFields,
    dataPath: path.join(outputDir, source.dataFile),
    assetPath: path.join(outputDir, source.assetsFolder)
  };
}

/**
 * An asset folder is deleted and rewritten in full on every run, and two sources writing one JSON
 * file leave the loser pointing at assets that are no longer on disk. Either way a source quietly
 * destroys another's work, so both are caught here, before the first byte is fetched, rather than
 * halfway through a run that has already published one of them.
 */
function checkSourcesDoNotCollide(sources) {
  const dataPaths = new Set();
  const assetPaths = new Set();

  for (const { dataPath, assetPath, assetFields } of sources) {
    check(!dataPaths.has(dataPath), `Two sources both write ${dataPath} — give one of them its own "dataFile"`);
    dataPaths.add(dataPath);

    if (assetFields.length === 0) continue; // a source with no assets never touches an asset folder

    check(
      !assetPaths.has(assetPath),
      `Two sources both download assets into ${assetPath} — give one of them its own "assetsFolder"`
    );
    assetPaths.add(assetPath);
  }

  // A source's own JSON is always safe — it sits beside its asset folder, never inside it. But
  // another source's dataFile may well be nested in there, and would be deleted along with it.
  for (const assetPath of assetPaths) {
    for (const dataPath of dataPaths) {
      check(
        !contains(assetPath, dataPath),
        `The "assetsFolder" ${assetPath} is emptied on every run, and ${dataPath} sits inside it`
      );
    }
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

/** A file or folder sitting directly inside `outputDir`: no separators, and no climbing out of it. */
const isPlainName = (value) => isText(value) && !/[/\\]/.test(value) && !/^\.+$/.test(value);

const expandHome = (p) => (p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p);

/** True if `file` is `dir` itself, or sits anywhere beneath it. */
function contains(dir, file) {
  const rel = path.relative(dir, file);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
