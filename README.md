# Asset Sync

Keeps a folder of content up to date on a machine you can't easily get to. Point it at your JSON endpoints, tell it which fields hold asset URLs, and it gives you a folder your app can read offline — refreshed every night, on its own.

It is built for kiosks running a distributed app. Asset Sync installs alongside the app, wakes up in the middle of the night, rebuilds the content folder, and goes back to sleep. The app opens hours later and finds fresh content sitting where it always was.

- **The folder is never half updated.** It is rebuilt in a temp folder and swapped into place all at once, only when every source has arrived intact. A run that fails — or a machine that loses power — leaves last night's content exactly as it was.
- **It doesn't re-download what hasn't changed.** Assets the server says are unchanged are copied across from the folder you already have, so a quiet night costs almost nothing. See [Not downloading things twice](#not-downloading-things-twice).
- **Real files, all the way down.** No symlinks, no aliases, no content-addressed store. Your app reads a plain folder.

## Getting it onto a kiosk

Grab the binary for the platform from [Releases](https://github.com/belle-wissell/asset-sync/releases), or build them yourself with `npm run build`. It has no dependencies — no Node, no npm, no project.

Put it somewhere sensible on the kiosk, then run it once to get a config:

```bash
asset-sync
```

The first run finds no config, writes a starter `asset-sync.config.json` beside itself, and stops. Point that at your data sources, then sync:

```bash
asset-sync
```

Once it does what you want, have it do that every night:

```bash
asset-sync install --at 03:00
```

That registers a daily job — a launch agent on macOS, a scheduled task on Windows — and nothing more is needed. `asset-sync uninstall` takes it back off.

## Configuration

One `baseOutputDir` for the whole run, and a list of sources. One source is one JSON endpoint, and it gets a folder of its own inside `baseOutputDir`.

```json
{
  "baseOutputDir": "C:/kiosk/content",
  "sources": [
    {
      "url": "https://example.com/api/stories",
      "outputFolder": "stories",
      "dataFile": "data.json",
      "assetFolder": "assets",
      "assetFields": ["stories.img"]
    }
  ]
}
```

| Key             | Default     |                                                                           |
|-----------------|-------------|---------------------------------------------------------------------------|
| `baseOutputDir` | *required*  | The folder your app reads. Absolute, starting with `~`, or relative.      |
| `url`           | *required*  | JSON endpoint to fetch                                                    |
| `outputFolder`  | *required*  | This source's folder inside `baseOutputDir`                               |
| `dataFile`      | `data.json` | Name for the downloaded JSON                                              |
| `assetFolder`   | `assets`    | Name of the folder for the downloaded assets                              |
| `assetFields`   | *none*      | Fields in the JSON holding asset URLs. Omit it to download the JSON only. |

Since only `url` and `outputFolder` are required, that source is more usually written:

```json
{ "url": "https://example.com/api/stories", "outputFolder": "stories", "assetFields": ["stories.img"] }
```

> **A relative `baseOutputDir` is measured from the config file**, not from wherever the command happened to be run. `"./content"` in a config sitting beside the binary always means the folder beside the binary — including at 3am, when the scheduler starts the job in a directory of its own choosing. (launchd uses `/`.)

### Where everything lands

```text
C:/kiosk/content/          ←  baseOutputDir  the folder your app reads
├─ asset-sync/             ←                 ours: what was downloaded, and from where
│  └─ manifest.json
└─ stories/                ←  outputFolder   folder for this source
   ├─ data.json            ←  dataFile       the downloaded JSON
   └─ assets/              ←  assetFolder    folder for the downloaded assets
      └─ stories-1-img.jpg ←  assetFields    named after the field path that found it
```

Every source gets its own `outputFolder`, and `asset-sync` is reserved. `dataFile` and `assetFolder` are plain names sitting **directly inside** the source's folder.

> **Note:** `baseOutputDir` is **replaced in full** on every successful run. Do not keep anything in there you would miss.

### How JSON is rewritten

The endpoint returns a story with an asset URL on the internet:

```json
{ "stories": [{ "img": "https://cdn.example.com/x7f2.jpg" }] }
```

The downloaded `stories/data.json` points at the copy on disk instead:

```json
{ "stories": [{ "img": "assets/stories-1-img.jpg" }] }
```

That path is always **relative to the JSON file**, and since the assets are a sibling folder, it is just `assetFolder` plus the file name. The two can't drift apart: change `assetFolder` to `"images"` and the folder on disk and the path in the JSON both become `images`.

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

## Not downloading things twice

Every asset that lands is recorded in `asset-sync/manifest.json`: the URL it came from, the file it became, and whatever the server said about its version — an `ETag`, a `Last-Modified`, or both.

The next night, for each asset:

- **Never seen before** — download it.
- **Seen, and the server gave us a version to quote back** — ask whether it has changed. If it says no, the file is copied across from the folder we already have. Nothing crosses the network.
- **Seen, but the server never gave us a version** — download it again. There is no way to ask, so the only safe answer is to fetch.

That last case is worth watching. A server that sends neither an `ETag` nor a `Last-Modified` can never be asked whether a file changed, so every one of its assets comes down again every night — the sync still works, it just never gets any cheaper. Each run reports how many assets it **reused** versus **downloaded**, and says so out loud when nothing at all was reused. If you see that on a night when nothing changed, the server is the reason.

## All or nothing

The output folder is rebuilt from scratch in a temp folder next door, and only swapped into place once **every source's JSON and every one of its assets has arrived intact**. If anything fails — a dead endpoint, a 404, a connection that drops mid-file — the temp folder is thrown away, the output folder is not touched at all, and the run exits `1`.

That means a bad night leaves you with last night's content, whole and self-consistent. It never leaves you with half of tonight's.

The swap itself is two renames, so the moment where the folder is not there is measured in microseconds. If the power dies inside even that, the next run notices and puts it back.

## Reading the folder from an Electron app

The content lives outside your app bundle, so the renderer can't load it over `file://`. Serve it from the main process on a scheme of your own:

```js
protocol.handle('content', (request) => {
  const file = request.url.slice('content://'.length);
  return net.fetch(pathToFileURL(path.join(CONTENT_DIR, file)).toString());
});
```

Then read `stories/data.json` and resolve its asset paths against it, exactly as they were written.

## Options

```text
  Commands:
    sync                   Download and publish (default)
    install                Run a sync every day, unattended
    uninstall              Stop running the daily sync

  Options:
    -c, --config <file>    Config file to read        (default: asset-sync.config.json)
    -r, --reuse-assets     Refresh the JSON only, keeping the assets already on disk
    -n, --concurrency <n>  Parallel downloads         (default: 8)
        --at <HH:MM>       Time of the daily sync     (default: 03:00, install only)
        --dry-run          Report without writing
    -h, --help             Show this message
    -v, --version          Show version
```

- `--reuse-assets` refreshes the JSON without asking the server about a single asset. Every asset must already be on disk, or the run fails.
- `--dry-run` reports exactly what would be fetched and written, without requesting a single asset or touching your disk.
- `--config` names a file that must already exist. Only the default `asset-sync.config.json` is scaffolded when missing.

Exit codes: `0` all good, `1` a source failed and nothing was written, `2` the config or the command line was wrong.

### What it leaves beside the config

A sync started by a scheduler at 3am has nobody watching it, so everything it prints is also written to a log file — named after the config, next to it, capped at 5 MB with one rollover. A lock file sits there too, so two syncs can't run at once.

Those live beside the config rather than in the output folder, because the output folder is thrown away and rebuilt every run, and the run you most want a log of is the one that failed.

## Development

```bash
git clone https://github.com/belle-wissell/asset-sync
cd asset-sync
node --test
node asset-sync.js --config asset-sync.config.example.json
```

| File                                 | Contains                                                     |
|--------------------------------------|--------------------------------------------------------------|
| [`asset-sync.js`](asset-sync.js)     | CLI, and the stages of one sync                              |
| [`lib/assets.js`](lib/assets.js)     | Finding asset URLs in JSON, naming them, rewriting them      |
| [`lib/config.js`](lib/config.js)     | Reading and validating the config file                       |
| [`lib/manifest.js`](lib/manifest.js) | What was downloaded, and whether it can be reused            |
| [`lib/net.js`](lib/net.js)           | Fetching, revalidating, retries, and the download pool       |
| [`lib/publish.js`](lib/publish.js)   | The temp folder, the swap, and recovering an interrupted one |
| [`lib/lock.js`](lib/lock.js)         | Keeping two syncs from running at once                       |
| [`lib/schedule.js`](lib/schedule.js) | Installing the daily job with launchd or Task Scheduler      |
| [`lib/log.js`](lib/log.js)           | Everything printed to the terminal, and to the log file      |

### Releasing

Binaries are built with [bun](https://bun.sh), which cross-compiles — every platform's binary is built from whichever machine you happen to be on. Bun is only needed here, at build time; the binaries it produces depend on nothing.

```bash
npm version minor        # bumps package.json and commits a v-tag
npm run build            # bakes the version into lib/version.js, writes dist/
git push --follow-tags
```

Then attach `dist/` to the GitHub release. Nothing updates a kiosk behind your back: you put the new binary on the machine when you choose to.
