import path from 'node:path';

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/json': 'json'
};

/**
 * Walks a source's field paths (e.g. "stories.img") and returns a reference to every
 * asset URL found, named after the path that found it. Each ref keeps the container and
 * key it came from, so the URL can later be rewritten in place — see `localizeRefs`.
 */
export function collectAssetRefs(data, fieldPaths) {
  const refs = [];

  const walk = (node, fields, prefix) => {
    if (node === null || typeof node !== 'object') return;

    const [field, ...rest] = fields;
    const value = node[field];
    const name = prefix ? `${prefix}-${field}` : field;

    if (value === null || value === undefined) return;

    // Still digging: step through the object, or through every item of the array
    if (rest.length > 0) {
      if (Array.isArray(value)) {
        value.forEach((item, i) => walk(item, rest, `${name}-${i + 1}`));
      } else {
        walk(value, rest, name);
      }
      return;
    }

    // Arrived: the field holds a URL, or an array of URLs
    if (Array.isArray(value)) {
      value.forEach((url, i) => {
        if (isUrl(url)) refs.push({ container: value, key: i, url, name: `${name}-${i + 1}` });
      });
    } else if (isUrl(value)) {
      refs.push({ container: node, key: field, url: value, name });
    }
  };

  for (const fieldPath of fieldPaths) {
    walk(data, fieldPath.split('.'), '');
  }

  return refs;
}

/** Groups refs into one job per URL, so an asset used in several places is fetched once. */
export function groupByUrl(refs) {
  const jobs = new Map();

  for (const ref of refs) {
    const job = jobs.get(ref.url);
    if (job) {
      job.refs.push(ref);
    } else {
      jobs.set(ref.url, { url: ref.url, refs: [ref] });
    }
  }

  return [...jobs.values()];
}

/** Names the file each of a job's refs wants, so the caller knows where to put the bytes. */
export function targetsFor(job, ext) {
  return job.refs.map((ref) => ({ ref, file: `${sanitize(ref.name)}.${ext}` }));
}

/**
 * Points the JSON at the local copies of an asset, in place of its remote URL.
 * Only call this once the bytes are safely on disk: a JSON entry pointing at a file
 * that is missing or half-written is worse than one still pointing at the network.
 */
export function localize(targets) {
  for (const { ref, file } of targets) {
    ref.container[ref.key] = joinPath(ref.pathDir, file);
  }
}

/**
 * Joins the segments of a path destined for the JSON — not a disk path, so always `/`, whatever
 * the platform. The result is relative to the JSON file, which sits beside its asset folder.
 */
export function joinPath(...segments) {
  return segments
    .flatMap((segment) => (segment ?? '').split('/'))
    .filter(Boolean)
    .join('/');
}

/** Prefers the extension on the URL, falling back to the content type, then `.bin`. */
export function extensionFor(url, contentType) {
  const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;

  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return MIME_EXTENSIONS[mime] ?? 'bin';
}

const isUrl = (value) => typeof value === 'string' && URL.canParse(value);
const sanitize = (name) => name.replace(/[^\w.\- ]+/g, '_');
