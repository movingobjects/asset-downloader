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
    throw new UserError(`Config file not found: ${abs}\n  Run with --init to write a starter config here.`);
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
  check(isText(config.outDir), `Config must include an "outDir" string`);
  check(
    Array.isArray(config.sources) && config.sources.length > 0,
    `Config must include a non-empty "sources" array`
  );

  return {
    outDir: expandHome(config.outDir),
    publicPath: trimSlashes(config.publicPath ?? ''),
    sources: config.sources.map(normalizeSource)
  };
}

function normalizeSource(source, i) {
  const at = `sources[${i}]`;

  check(isObject(source), `${at} must be an object`);
  check(isText(source.url), `${at} must include a "url" string`);
  check(URL.canParse(source.url), `${at}.url is not a valid URL: ${source.url}`);

  const assets = source.assets ?? [];
  check(
    Array.isArray(assets) && assets.every(isText),
    `${at}.assets must be an array of field paths, e.g. ["stories.img"]`
  );

  return {
    url: source.url,
    dir: trimSlashes(source.dir ?? ''),
    file: source.file ?? 'data.json',
    assets
  };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';

const expandHome = (p) => (p.startsWith('~') ? path.join(homedir(), p.slice(1)) : p);
const trimSlashes = (p) => p.replace(/^\/+|\/+$/g, '');
