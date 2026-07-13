# Asset Downloader

Command-line tool that creates local copies of JSON data sources and the image/video/etc. files they reference.

The downloader:

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
npm install --save-dev github:movingobjects/asset-downloader#v1.0.0
```

Pinning to a tag matters: the version is recorded in the project's `package-lock.json`, so every machine that runs `npm ci` — every kiosk — gets the exact tool that project was tested against.

Then scaffold a config and add a script:

```bash
npx asset-sync --init
npm pkg set scripts.assets:sync=asset-sync
```

Point the config at your data sources (see [Configuration](#configuration)), and sync whenever you need fresh content:

```bash
npm run assets:sync
```

Paths in the config are resolved from the project directory, so `"outDir": "./public/assets"` puts the files where the app expects them.

## Options

```text
  -c, --config <file>    Config file to read       (default: config.json)
  -j, --json-only        Skip assets, JSON only
  -n, --concurrency <n>  Parallel downloads        (default: 8)
      --dry-run          Report without writing
      --init             Write a starter config.json here
  -h, --help             Show this message
  -v, --version          Show version
```

`--json-only` refreshes the JSON files without touching existing `assets` folders. `--dry-run` reports exactly what would be fetched and written, without requesting a single asset or touching your disk.

## All or nothing, per source

A source is written into the project **only if its JSON and every one of its assets arrives intact**. If anything at all fails — a dead endpoint, a 404, a connection that drops mid-file — that source is left exactly as it already was on disk, and the downloader moves on to the next one.

This is deliberate: for a long-running display, old data that works beats new data that doesn't.

Everything is downloaded to a temporary folder first, and only copied into the project once the whole source is accounted for, so there is no window in which a half-updated source is live. Failures are reported with the URL and the reason, and the run exits `1` if any source was skipped.

## Configuration

```json
{
  "outDir": "~/Projects/my-site/public/assets",
  "publicPath": "assets",
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

### `outDir`

Where downloaded files are written on disk. May start with `~` for your home directory.

Within it, each source gets a folder containing its JSON file and an `assets` folder.

> **Note:** a source's `assets` folder is **replaced** on every run. Anything else in `outDir` is left alone.

### `publicPath`

The prefix used when rewriting asset URLs inside the JSON — that is, how your app refers to the assets at runtime, which is usually not the same as where they sit on disk.

With the config above, an asset lands on disk at `~/Projects/my-site/public/assets/Stories/assets/stories-1-img.jpg`, and its URL in the JSON becomes `assets/Stories/assets/stories-1-img.jpg`.

Leave it out to make the rewritten paths relative to `outDir` itself.

### `sources`

One entry per JSON endpoint.

- `url` — full URL of the JSON endpoint
- `dir` — (optional) subfolder of `outDir` for this source's data and assets
- `file` — (optional) filename for the downloaded JSON (default: `data.json`)
- `assets` — (optional) field paths to the asset URLs in the JSON. If omitted, only the JSON is downloaded.

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
git clone https://github.com/movingobjects/asset-downloader
cd asset-downloader
node --test
node download.js --config config.example.json
```

| File | Contains |
| --- | --- |
| [`download.js`](download.js) | CLI, and the stages of syncing one source |
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
