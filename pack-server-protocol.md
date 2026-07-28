# XSanity Pack Repository: Protocol & Guide

This document explains how to host your own **third‑party pack repository** for
XSanity. It describes the exact contract the game uses so you can build a server with
**any technology** and **your own security measures**.

> TL;DR: your server publishes a small **JSON catalog** listing packs, and each pack points
> to a `.zip` download URL. Any plain static file host can do this.

Three ready-to-run reference servers implementing this protocol are included:

| Folder                       | Stack       | Notes                                   |
|-------------------------------|-------------|------------------------------------------|
| `pack-server-go/`             | Go          | Single binary, no dependencies.          |
| `pack-server-php/`            | PHP         | For shared hosting (Apache + mod_rewrite). |
| `pack-server-node/`           | Node.js     | Single file, zero npm dependencies.      |

Each folder has its own README with setup/run instructions for that stack. This document
covers the protocol itself. Read it first: it applies to all three, and to any custom
server you build.

---

## 1. What a Pack repository is

A repository lets players browse and download **song packs** (a `.zip` containing one or
more song folders), or **user packages** (noteskins, themes, etc.), from inside the game.
Two things are served over HTTP(S):

1. A **catalog** (JSON) describing the packs you offer.
2. The **`.zip` files** themselves (or redirects to them).

You are free to serve real files, redirect to a CDN/mirror, add authentication, rate
limiting, etc. The game only cares about the request/response contract below.

---

## 2. Client configuration (for reference)

Players enable repositories by creating a text file in the game root:

```
Providers/packs.txt
```

One **catalog URL per line**:

```
https://packs.example.com/catalog.json
https://mirror.another.net/catalog.json
http://localhost:8090/catalog.json
```

- This file is the **only** source of providers (it is *dominant*): if it is missing or
  empty, the Pack screen is disabled. Nothing is persisted elsewhere.
- Duplicate lines are ignored.
- A trailing `/` on a URL is stripped automatically.

Each line must point at your **catalog endpoint** (see §3), not at a zip.

---

## 3. The catalog contract

When the screen opens, the game does one request per provider line:

```
GET {catalog-url}
```

Request details your server will see:

| Property        | Value                                    |
|-----------------|------------------------------------------|
| Method          | `GET`                                    |
| `User-Agent`    | `XSANITY`                                |
| Protocols       | `http` and `https` only (redirects too)  |
| Redirects       | Followed automatically, up to **5**      |
| Connect timeout | 10 s                                     |

The response body must be **JSON** with this shape:

```json
{
  "name": "My Pack Repo",
  "packs": [
    {
      "id": "kpop-vol1",
      "name": "K-Pop Vol 1",
      "author": "DJ Foo",
      "size": 154857600,
      "songs": 42,
      "image": "https://cdn.example.com/thumbs/kpop-vol1.png",
      "url": "https://cdn.example.com/packs/kpop-vol1.zip",
      "type": "songpackage",
      "version": "1.2.0"
    },
    {
      "id": "my-noteskin",
      "name": "My Noteskin",
      "author": "Jane",
      "url": "https://cdn.example.com/packs/my-noteskin.zip",
      "type": "userpackage",
      "version": "1.0.0",
      "crc32": "a1b2c3d4"
    },
    {
      "id": "boss-challenge",
      "url": "https://cdn.example.com/packs/boss-challenge.zip"
    }
  ]
}
```

### Pack fields

| Field    | Type    | Required | Meaning                                                        |
|----------|---------|----------|------------------------------------------------------------------|
| `id`     | string  | **yes**  | Unique identifier. Used for dedup and as the local file name.  |
| `url`    | string  | **yes**  | Direct link to the `.zip`, or a resolver that redirects to it. |
| `name`   | string  | no       | Display name (falls back to `id`).                             |
| `author` | string  | no       | Shown on the card.                                             |
| `size`   | number  | no       | Size in **bytes**. Shown on the card and used for sorting.     |
| `songs`  | number  | no       | Song count. Shown on the card.                                 |
| `image`  | string  | no       | URL to a banner/thumbnail (`png/jpg/jpeg/gif/bmp`).            |
| `type`   | string  | no       | `"songpackage"` (default) or `"userpackage"`. See §6a.         |
| `version`| string  | no       | Semver (`"1.2.0"`, default `"1.0.0"`). **Dominant** field for update detection. |
| `crc32`  | string  | no       | Optional, best-effort hash for the zip. Never gates install/update, informational only. |

A pack with no `id` or no `url` is skipped. The top‑level `name` is optional.

---

## 4. Multiple providers & merging

If the player configures several catalogs, the game fetches **all** of them and merges the
results into one list. Deduplication is by **`id`** (case‑insensitive): if two catalogs
publish a pack with the same `id`, the first one wins. Packs with different ids all show up
together, so partial/specialized repositories combine cleanly.

If a provider fails or returns invalid JSON, it is skipped and the others still load.

