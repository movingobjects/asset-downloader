# Asset Sync

Command-line tool that creates local copies of JSON data sources and the image/video/etc. files they reference.

Asset Sync:

- Reads any number of JSON API endpoints
- Finds asset URLs inside them, based on the JSON field paths you specify
- Downloads those assets in parallel, naming each file after the field path it came from
- Rewrites the asset URLs in the JSON to point at the local copies
- Writes the JSON and assets into your project, replacing what was there before

A source is only written into your project if every one of its assets downloaded intact — see [All or nothing](#all-or-nothing-per-source).

Requires Node 22 or newer. It has no dependencies of its own.

## Adding it to a project

Install it as a dev dependency, pinned to a version tag:

```bash
npm install --save-dev github:belle-wissell/asset-sync#v1.0.0
```

Pinning to a tag matters: the version is recorded in the project's `package-lock.json`, so every machine that runs `npm ci` — every kiosk — gets the exact tool that project was tested against.

Then scaffold a config and add a script:

```bash
npx asset-sync --init
npm pkg set scripts.assets:sync=asset-sync
```

That writes `asset-sync.config.json` into the project root. Point it at your data sources (see [Configuration](#configuration)), and sync whenever you need fresh content:

```bash
npm run assets:sync
```

Paths in the config are resolved from the project directory, so `"outDir": "./public/assets"` puts the files where the app expects them.

## Options

```text
  -c, --config <file>    Config file to read       (default: asset-sync.config.json)
  -j, --json-only        Skip assets, JSON only
  -n, --concurrency <n>  Parallel downloads        (default: 8)
      --dry-run          Report without writing
      --init             Write a starter asset-sync.config.json here
  -h, --help             Show this message
  -v, --version          Show version
```

`--json-only` refreshes the JSON files without touching existing `assets` folders. `--dry-run` reports exactly what would be fetched and written, without requesting a single asset or touching your disk.

## All or nothing, per source

A source is written into the project **only if its JSON and every one of its assets arrives intact**. If anything at all fails — a dead endpoint, a 404, a connection that drops mid-file — that source is left exactly as it already was on disk, and Asset Sync moves on to the next one.

This is deliberate: for a long-running display, old data that works beats new data that doesn't.

Everything is downloaded to a temporary folder first, and only copied into the project once the whole source is accounted for, so there is no window in which a half-updated source is live. Failures are reported with the URL and the reason, and the run exits `1` if any source was skipped.

## Configuration

```json
{
  "outDir": "~/Projects/my-site/public/assets",
  "pathPrefix": "/assets",
  "sources": [
    {
      "url": "https://example.com/api/stories",
      "dir": "Stories",
      "file": "data.json",
      "assets": ["settings.background.img", "stories.img", "stories.vid", "otherImgs"]
    }
  ]
}
```

### Where things land

Asset Sync writes a file to disk, then writes a path to that file into the JSON. Those are two different paths for the same thing, and each is built from a different field:

```text
outDir      ~/Projects/my-site/public/assets  ─┐
                                               ├─ on disk:  ~/Projects/my-site/public/assets/Stories/assets/stories-1-img.jpg
dir         Stories                           ─┤
                                               ├─ in JSON:  /assets/Stories/assets/stories-1-img.jpg
pathPrefix  /assets                           ─┘
```

`outDir` never appears in the JSON, and `pathPrefix` never appears on disk. `dir` appears in both. So changing `outDir` moves the files without touching the JSON, and changing `pathPrefix` rewrites the JSON without moving a single file.

### `outDir`

Where downloaded files are written on disk. May start with `~` for your home directory.

Within it, each source gets a folder containing its JSON file and an `assets` folder.

> **Note:** a source's `assets` folder is **replaced** on every run. Anything else in `outDir` is left alone.

### `pathPrefix`

What gets put in front of the asset paths written into the JSON — that is, how your app reaches an asset at runtime, which is usually not where it sits on disk.

Whether you lead with a `/` matters and is preserved:

- `"/assets"` → `/assets/Stories/assets/stories-1-img.jpg`, resolved against the site root. Use this if your app has routes.
- `"assets"` → `assets/Stories/assets/stories-1-img.jpg`, resolved against whatever page is asking.

Leave it out to get paths relative to `outDir` itself (`Stories/assets/stories-1-img.jpg`) — the right choice when something loads the files straight off disk rather than serving them.

### `sources`

One entry per JSON endpoint.

- `url` — full URL of the JSON endpoint
- `dir` — (optional) subfolder for this source, appearing in **both** the disk path and the rewritten JSON path
- `file` — (optional) filename for the downloaded JSON (default: `data.json`)
- `assets` — (optional) field paths to the asset URLs in the JSON. If omitted, only the JSON is downloaded.

`dir` is what keeps sources from overwriting each other, so two sources that would download assets into the same folder are rejected before anything is written.

Given a source that returns `{ "stories": [{ "img": "https://cdn.example.com/x7f2.jpg" }] }` and the config above, setting `"dir": "Stories"` writes the file to `<outDir>/Stories/assets/stories-1-img.jpg` and rewrites the JSON to:

```json
{ "stories": [{ "img": "/assets/Stories/assets/stories-1-img.jpg" }] }
```

Change `dir` to `"Fall 2026"` and both move in step — the file lands in `<outDir>/Fall 2026/assets/`, and the JSON reads `/assets/Fall 2026/assets/stories-1-img.jpg`.

### `assets` field paths

Each string digs down through the JSON one field at a time, separated by `.`, until it reaches a URL. Fields along the way may be objects or arrays; the final field may be a URL string or an array of URL strings.

So this `assets` array captures every image and video URL in the JSON below:

```json
"assets": [
  "settings.background.img",
  "stories.img",
  "stories.vid",
  "otherImgs"
]
```

```json
{
  "settings": {
    "background": {
      "enabled": true,
      "img": "http://example.com/bg-image.png",
      "opacity": 0.75
    }
  },
  "stories": [
    { "title": "First story", "img": "http://example.com/image-1.jpg" },
    { "title": "Second story", "img": "http://example.com/image-2.jpg", "vid": "http://example.com/vid-2.mp4" }
  ],
  "otherImgs": ["http://example.com/other-1.jpg", "http://example.com/other-2.jpg"]
}
```

Downloaded files are named after the path that found them, with array items numbered from 1:

```text
assets/settings-background-img.png
assets/stories-1-img.jpg
assets/stories-2-img.jpg
assets/stories-2-vid.mp4
assets/otherImgs-1.jpg
assets/otherImgs-2.jpg
```

File extensions come from the asset's final URL after redirects, falling back to its content type. Missing fields are skipped, and a URL referenced more than once is downloaded only once.

## Development

```bash
git clone https://github.com/belle-wissell/asset-sync
cd asset-sync
node --test
node asset-sync.js --config asset-sync.config.example.json
```

| File | Contains |
| --- | --- |
| [`asset-sync.js`](asset-sync.js) | CLI, and the stages of syncing one source |
| [`lib/assets.js`](lib/assets.js) | Finding asset URLs in JSON, naming them, rewriting them |
| [`lib/config.js`](lib/config.js) | Reading and validating the config file |
| [`lib/net.js`](lib/net.js) | Fetching, retries, and the download pool |
| [`lib/log.js`](lib/log.js) | Everything printed to the terminal |

### Releasing

Projects install this by git tag, so a release is a tag:

```bash
npm version minor        # bumps package.json and commits a v-tag
git push --follow-tags
```

Projects pick up the new version when they choose to, by bumping the tag in their `package.json`. Nothing updates a kiosk behind your back.
