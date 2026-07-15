import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { check, UserError } from './error.js';

const exec = promisify(execFile);

const LABEL = 'io.movingobjects.asset-sync'; // launchd
const TASK = 'Asset Sync'; // Task Scheduler

/** Installs a daily sync at `at`, given as 24-hour "HH:MM". Returns what it did, for the log. */
export async function install(configFile, at) {
  const [hour, minute] = parseTime(at);
  const argv = command(configFile);

  switch (process.platform) {
    case 'darwin':
      return installLaunchAgent(argv, hour, minute);
    case 'win32':
      return installScheduledTask(argv, at);
    default:
      throw new UserError(`No scheduler support for ${process.platform} — set up a cron job by hand.`);
  }
}

export async function uninstall() {
  switch (process.platform) {
    case 'darwin':
      return uninstallLaunchAgent();
    case 'win32':
      return uninstallScheduledTask();
    default:
      throw new UserError(`No scheduler support for ${process.platform}.`);
  }
}

/**
 * How to run this program again from a scheduler, which hands us no shell and no working directory.
 * A compiled binary is its own command; running from source needs node and the script in front of it.
 * Every path is absolute, because nothing about where we are now survives until 3am.
 */
function command(configFile) {
  const script = process.argv[1];
  const fromSource = typeof script === 'string' && script.endsWith('.js');
  const self = fromSource ? [process.execPath, path.resolve(script)] : [process.execPath];

  return [...self, 'sync', '--config', path.resolve(configFile)];
}

// macOS

async function installLaunchAgent(argv, hour, minute) {
  const file = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n')}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
</dict>
</plist>
`;

  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, plist);

  await exec('launchctl', ['unload', file]).catch(() => {}); // fails when it was never loaded
  await exec('launchctl', ['load', '-w', file]);

  return file;
}

async function uninstallLaunchAgent() {
  const file = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

  await exec('launchctl', ['unload', file]).catch(() => {});
  await rm(file, { force: true });

  return file;
}

// Windows

async function installScheduledTask(argv, at) {
  const [self, ...rest] = argv;
  const run = [`"${self}"`, ...rest.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))].join(' ');

  await exec('schtasks', ['/Create', '/TN', TASK, '/SC', 'DAILY', '/ST', at, '/TR', run, '/F']);

  return `Task Scheduler — "${TASK}"`;
}

async function uninstallScheduledTask() {
  await exec('schtasks', ['/Delete', '/TN', TASK, '/F']).catch(() => {});

  return `Task Scheduler — "${TASK}"`;
}

export function parseTime(at) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at ?? '');
  check(match, `--at must be a 24-hour time, e.g. "03:00" — got: ${at}`);

  const [hour, minute] = [Number(match[1]), Number(match[2])];
  check(hour < 24 && minute < 60, `--at is not a real time: ${at}`);

  return [hour, minute];
}

const escapeXml = (text) =>
  text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
