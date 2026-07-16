# Asset Sync

Standalone command-line tool that keeps data and assets in sync for kiosk applications. You provide the JSON URLs and which fields hold asset URLs, and it gives you a folder of data and assets your app can read offline.

Asset sync is meant to be scheduled to run nightly by the OS, allowing kiosk app content to be kept up-to-date without relying on a constant internet connection.

The tool is built with safety in mind—it only overwrites the output folder after all assets download successfully. If anything fails, no content is overwritten and the kiosk uses the previous day's content.

## Installation

Clone the repo (pinned to a version tag) somewhere on the kiosk machine, and install its dependencies:

```bash
git clone --branch v1.0.0 https://github.com/belle-wissell/asset-sync
cd asset-sync
npm install
```

Run it once by hand to confirm it works:

```bash
node asset-sync.js
```

The first run finds no config, so it writes a starter `config.json` next to `asset-sync.js` and stops. Point that at your data sources, then run it again to sync:

```bash
node asset-sync.js
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

| Key           | Default     |                                                                                            |
|---------------|-------------|--------------------------------------------------------------------------------------------|
| `url`         | *required*  | JSON endpoint to fetch                                                                     |
| `outputDir`   | *required*  | Folder for this source. Absolute, starting with `~`, or relative to the current directory. |
| `dataFile`    | `data.json` | Name for the downloaded JSON                                                               |
| `assetFolder` | `assets`    | Name of the folder for the downloaded assets                                               |
| `assetFields` | *none*      | Fields in the JSON holding asset URLs. Omit it to download the JSON only.                  |

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
  -c, --config <file>    Config file to read       (default: config.json)
  -j, --json-only        Skip assets, JSON only
  -n, --concurrency <n>  Parallel downloads        (default: 8)
      --dry-run          Report without writing
  -h, --help             Show this message
  -v, --version          Show version
```

- `--json-only` refreshes the JSON files without touching the assets already on disk.
- `--dry-run` reports exactly what would be fetched and written, without requesting a single asset or touching your disk.
- `--config` names a file that must already exist. Only the default `config.json` is scaffolded when missing.
