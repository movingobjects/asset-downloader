# Asset Sync

Command-line tool that downloads data and asset updates for kiosk applications. Tell it a URL and which JSON fields hold asset URLs, and it gives you a folder your app can read offline.

A source is only written into your project if every one of its assets downloaded intact — see [All or nothing](#all-or-nothing-per-source).

## Adding it to a project

Install it as a dev dependency, pinned to a version tag:

```bash
npm install --save-dev github:belle-wissell/asset-sync#v1.0.0
```

Then add a script and run it:

```bash
npm pkg set scripts.assets:sync=asset-sync
npm run assets:sync
```

The first run finds no config, so it writes a starter `asset-sync.config.json` into the project root and stops. Point that at your data sources, then run it again to sync — and again whenever you need fresh content:

```bash
npm run assets:sync
```

## Configuration

The config is a list of sources. One source is one JSON endpoint. Here is a source using every option:

```json
{
  "sources": [
    {
      "url": "https://example.com/api/stories",
      "outputDir": "c:/kiosk/stories",
      "dataFile": "data.json",
      "assetFolder": "assets",
      "assetFields": ["stories.img"]
    }
  ]
}
```

### Where everything lands

Each key controls one part of the path:

```text
c:/kiosk/stories/           ←  outputDir     folder for this source
├─ data.json                ←  dataFile      the downloaded JSON
└─ assets/                  ←  assetFolder   folder for the downloaded assets
   └─ stories-1-img.jpg     ←  assetFields   named after the field path that found it
```

`outputDir` is the only path. `dataFile` and `assetFolder` are plain names that sit **directly inside it**, so `outputDir` is the one knob that moves the whole source at once.

| Key           | Default     |                                                                                   |
|---------------|-------------|-----------------------------------------------------------------------------------|
| `url`         | *required*  | JSON endpoint to fetch                                                            |
| `outputDir`   | *required*  | Folder for this source. Absolute, starting with `~`, or relative to your project. |
| `dataFile`    | `data.json` | Name for the downloaded JSON                                                      |
| `assetFolder` | `assets`    | Name of the folder for the downloaded assets                                      |
| `assetFields` | *none*      | Fields in the JSON holding asset URLs. Omit it to download the JSON only.         |

Since only `url` and `outputDir` are required, the source above is more usually written:

```json
{
  "url": "https://example.com/api/stories",
  "outputDir": "c:/kiosk/stories",
  "assetFields": ["stories.img"]
}
```

> **Note:** `assetFolder` is **emptied and rewritten** on every successful run. Everything around it is left alone.

### How JSON is rewritten

The endpoint returns a story with an asset URL on the internet:

```json
{ "stories": [{ "img": "https://cdn.example.com/x7f2.jpg" }] }
```

The downloaded `c:/kiosk/stories/data.json` points at the copy on disk instead:

```json
{ "stories": [{ "img": "assets/stories-1-img.jpg" }] }
```

That path is always **relative to the JSON file**, and since the assets are a sibling folder, it is just `assetFolder` plus the file name. The two can't drift apart: change `assetFolder` to `"images"` and the folder on disk and the path in the JSON both become `images`.

If your app reads the JSON off disk, the path works as-is. If it fetches the JSON over HTTP, resolve asset paths against the JSON's own URL — a browser would otherwise resolve them against the current page:

```js
const data = await (await fetch(dataUrl)).json();
const img = new URL(data.stories[0].img, dataUrl);
```

## Choosing the assets: `assetFields`

Each string digs down through the JSON one field at a time, separated by `.`, until it reaches a URL. Fields along the way may be objects or arrays; the final field may be a URL string or an array of URL strings.

So this `assetFields` array captures every image and video URL in the JSON below:

```json
"assetFields": [
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
    {
      "title": "First story",
      "img": "http://example.com/some-image.jpg"
    },
    {
      "title": "Second story",
      "img": "http://example.com/example.jpg",
      "vid": "http://example.com/sample-vid-asdf.mp4"
    }
  ],
  "otherImgs": [
    "http://example.com/filename_a.jpg",
    "http://example.com/filename_b.jpg"
  ]
}
```

Downloaded files are named after the field path that found them, with array items numbered from 1:

```text
assets/settings-background-img.png
assets/stories-1-img.jpg
assets/stories-2-img.jpg
assets/stories-2-vid.mp4
assets/otherImgs-1.jpg
assets/otherImgs-2.jpg
```

File extensions come from the asset's final URL after redirects, falling back to its content type. Missing fields are skipped, and a URL referenced more than once is downloaded only once.

### When the endpoint returns an array

Arrays are stepped through automatically, so you never name them in a field path — you name the fields *inside* them. That holds for the whole document too. If the endpoint returns a bare array:

```json
[
  { "imagePath": "http://example.com/image.jpg" },
  { "imagePath": "http://example.com/other.jpg" }
]
```

the field path is just `"imagePath"`, with nothing in front of it:

```json
"assetFields": ["imagePath"]
```

Items are numbered from 1, exactly as they are anywhere else:

```text
assets/1-imagePath.jpg
assets/2-imagePath.jpg
```

## Options

```text
  -c, --config <file>    Config file to read       (default: asset-sync.config.json)
  -j, --json-only        Skip assets, JSON only
  -n, --concurrency <n>  Parallel downloads        (default: 8)
      --dry-run          Report without writing
  -h, --help             Show this message
  -v, --version          Show version
```

- `--json-only` refreshes the JSON files without touching the assets already on disk.
- `--dry-run` reports exactly what would be fetched and written, without requesting a single asset or touching your disk.
- `--config` names a file that must already exist. Only the default `asset-sync.config.json` is scaffolded when missing.

## All or nothing, per source

A source and its assets are written into the project **only if its JSON and every one of its assets arrives intact**. If anything fails — a dead endpoint, a 404, a connection that drops mid-file — we skip that source and move on to the next one. This is deliberate: old data that works beats new data that doesn't.

Everything is downloaded to a temporary folder first and only copied into the project once the whole source is accounted for, so there is no moment when a half-updated source is live. Failures are reported with the URL and the reason, and the run exits `1` if any source was skipped.

## Development

```bash
git clone https://github.com/belle-wissell/asset-sync
cd asset-sync
node --test
node asset-sync.js --config asset-sync.config.example.json
```

| File                             | Contains                                                |
|----------------------------------|---------------------------------------------------------|
| [`asset-sync.js`](asset-sync.js) | CLI, and the stages of syncing one source               |
| [`lib/assets.js`](lib/assets.js) | Finding asset URLs in JSON, naming them, rewriting them |
| [`lib/config.js`](lib/config.js) | Reading and validating the config file                  |
| [`lib/net.js`](lib/net.js)       | Fetching, retries, and the download pool                |
| [`lib/log.js`](lib/log.js)       | Everything printed to the terminal                      |

### Releasing

Projects install this by git tag, so a release is a tag:

```bash
npm version minor        # bumps package.json and commits a v-tag
git push --follow-tags
```

Projects pick up the new version when they choose to, by bumping the tag in their `package.json`. Nothing updates a kiosk behind your back.
