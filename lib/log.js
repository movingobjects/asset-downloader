import { createWriteStream } from 'node:fs';
import { rename, stat } from 'node:fs/promises';
import { styleText } from 'node:util';

const BAR_WIDTH = 28;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const tty = process.stdout.isTTY;
const paint = (style, text) => (tty && !process.env.NO_COLOR ? styleText(style, String(text)) : String(text));

const dim = (text) => paint('gray', text);
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

// Log file
//
// A sync started by the scheduler at 3am has nobody watching it, so everything printed is also
// written to a log file. The file lives beside the config, never inside the output folder: that
// folder is thrown away and rebuilt on every run, and the run you most want a log of is the one
// that failed and got discarded.

let logFile = null;

export async function openLog(file) {
  try {
    if ((await stat(file)).size > MAX_LOG_BYTES) await rename(file, `${file}.1`);
  } catch {
    // No log yet, or it can't be rotated. Either way there is still an append to try.
  }

  const stream = createWriteStream(file, { flags: 'a' });

  // A log we cannot write is not a reason to fail a sync. Drop it and carry on printing.
  stream.on('error', () => (logFile = null));
  logFile = stream;
}

export function closeLog() {
  const stream = logFile;
  logFile = null;

  return stream ? new Promise((resolve) => stream.end(resolve)) : Promise.resolve();
}

const ANSI = /\x1b\[[0-9;]*m/g;

function record(text) {
  if (!logFile) return;

  const plain = String(text).replace(ANSI, '').trimEnd();
  logFile.write(plain ? `${new Date().toISOString()}  ${plain}\n` : '\n');
}

const line = (text = '') => {
  console.log(text);
  record(text);
};

const heading = (text) => {
  console.log(`${paint('cyan', `▌ ${text}`)}\n`);
  record(`▌ ${text}`);
};

// Run

export function intro(config, { reuseAssets, dryRun }) {
  heading(`Asset Sync`);
  line(`  config     ${dim(config.file)}`);
  line(`  output     ${dim(config.baseOutputDir)}`);
  line(`  sources    ${dim(config.sources.length)}`);
  if (reuseAssets) line(`  ${paint('yellow', 'reuse')}      ${dim('refreshing JSON, keeping the assets already on disk')}`);
  if (dryRun) line(`  ${paint('yellow', 'dry-run')}    ${dim('nothing will be downloaded or written')}`);
  line();
}

export function recovered(baseOutputDir) {
  line(`  ${paint('yellow', '⤺')} recovered ${dim(baseOutputDir)} ${dim('from an interrupted run')}`);
  line();
}

export function source(index, total, url) {
  heading(`Source ${index}/${total}  ${url}`);
}

export function referenced(count) {
  line(`  ${dim(`${count || 'no'} asset${count === 1 ? '' : 's'} referenced`)}`);
}

export function progress(done, total, bytes) {
  if (!tty) return;

  const filled = Math.round(BAR_WIDTH * (done / total));
  const bar = paint('cyan', '█'.repeat(filled)) + dim('━'.repeat(BAR_WIDTH - filled));
  const count = `${String(done).padStart(String(total).length)}/${total}`;

  process.stdout.write(`\r  ${bar} ${dim(count)}  ${dim(formatBytes(bytes))}   `);
}

export function assets({ downloaded, reused, bytes }) {
  erase();

  const parts = [];
  if (downloaded > 0) parts.push(`${paint('cyan', downloaded)} downloaded ${dim(`(${formatBytes(bytes)})`)}`);
  if (reused > 0) parts.push(`${paint('green', reused)} reused ${dim('(unchanged)')}`);

  line(`  ${parts.join(dim('  ·  '))}`);
}

export function staged(source) {
  line(`  ${dim(`${source.outputFolder}/ ready`)}`);
  line();
}

/** Assets that could not be brought down. Their source cannot be built, so the run is off. */
export function failed(failures, source) {
  erase();
  line();
  line(`  ${paint('red', `✗ ${plural(failures.length, 'failure')}`)}`);
  line();

  for (const { url, error } of failures) {
    line(`    ${url}`);
    line(`    ${paint('red', error.message)}`);
    line();
  }

  line(`  ${dim(`source ${source.url} could not be rebuilt`)}`);
  line();
}

export function wouldWrite(jobs, source, baseOutputDir) {
  if (jobs.length > 0) {
    line(`  ${dim('would fetch:')}`);
    for (const job of jobs) line(`    ${dim(job.url)}`);
  }

  line(`  ${dim(`would write ${source.outputFolder}/ into ${baseOutputDir}`)}`);
  line();
}

// Outcome

export function written(baseOutputDir, totals) {
  heading(`Content updated`);
  line(`  ${dim(baseOutputDir)}`);
  line();
  line(`  ${paint('cyan', totals.downloaded)} downloaded ${dim(`(${formatBytes(totals.bytes)})`)}`);
  line(`  ${paint('green', totals.reused)} reused ${dim('(unchanged since the last sync)')}`);
  line();

  // A server that sends no ETag or Last-Modified can never be asked whether a file changed, so
  // every one of its assets is fetched again, every night. Worth knowing about, and invisible
  // otherwise: the sync still works, it just never gets any cheaper.
  if (totals.reused === 0 && totals.downloaded > 0) {
    line(`  ${dim('Nothing was reused. If that repeats on an unchanged run, the server is not')}`);
    line(`  ${dim('sending ETag or Last-Modified headers, and assets cannot be cached.')}`);
    line();
  }
}

export function aborted(baseOutputDir, sources) {
  heading(`${plural(sources.length, 'source')} failed — nothing was written`);

  for (const source of sources) line(`  ${paint('red', '✗')} ${source.url}`);

  line();
  line(`  ${dim(`${baseOutputDir} was left exactly as it was.`)}`);
  line();
}

export function dryRun() {
  heading(`Dry run complete — nothing was written`);
}

export function created(file) {
  heading(`Wrote a starter config`);
  line(`  ${dim(file)}`);
  line();
  line(`  ${dim('Point it at your data sources, then run again to sync.')}`);
  line();
}

export function scheduled(when, detail) {
  heading(`Scheduled a daily sync at ${when}`);
  line(`  ${dim(detail)}`);
  line();
}

export function unscheduled(detail) {
  heading(`Removed the scheduled sync`);
  line(`  ${dim(detail)}`);
  line();
}

export function fatal(error, { verbose }) {
  erase();
  console.error();
  console.error(`  ${paint('red', verbose ? 'Unexpected error' : 'Error')} ${verbose ? '' : error.message}`);
  if (verbose) console.error(error);
  console.error();

  record(`Error ${error.message}`);
  if (verbose && error.stack) record(error.stack);
}

const erase = () => tty && process.stdout.write('\r\x1b[K'); // clear the progress bar

function formatBytes(bytes) {
  const MB = 1024 * 1024;
  return bytes < MB ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / MB).toFixed(1)} MB`;
}
