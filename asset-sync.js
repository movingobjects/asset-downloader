#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { collectAssetRefs, groupByUrl, joinPath } from './lib/assets.js';
import { loadConfig, pathsFor } from './lib/config.js';
import { check, UserError } from './lib/error.js';
import { acquire } from './lib/lock.js';
import * as log from './lib/log.js';
import { readManifest, writeManifest } from './lib/manifest.js';
import { downloadAssets, fetchJson } from './lib/net.js';
import { commit, discard, prepare, recover, tempPath } from './lib/publish.js';
import { install, uninstall } from './lib/schedule.js';
import { VERSION } from './lib/version.js';

/**
 * One sync. Everything is built in a temp folder first, and the live output folder is only touched
 * once every source has arrived intact — and then all at once, by rename. A run that fails, or dies,
 * leaves the kiosk with exactly the content it had before: complete, and a night old.
 */
async function sync(config, options) {
  log.intro(config, options);

  // A dry run promises to leave the disk alone, and that has to include the folders a real run
  // would quietly create for itself. It only ever names the temp folder; it never makes one.
  if (!options.dryRun && (await recover(config.baseOutputDir))) log.recovered(config.baseOutputDir);

  const manifest = await readManifest(config.baseOutputDir);
  const temp = options.dryRun ? tempPath(config.baseOutputDir) : await prepare(config.baseOutputDir);

  const assets = {}; // url -> entry, becoming the manifest of the folder we are building
  const totals = { downloaded: 0, reused: 0, bytes: 0 };
  const failed = [];

  try {
    for (const [index, source] of config.sources.entries()) {
      const built = await buildSource(source, index, { config, temp, manifest, assets, totals, options });
      if (!built) failed.push(source);
    }

    if (options.dryRun) {
      log.dryRun();
      return 0;
    }

    // All or nothing. Publishing the sources that did work would leave the folder half old and
    // half new, and no way to tell which half — worse than simply trying again tomorrow night.
    if (failed.length > 0) {
      log.aborted(config.baseOutputDir, failed);
      return 1;
    }

    await writeManifest(temp, assets);
    await commit(config.baseOutputDir, temp);

    log.written(config.baseOutputDir, totals);
    return 0;
  } finally {
    if (!options.dryRun) await discard(temp); // a no-op once it has been renamed into place
  }
}

/** Brings down one source's JSON and every asset it references, into the temp folder. */
async function buildSource(source, index, { config, temp, manifest, assets, totals, options }) {
  log.source(index + 1, config.sources.length, source.url);

  // 1. Read the JSON. Without it there is nothing to build.
  let data;
  try {
    data = await fetchJson(source.url);
  } catch (error) {
    log.failed([{ url: source.url, error }], source);
    return false;
  }

  // 2. Find the assets the JSON references, and say where each one is headed.
  const refs = collectAssetRefs(data, source.assetFields);

  for (const ref of refs) {
    ref.tempDir = path.join(temp, source.outputFolder, source.assetFolder); // where the bytes land now
    ref.pathDir = source.assetFolder; // what the JSON will say, relative to the JSON file beside it
    ref.relDir = joinPath(source.outputFolder, source.assetFolder); // what the manifest will say
  }

  const jobs = groupByUrl(refs);
  log.referenced(jobs.length);

  if (options.dryRun) {
    log.wouldWrite(jobs, source, config.baseOutputDir);
    return true;
  }

  // 3. Fetch every asset, reusing the copies that haven't changed. One failure is enough to call
  //    the run off, but we let the rest finish first, so one night reports everything that's broken.
  if (jobs.length > 0) {
    const result = await downloadAssets(jobs, options.concurrency, {
      manifest,
      liveDir: config.baseOutputDir,
      reuseOnly: options.reuseAssets,
      onProgress: log.progress
    });

    if (result.failures.length > 0) {
      log.failed(result.failures, source);
      return false;
    }

    Object.assign(assets, result.assets);
    totals.downloaded += result.downloaded;
    totals.reused += result.reused;
    totals.bytes += result.bytes;

    log.assets(result);
  }

  // 4. The assets are all on disk, so the JSON now pointing at them is safe to write.
  const { dataPath } = pathsFor(source, temp);
  await mkdir(path.dirname(dataPath), { recursive: true });
  await writeFile(dataPath, JSON.stringify(data, null, 2));

  log.staged(source);
  return true;
}

// CLI

const CONFIG_FILE = 'asset-sync.config.json';

