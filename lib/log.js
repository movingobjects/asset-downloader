import path from 'node:path';
import { styleText } from 'node:util';

const BAR_WIDTH = 28;

const tty = process.stdout.isTTY;
const paint = (style, text) => (tty && !process.env.NO_COLOR ? styleText(style, String(text)) : String(text));

const line = (text = '') => console.log(text);
const heading = (text) => console.log(`${paint('cyan', `▌ ${text}`)}\n`);
const dim = (text) => paint('gray', text);
const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function intro(config, { jsonOnly, dryRun }) {
  heading(`Asset Downloader`);
  line(`  config     ${dim(config.file)}`);
  line(`  output     ${dim(config.outDir)}`);
  if (jsonOnly) line(`  ${paint('yellow', 'json-only')}  ${dim('refreshing JSON, leaving assets alone')}`);
  if (dryRun) line(`  ${paint('yellow', 'dry-run')}    ${dim('nothing will be downloaded or written')}`);
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

export function downloaded(count, bytes) {
  erase();
  line(`  ${paint('cyan', count)} downloaded ${dim(`(${formatBytes(bytes)})`)}`);
}

export function written(dest, file, hasAssets) {
  if (hasAssets) line(`  ${dim(path.join(dest, 'assets'))}`);
  line(`  ${dim(path.join(dest, file))}`);
  line();
  line(`  ${paint('green', '✓')} updated`);
  line();
}

/** A source that could not be brought down in full. Its files on disk are left as they were. */
export function skipped(failures, dest) {
  erase();
  line();
  line(`  ${paint('red', `✗ ${plural(failures.length, 'failure')} — source skipped`)}`);
  line();

  for (const { url, error } of failures) {
    line(`    ${url}`);
    line(`    ${paint('red', error.message)}`);
    line();
  }

  line(`  ${dim(`${dest} was left unchanged`)}`);
  line();
}

export function wouldWrite(jobs, { dest, file, hasAssets }, { jsonOnly }) {
  if (jobs.length > 0) {
    line(`  ${dim(`would ${jsonOnly ? 'relink' : 'download'}:`)}`);
    for (const job of jobs) line(`    ${dim(job.url)}`);
  }

  line(`  ${dim('would write:')}`);
  if (hasAssets) line(`    ${dim(path.join(dest, 'assets'))}`);
  line(`    ${dim(path.join(dest, file))}`);
  line();
}

export function summary(total, skippedSources, { dryRun }) {
  if (dryRun) {
    heading(`Dry run complete — nothing was written`);
    return;
  }

  const updated = total - skippedSources.length;

  if (skippedSources.length === 0) {
    heading(`All ${plural(total, 'source')} updated. Great job`);
    return;
  }

  heading(`${updated} of ${plural(total, 'source')} updated`);

  for (const source of skippedSources) {
    line(`  ${paint('red', '✗')} ${source.url}`);
  }

  line();
  line(`  ${dim('Skipped sources kept the data they already had on disk.')}`);
  line();
}

export function fatal(error, { verbose }) {
  console.error();
  console.error(`  ${paint('red', verbose ? 'Unexpected error' : 'Error')} ${verbose ? '' : error.message}`);
  if (verbose) console.error(error);
  console.error();
}

const erase = () => tty && process.stdout.write('\r\x1b[K'); // clear the progress bar

function formatBytes(bytes) {
  const MB = 1024 * 1024;
  return bytes < MB ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / MB).toFixed(1)} MB`;
}