---

## 5. Downloading a pack

When the player confirms a pack, the game does:

```
GET {pack.url}
```

- Redirects are followed (up to 5, `http`/`https` only), so `url` can be a **resolver**
  that `302`‑redirects to your real storage/CDN. The resolver then spends no bandwidth on the
  payload (same pattern as the BGA server; great for cheap hosting + S3/R2/B2 mirrors).
- The download is streamed to a temporary `*.part` file and only committed once complete,
  so an interrupted download never leaves a broken file.
- Progress and an estimated time are shown in‑game; the player can cancel with Escape.

### What the client accepts

The downloaded file must be a **real `.zip` archive** (it is checked to begin with the
standard zip signature). If it isn't, the download is discarded. Sending
`Content-Type: application/zip` is recommended. `Accept-Ranges: bytes` lets interrupted
downloads resume.

---

## 6. Zip layout: `songpackage` (default)

The pack `.zip` is installed by **mounting it into the game's `Songs/` folder**, so its
**internal structure must start with the song group at the root of the archive**:

```
kpop-vol1.zip
└── K-Pop Vol 1/            <- group folder (becomes Songs/K-Pop Vol 1/)
    ├── Song A/
    │   ├── song.ssc
    │   ├── song.ogg
    │   └── banner.png
    └── Song B/
        └── ...
```

After a successful download the game saves the zip to `SongPackages/{id}.zip`, mounts it
live, and reloads the song list, so the new songs appear without restarting. On the next
launch the game auto‑mounts every `SongPackages/*.zip`, so the pack persists.

> Do **not** wrap the songs in an extra top‑level folder (e.g. `kpop-vol1/K-Pop Vol 1/…`),
> or the group will end up nested incorrectly.

---

## 6a. Zip layout: `userpackage` (noteskins, themes, etc.)

Packs with `"type": "userpackage"` are mounted at the **game root** (`/`) instead of
`Songs/`, so the zip's internal structure must mirror the game's own folder layout:

```
my-noteskin.zip
└── NoteSkins/
    └── dance/
        └── MyNoteSkin/
            ├── ...

my-theme.zip
└── Themes/
    └── MyTheme/
        ├── ...
```

A single `userpackage` zip may contain multiple top‑level folders (`Themes/`, `NoteSkins/`,
`Announcers/`, …) if you want to bundle several kinds of content together.

After install, the zip is saved to `UserPackages/{id}.zip` (instead of `SongPackages/`) and
noteskin data is refreshed live so new noteskins appear without restarting. Themes are
picked up automatically the next time the theme list is opened (no restart needed either),
but a theme **currently in use** won't hot‑swap: only a fresh selection or restart picks up
changes to it.

### Versioning

The `version` field (semver) is the field the game uses to decide whether a re‑download is
an update: if the catalog's `version` is greater than what's currently installed, the pack
shows an "update available" badge and can be reinstalled, which replaces the zip in place.
`crc32` is optional and purely informational. Bump `version` when you change a pack, don't
rely on the hash to signal a change.

---

## 7. Thumbnails

If a pack has an `image` URL, the game downloads it in the background and caches it under
`Cache/PackThumbs/`, showing it as the card's background. Supported formats: `png`, `jpg`,
`jpeg`, `gif`, `bmp`. Keep them reasonably small (banners, not full‑res art). Packs without
an `image` simply show a placeholder.

---

## 8. Building your own server

**Any static file host works.** Serve a `catalog.json` plus the `.zip` files (and optional
thumbnails) over HTTP:

- nginx / Apache / Caddy serving a directory (disable autoindex).
- Object storage with public read: S3, Cloudflare R2, Backblaze B2, GitHub Pages, Netlify.
- One of the included reference servers, see the table at the top of this document.

### Fully static (no server code)

Write `catalog.json` by hand (see the format in §3 or `catalog.example.json`) and serve the
folder with anything, e.g.:

```
python -m http.server 8090
```

Make sure the `url`/`image` fields point at reachable absolute URLs.

---

## 9. Recommended security (you implement it)

The game only requires a valid zip and the JSON shape above. Everything else is up to you:

- **Put Cloudflare (free tier) in front.** Absorbs DDoS, caches the catalog and files at the
  edge, and offers one‑click rate limiting. Ideal for a home server.
- **Rate limit per IP** and answer `429` + `Retry-After` when exceeded.
- **No directory listing.** Don't expose an index of your storage.
- **Whitelist extensions** you serve (`.zip`, plus image types for thumbs) and block path
  traversal (`..`, `/`, `\`) in requested names. All three reference servers do this.
- **Aggressive cache headers** for the zips (`Cache-Control: public, max-age=...`): packs
  are immutable once published. Keep the catalog on a short cache so updates show up.
- **HTTPS** with a valid certificate (the client uses the OS trust store).
- Optional light hotlink filter: check `User-Agent: XSANITY` (not real security, but filters
  generic bots).