const USAGE = `
  Usage: asset-sync [command] [options]

  Downloads JSON data sources and the assets they reference into one output folder,
  rewriting the asset URLs in the JSON to point at the local copies. Assets the server
  says have not changed are reused rather than downloaded again.

  The folder is rebuilt in full each run and swapped into place only once every source
  has arrived intact, so it is never left half updated. If anything fails, the run exits 1
  and the folder is left exactly as it was.

  The first run in a folder writes a starter ${CONFIG_FILE} and stops,
  so you can point it at your data sources.

  Commands:
    sync                  Download and publish (default)
    install               Run a sync every day, unattended
    uninstall             Stop running the daily sync

  Options:
    -c, --config <file>   Config file to read        (default: ${CONFIG_FILE})
    -r, --reuse-assets    Refresh the JSON only, keeping the assets already on disk
    -n, --concurrency <n> Parallel downloads         (default: 8)
        --at <HH:MM>      Time of the daily sync     (default: 03:00, install only)
        --dry-run         Report without writing
    -h, --help            Show this message
    -v, --version         Show version

  The log and the lock file sit beside the config file. The manifest of what was
  downloaded sits in an asset-sync/ folder inside the output folder.
`;

const TEMPLATE = `{
  "baseOutputDir": "./content",
  "sources": [
    {
      "url": "https://example.com/api/content",
      "outputFolder": "stories",
      "assetFields": ["stories.img"]
    }
  ]
}
`;

/**
 * The first run in a folder has nothing to sync, so it leaves behind a config to fill in. Writing
 * exclusively is what makes that safe to attempt on every run: an existing config is never opened
 * for writing at all, so it cannot be clobbered by a race, a crash, or a full disk.
 */
async function scaffoldConfig(file) {
  try {
    await writeFile(file, TEMPLATE, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return false; // already configured — get on with the sync
    throw error;
  }

  log.created(file);
  return true;
}

/** The log and the lock belong to the config, not to the output folder — which is replaced nightly. */
const beside = (configFile, ext) => configFile.replace(/(\.config)?\.json$/, '') + ext;

async function main() {
  let args, command;

  try {
    const parsed = parseArgs({
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c', default: CONFIG_FILE },
        'reuse-assets': { type: 'boolean', short: 'r', default: false },
        concurrency: { type: 'string', short: 'n', default: '8' },
        at: { type: 'string', default: '03:00' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false }
      }
    });

    args = parsed.values;
    [command = 'sync'] = parsed.positionals;
  } catch (error) {
    throw new UserError(error.message);
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  if (args.version) {
    console.log(VERSION);
    return 0;
  }

  check(
    ['sync', 'install', 'uninstall'].includes(command),
    `Unknown command: ${command}\n  Expected one of: sync, install, uninstall`
  );

  const configFile = path.resolve(args.config);

  if (command === 'uninstall') {
    log.unscheduled(await uninstall());
    return 0;
  }

  if (command === 'install') {
    await loadConfig(configFile); // no point scheduling a config that will not load at 3am
    log.scheduled(args.at, await install(configFile, args.at));
    return 0;
  }

  const concurrency = Number(args.concurrency);
  check(
    Number.isInteger(concurrency) && concurrency > 0,
    `--concurrency must be a positive integer, got: ${args.concurrency}`
  );

  // The log is opened before the config is read, and its name comes from the config's, not its
  // contents. A config that has stopped loading is exactly the kind of thing a 3am run has to
  // leave a record of, and it is the only record anyone will get.
  await log.openLog(beside(configFile, '.log'));

  // Only the default config is scaffolded. A --config that names a missing file is a typo, and
  // deserves to be reported as one rather than answered with a starter config the user didn't ask for.
  const usingDefaultConfig = args.config === CONFIG_FILE;
  if (usingDefaultConfig && (await scaffoldConfig(configFile))) return 0;

  const config = await loadConfig(configFile);
  const release = await acquire(beside(configFile, '.lock'));

  try {
    return await sync(config, {
      reuseAssets: args['reuse-assets'],
      dryRun: args['dry-run'],
      concurrency
    });
  } finally {
    await release();
  }
}

/**
 * Run only when invoked directly, not when imported by something else.
 *
 * Being run as a script is the only case that needs looking at, and the path is resolved before
 * comparing because npm installs this bin as a symlink, whose path would never match this module's
 * real one. Anything that is not a script — the npm symlink, the compiled binary — is by definition
 * being run rather than imported.
 */
function invokedDirectly() {
  const script = process.argv[1];
  if (!script) return false;
  if (!script.endsWith('.js')) return true;

  return realpathSync(script) === fileURLToPath(import.meta.url);
}

if (invokedDirectly()) {
  try {
    process.exitCode = await main();
  } catch (error) {
    log.fatal(error, { verbose: !(error instanceof UserError) });
    process.exitCode = error instanceof UserError ? 2 : 1;
  } finally {
    await log.closeLog();
  }
}
