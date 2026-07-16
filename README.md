# Asset Sync

Standalone command-line tool that keeps data and assets in sync for kiosk applications. You provide the JSON URLs and which fields hold asset URLs, and it gives you a folder of data and assets your app can read offline.

Local content is only updated after each source downloads successfully. If a file download fails, the source is skipped, leaving the existing content for the kiosk to use.

Syncing is meant to be scheduled to run nightly, keeping content up-to-date and allowing kiosk apps to run offline.

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

If the first run finds no config, it writes a starter `config.json` next to `asset-sync.js` and stops. Point that at your data sources, then run it again to sync:

```bash
node asset-sync.js
```

## Configuration

The config has one shared `outputDir`, plus a list of sources. One source is one JSON endpoint:

```json
{
  "outputDir": "c:/kiosk",
  "sources": [
    {
      "url": "https://example.com/api/stories",
      "dataFile": "stories.json",
      "assetsFolder": "story-assets",
      "assetFields": ["stories.img"]
    }
  ]
}
```

### Where everything lands

Each key controls one part of the path:

```text
c:/kiosk/                    ←  outputDir      shared folder for every source
├─ stories.json              ←  dataFile       the downloaded JSON
└─ story-assets/             ←  assetsFolder   folder for the downloaded assets
   └─ stories-1-img.jpg      ←  assetFields    named after the field path that found it
```

`outputDir` is the only path, and every source shares it. `dataFile` and `assetsFolder` are plain names that sit **directly inside it**, so each source needs its own to avoid colliding with the others.

| Key            | Default    |                                                                                                    |
|----------------|------------|----------------------------------------------------------------------------------------------------|
| `outputDir`    | *required* | Shared folder for every source. Absolute, starting with `~`, or relative to the current directory. |
| `url`          | *required* | JSON endpoint to fetch                                                                             |
| `dataFile`     | *required* | Name for the downloaded JSON                                                                       |
| `assetsFolder` | *required* | Name of the folder for the downloaded assets                                                       |
| `assetFields`  | *none*     | Fields in the JSON holding asset URLs. Omit it to download the JSON only.                          |

> **Note:** `dataFile` is rewritten and `assetsFolder` is **emptied and rewritten** on every successful run. Any other files within the `outputDir` are left alone.

### How JSON is rewritten

The endpoint returns a story with an asset URL on the internet:

```json
{
  "stories": [
    {
      "id": "uniqueId",
      "img": "https://cdn.example.com/x7f2.jpg"
    }
  ]
}
```

The downloaded `c:/kiosk/stories.json` points at the copy on disk instead:

```json
{
  "stories": [
    {
      "id": "uniqueId",
      "img": "stories-assets/stories-1-img.jpg"
    }
  ]
}
```

That path is always **relative to the JSON file**, and since the assets are a sibling folder, it is just `assetsFolder` plus the file name. The two can't drift apart: change `assetsFolder` to `"images"` and the folder on disk and the path in the JSON both become `images`.

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
