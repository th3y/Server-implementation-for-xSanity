# XSanity BGA Repository: Node.js reference server

Same protocol as the Go reference server, reimplemented in plain Node.js. Single file,
**zero npm dependencies** (only Node's built-in `http`, `fs`, `path`, `url` modules).

For the full protocol contract (request/response contract, redirect/resolver pattern,
`.nobga` packages, security recommendations) see
[`../bga-server-protocol.md`](../bga-server-protocol.md). This document only covers
running *this* Node.js implementation.

## Setup

```
cd bga-server-node
mkdir -p videos
# copy your video files into videos/ (e.g. 1040.mpg)
node server.js                          # listens on :8080, serves ./videos
node server.js --addr 9000 --dir /path/to/videos
node server.js --kbps 300               # throttle, useful to watch the in-game progress bar
```

Then add `http://localhost:8080` to `Providers/bgas.txt` and select a song whose BGA you
don't have locally.

Requires Node.js 14+.

## Behavior

- `GET /{filename}` serves the file from `videos/` if its extension is on the
  whitelist (`mpg mpeg mp4 avi webm mkv mov flv f4v ogv wmv nobga`), with `Range`
  support (resumable downloads, `206 Partial Content`).
- Filenames are resolved through `path.basename()` first, so no path traversal and no
  directory parts are accepted.
- If the requested video is missing but a `{basename}.nobga` file exists next to it, the
  server issues a `302` redirect to it (see the NOBGA packages section in the main
  protocol doc).
- Anything else (unknown extension, missing file, no `.nobga` fallback) is a `404`.
- No directory listing.

## Large videos (50–200 MB+)

Files are streamed via `fs.createReadStream` in chunks (never buffered fully in memory),
and Node has no built-in request timeout for this kind of long-lived response, so large
BGA files are fine as-is. Still worth checking:

- If you put nginx/Caddy in front for TLS, check `client_max_body_size` (nginx) and
  proxy buffering/timeout settings so large responses aren't truncated or buffered to
  disk unnecessarily.
- For heavy concurrent traffic, prefer the redirect/resolver pattern from the main
  protocol doc (§6): point this server at small/rare files and let a CDN or object
  storage (S3/R2/B2) serve the bulk of the bandwidth.
- Run it behind a real reverse proxy (nginx/Caddy) for TLS termination and process
  supervision (`pm2`, `systemd`, a Docker restart policy, etc.). This script itself has
  no daemonization or auto-restart.
