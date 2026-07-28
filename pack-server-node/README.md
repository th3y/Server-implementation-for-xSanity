# XSanity Pack Repository: Node.js reference server

Same protocol as the other reference servers, reimplemented in plain Node.js. Single file,
**zero npm dependencies** (only Node's built-in `http`, `fs`, `path`, `url` modules).

For the full protocol contract (catalog JSON shape, `type`/`version`/`crc32` fields, zip
layout, security recommendations) see
[`../pack-server-protocol.md`](../pack-server-protocol.md). This document only covers
running *this* Node.js implementation.

## Setup

```
cd pack-server-node
mkdir -p packs thumbs
# copy your .zip packs into packs/
node server.js                              # listens on :8090
node server.js --name "My Repo" --dir /path
node server.js --port 8091
node server.js --kbps 300                   # throttle, useful to watch the in-game progress bar
```

Then add `http://localhost:8090/catalog.json` to `Providers/packs.txt`.

Requires Node.js 14+.

## Endpoints

- `GET /catalog.json`: auto-generated from `packs/*.zip` (+ optional `packs/{id}.json`
  metadata, + `thumbs/{id}.ext`), or served as-is if a static `catalog.json` file exists at
  the server root (manual mode).
- `GET /packs/{id}.zip`: the pack download, with `Range` support (resumable downloads).
- `GET /thumbs/{id}.png|jpg|jpeg|gif|bmp`: thumbnail.

## Optional per-pack metadata

`packs/{id}.json`:

```json
{ "name": "K-Pop Vol 1", "author": "DJ Foo", "songs": 42, "type": "songpackage", "version": "1.2.0" }
```

For noteskin/theme packs use `"type": "userpackage"`. See `pack-server-protocol.md`
§3/§6a for the full field reference (`id`, `url`, `name`, `author`, `size`, `songs`, `image`,
`type`, `version`, `crc32`). The JSON shape is identical, only the server implementation
differs.

`crc32` is computed automatically (same CRC-32 IEEE algorithm as the Go and PHP servers) and
cached in a `packs/{id}.zip.crc` sidecar (keyed by mtime+size) so multi-GB packs aren't
rehashed on every request.

## Notes

- Path traversal and extension whitelisting are enforced in `handlePacks`/`handleThumbs`:
  only `*.zip` under `packs/` and image extensions under `thumbs/` are ever served, and
  filenames are resolved through `path.basename()` first.
- For HTTPS behind a reverse proxy, set `X-Forwarded-Proto` so the catalog's generated URLs
  use the right scheme.
- Run it behind a real reverse proxy (nginx/Caddy) for TLS termination and process
  supervision (`pm2`, `systemd`, a Docker restart policy, etc.). This script itself has no
  daemonization or auto-restart.

## Large packs (50–200 MB+)

Downloads are streamed via `fs.createReadStream` in chunks (never buffered fully in
memory), and Node has no built-in request timeout for this kind of long-lived response,
so multi-hundred-MB packs are fine as-is. Still worth checking:

- If you put nginx/Caddy in front for TLS, check `client_max_body_size` (nginx) and
  proxy buffering/timeout settings so large responses aren't truncated or buffered to
  disk unnecessarily.
- For heavy concurrent traffic, serving multi-hundred-MB files through this script is
  less efficient than a CDN or static file host. That is fine for a small/personal repo,
  but worth changing at scale.
