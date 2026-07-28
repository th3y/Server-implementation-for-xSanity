# XSanity Pack Repository: Go reference server

Single binary, no dependencies. It **auto‑generates** `/catalog.json` from the zips you
drop in, serves the files with Range support, whitelists extensions, blocks path traversal
and has no directory listing.

For the full protocol contract (catalog JSON shape, `type`/`version`/`crc32` fields, zip
layout for `songpackage`/`userpackage`, security recommendations) see
[`../pack-server-protocol.md`](../pack-server-protocol.md). This document only covers
running *this* Go implementation.

## Layout

```
pack-server-go/
  main.go
  packs/                  <- drop your zips here
    kpop-vol1.zip
    kpop-vol1.json        <- (optional) metadata for that pack
  thumbs/                 <- (optional) images
    kpop-vol1.png
  catalog.json            <- (optional) if present, served as-is (manual mode)
```

## Running it

```
cd pack-server-go
mkdir packs thumbs
# copy your packs into packs/
go run main.go                 # listens on :8090, serves /catalog.json, /packs, /thumbs
go run main.go -name "My Repo" -dir /path
go run main.go -kbps 300       # throttle, useful to watch the in-game progress bar
```

Then add `http://localhost:8090/catalog.json` to `Providers/packs.txt`.

## Endpoints

- `GET /catalog.json`: the catalog (auto‑generated, or your static file if present).
- `GET /packs/{id}.zip`: the pack download (with Range/resume).
- `GET /thumbs/{id}.png`: the thumbnail.

## Optional per‑pack metadata

Without it, a pack uses its filename as `id`/`name`, the real file `size`,
`type: "songpackage"` and `version: "1.0.0"`. For nicer data, add `packs/{id}.json`:

```json
{ "name": "K-Pop Vol 1", "author": "DJ Foo", "songs": 42, "type": "songpackage", "version": "1.2.0" }
```

For a noteskin/theme pack:

```json
{ "name": "My Noteskin", "author": "Jane", "type": "userpackage", "version": "1.0.0" }
```

If `thumbs/{id}.png` exists, its URL is added as `image` automatically. The generated `url`
and `size` always match the real file. `crc32` is computed automatically from the zip and
cached in a `packs/{id}.zip.crc` sidecar (keyed by mtime+size) so multi‑GB packs aren't
rehashed on every request.

## Quick self‑test

```
# from pack-server-go
mkdir packs
printf 'PK\x03\x04...' > packs/kpop-vol1.zip     # use a real pack zip for actual install
go run main.go

# in another terminal:
curl -s http://localhost:8090/catalog.json                       # your generated catalog
curl -I http://localhost:8090/packs/kpop-vol1.zip                # 200, Accept-Ranges: bytes
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8090/packs/missing.zip   # 404
```

If the catalog lists your pack and the zip downloads, the game will be able to install from
your server.
