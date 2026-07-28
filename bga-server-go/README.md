# XSanity BGA Repository: Go reference server

Same protocol as the other reference servers, reimplemented in plain Go. Single binary,
no dependencies.

For the full protocol contract (request/response contract, redirect/resolver pattern,
`.nobga` packages, security recommendations) see
[`../bga-server-protocol.md`](../bga-server-protocol.md). This document only covers
running *this* Go implementation.

## Setup

```
mkdir videos            # put 1040.mpg, 1041.mp4, ... here
go run main.go          # listens on :8080, serves ./videos
go run main.go -addr :9000 -dir /path/to/videos
go run main.go -kbps 300   # throttle, useful to watch the in‑game progress bar
```

Then add `http://localhost:8080` to `Providers/bga.txt` and select a song whose BGA you
don't have locally.

## Behavior

- `GET /{filename}` serves the file from the videos directory if its extension is on
  the whitelist (`mpg mpeg mp4 avi webm mkv mov flv f4v ogv wmv nobga`), with `Range`
  support (resumable downloads, `206 Partial Content`).
- Filenames are resolved to just their base name first, so no path traversal and no
  directory parts are accepted.
- If the requested video is missing but a `{basename}.nobga` file exists next to it, the
  server issues a `302` redirect to it (see the NOBGA packages section in the protocol
  doc).
- Anything else (unknown extension, missing file, no `.nobga` fallback) is a `404`.
- No directory listing.

## Quick self‑test

```
# from bga-server-go
mkdir videos
printf 'fake' > videos/1040.mpg          # (use a real video for actual playback)
go run main.go

# in another terminal:
curl -I http://localhost:8080/1040.mpg          # 200, Accept-Ranges: bytes
curl -r 0-3 -s -D - -o /dev/null http://localhost:8080/1040.mpg | grep -i 206
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/missing.mpg   # 404 (not found)
```

If those behave as commented, the game will be able to fetch from your server.
