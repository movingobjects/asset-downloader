# Asset Sync

Standalone command-line tool that keeps data and assets in sync for kiosk applications. You provide the JSON URLs and which fields hold asset URLs, and it gives you a folder of data and assets your app can read offline.

## Key features

- Local content is only updated after each source downloads successfully. If a file download fails, the source is skipped, leaving the existing content for the kiosk to use.
- Asset files are renamed to logically follow JSON structure, and JSON data is automatically rewritten to point to the correct asset files.
- Syncing can be scheduled to run nightly by the OS, keeping content up-to-date and allowing kiosk apps to run offline.

## Installation

Clone the repo (pinned to a version tag) somewhere on the kiosk machine, and install its dependencies:

```bash
git clone --branch v1.0.0 https://github.com/belle-wissell/asset-sync
cd asset-sync
npm install
```

## Usage

```bash
node asset-sync.js
```

If no config is found, a starter `config.json` is written next to `asset-sync.js`. Update that file to point to your data sources, then run it again to sync.

### Options

- `-c, --config <file>` — Config file to read (default: `config.json`). Must already exist; only the default `config.json` is scaffolded when missing.
- `-j, --json-only` — Skip assets, JSON only. Refreshes the JSON files without touching the assets already on disk.
- `-n, --concurrency <n>` — Parallel downloads (default: `8`)
- `--dry-run` — Report without writing. Reports exactly what would be fetched and written, without requesting a single asset or touching your disk.
- `-h, --help` — Show help message
- `-v, --version` — Show version

## Configuration

A `config.json` file next to `asset-sync.json` controls how content is downloaded.

### Config

| Key         | Default    |                                                                                                    |
|-------------|------------|----------------------------------------------------------------------------------------------------|
| `outputDir` | *required* | Shared folder for every source. Absolute, starting with `~`, or relative to the current directory. |
| `sources`   | *required* | List of sources, each a JSON endpoint to sync  (see below)                                         |

### Source (an entry in `sources`)

| Key          | Default    |                                                                               |
|--------------|------------|-------------------------------------------------------------------------------|
| `url`        | *required* | JSON endpoint to fetch                                                        |
| `outputFile` | *required* | Name for the downloaded JSON                                                  |
| `assets`     | *none*     | Enables asset downloading for this source. Omit it to download the JSON only. |

### `assets` (on a source, once present)

| Key            | Default    |                                              |
|----------------|------------|----------------------------------------------|
| `outputFolder` | *required* | Name of the folder for the downloaded assets |
| `fields`       | *none*     | Fields in the JSON holding asset URLs        |

### Example

```json
{
  "outputDir": "c:/kiosk",
  "sources": [
    {
      "url": "https://example.com/api/categories",
      "outputFile": "categories.json"
    },
    {
      "url": "https://example.com/api/stories",
      "outputFile": "stories.json",
      "assets": {
        "outputFolder": "story-assets",
        "fields": ["stories.img"]
      }
    }
  ]
}
```

The above `config.json` file will output files like this:

```text
c:/kiosk/                    ← outputDir
├─ categories.json           ← outputFile
├─ stories.json              ← outputFile
└─ story-assets/             ← assets.outputFolder
   └─ stories-1-img.jpg      ← assets.fields
   └─ stories-2-img.jpg      ← assets.fields
   └─ stories-3-img.jpg      ← assets.fields


```

## Handling assets

### Targeting URLs with `assets.fields`

Each string in `assets.fields` digs down through the JSON one field at a time, separated by `.`, until it reaches a URL. Fields along the way may be objects or arrays; the final field may be a URL string or an array of URL strings.

So this `fields` array captures every image and video URL in the JSON below:

```json
"fields": [
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

Arrays are stepped through automatically, so you never name them in a field path — you name the fields *inside* them. That holds for the whole document too: if the endpoint returns a bare array, the field path is just `"imagePath"`, with nothing in front of it:

```json
[
  { "imagePath": "http://example.com/image.jpg" },
  { "imagePath": "http://example.com/other.jpg" }
]
```

```json
"fields": ["imagePath"]
```

### Naming downloaded files

Downloaded files are named after the field path that found them, with array items numbered from 1:

```text
assets/settings-background-img.png
assets/stories-1-img.jpg
assets/stories-2-img.jpg
assets/stories-2-vid.mp4
assets/otherImgs-1.jpg
assets/otherImgs-2.jpg
assets/1-imagePath.jpg
assets/2-imagePath.jpg
```

File extensions come from the asset's final URL after redirects, falling back to its content type. Missing fields are skipped, and a URL referenced more than once is downloaded only once.

### How the JSON is rewritten

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
      "img": "story-assets/stories-1-img.jpg"
    }
  ]
}
```

That path is always **relative to the JSON file**, and since the assets are a sibling folder, it is just `assets.outputFolder` plus the file name.
