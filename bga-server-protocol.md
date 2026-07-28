# XSanity BGA Repository: Protocol & Guide

This document explains how to host your own **third‑party BGA (background video)
repository** for the XSanity. It describes the exact contract the game
uses to request videos so you can build a server with **any technology** and **your own
security measures**.

Three ready-to-run reference servers implementing this protocol are included:

| Folder                       | Stack       | Notes                                      |
|-------------------------------|-------------|---------------------------------------------|
| `bga-server-go/`              | Go          | Single binary, no dependencies.              |
| `bga-server-php/`             | PHP         | For shared hosting (Apache + mod_rewrite).   |
| `bga-server-node/`            | Node.js     | Single file, zero npm dependencies.          |

Each folder has its own README with setup/run instructions for that stack. This document
covers the protocol itself. Read it first: it applies to all three, and to any custom
server you build.

> TL;DR: the client just does `GET {your-url}/{filename}` over HTTP/HTTPS and saves the
> body as the movie file. Any plain static file host already speaks this protocol.

---

## 1. What a BGA repository is

When a chart references a background video (e.g. `1040.mpg`) that the player does **not**
have locally in `SongMovies/`, the game can fetch it from a remote repository before
gameplay. A "repository" is just an HTTP(S) endpoint that returns video files by name.

You are free to serve real files, redirect to a CDN/mirror, add authentication, rate
limiting, etc. The game only cares about the request/response contract below.

---

## 2. Client configuration (for reference)

Players enable repositories by creating a text file in the game root:

```
Providers/bgas.txt
```

One repository **base URL per line**:

```
https://bga.example.com
https://mirror.another.net/pump
http://localhost:8080
```

- This file is the **only** source of providers (it is *dominant*): if it is missing or
  empty, the BGA download feature is disabled. Nothing is persisted elsewhere.
- Duplicate lines are ignored.
- A trailing `/` on a URL is stripped automatically.

---

## 3. The request contract

For each **missing** movie file, the game builds this request:

```
GET {base-url}/{filename}
```

Example: base `https://bga.example.com` + file `1040.mpg` →

```
GET https://bga.example.com/1040.mpg
```

Request details your server will see:

| Property        | Value                                             |
|-----------------|---------------------------------------------------|
| Method          | `GET` (also `HEAD` may be used by some hosts)      |
| `User-Agent`    | `XSANITY`                                          |
| Header          | `X-Client: XSANITY`                               |
| Protocols       | `http` and `https` only (including on redirects)   |
| Redirects       | Followed automatically, up to **5**                |
| Range requests  | Sent when resuming a partial download (`206`)      |
| Connect timeout | 10 s                                               |
| Stall timeout   | Aborted if transfer stays under 1 byte/s for 8 s   |

The `filename` is taken verbatim from the chart's background reference (its base name,
e.g. `1040.mpg`). **You are responsible for sanitizing it** (see §8).

---

## 4. Multiple providers & fallback

If the player configures several repositories, the game tries them **in order, per
file**, and stops at the first that succeeds:

```
for each missing video:
    for each provider (top to bottom in bga.txt):
        try GET provider/filename
        if it succeeds and passes validation -> keep it, go to next video
        otherwise -> try the next provider
```

So a `404` (you don't have that file), a network error, a timeout, or a rejected payload
simply makes the client move on to the next provider. Each file is resolved
independently, so `1040.mpg` may come from provider A and `1041.mp4` from provider B.

This means your repository does **not** need to hold every video; partial mirrors work.

---

## 5. Response codes

Use standard HTTP semantics. There is no custom protocol:

| Code               | Meaning / client behavior                                  |
|--------------------|------------------------------------------------------------|
| `200 OK`           | Full file served. Accepted (after validation).             |
| `206 Partial`      | Response to a `Range` request (resume). Accepted.          |
| `301/302/307/308`  | Redirect. Followed automatically (see §6).                 |
| `404 Not Found`    | You don't have it → client tries the next provider.        |
| `403 / 401`        | Treated as failure → next provider.                        |
| `429 Too Many`     | Treated as failure → next provider (send `Retry-After`).   |
| `5xx`              | Treated as failure → next provider.                        |

You do **not** need to send any special headers. `Content-Length`, `Accept-Ranges: bytes`
and a sensible `Content-Type` (e.g. `video/mpeg`) are recommended but optional.

---

## 6. Redirects & the "resolver" pattern (recommended)

The server that answers `GET /{filename}` does **not** have to be the one that stores the
file. A very common and encouraged pattern is a lightweight **resolver** that decides
where the file actually lives and issues an HTTP redirect:

```
GET https://bga.example.com/1040.mpg
      │
      ▼  (your resolver: PHP, Go, a rewrite rule, anything)
HTTP/1.1 302 Found
Location: https://storage-r2.example.com/pump/holy/10004959.mp4
      │
      ▼  the game follows the redirect automatically
downloads the real file from your storage/CDN
```

Why this is useful:

- The resolver spends **zero bandwidth** on the payload, it only picks a URL. You can run
  it on cheap/free hosting while the heavy files sit on S3/R2/B2 or a mirror.
- Enables geo‑routing, load balancing between mirrors, cache‑or‑origin logic, signed URLs,
  etc., all transparent to the game.
- Prefer real HTTP redirects (or `X-Accel-Redirect` / nginx `proxy_pass`) over manually
  re‑streaming the file in your app code, which would double your bandwidth.

Redirects are restricted to `http`/`https` and the **final** URL is validated (see §7).

---

## 7. What the client accepts

For a download to be kept, the **final** URL (after following any redirects) must resolve
to a supported video, meaning its extension must be one of:

```
mpg, mpeg, mp4, avi, webm, mkv, mov, flv, f4v, ogv, wmv
```

(or `nobga` for a package, see §9). Anything else is ignored and the client moves on to the
next provider. Sending a sensible `Content-Type` (e.g. `video/mpeg`) is recommended.

The file is downloaded to a temporary `*.part` file first and only moved into place once the
transfer completes, so an interrupted download never leaves a half‑written file behind.

---

## 8. Filename rules & server‑side sanitization

The `{filename}` comes from a chart and is attacker‑influenced in the general case. Your
server **must** protect itself. Recommended rules (all three reference servers do all of
these):

- Reduce the request path to just its **base name** (drop any directory parts).
- Block path traversal: reject `..`, `/`, `\`, and absolute paths inside the name.
- **Whitelist extensions**: only serve `.mpg/.mpeg/.mp4/.avi/.webm/.mkv/.mov/.flv/.f4v/.ogv/.wmv`
  (add `.nobga` if you use packages), and reject anything outside that list.
- **Do not** expose a directory listing / index of your files.

> Tip: URLs are case/`/`-sensitive across OSes. The game normalizes the local name, but
> keep your remote filenames consistent (lowercase is a safe convention).

---

## 9. NOBGA packages (optional, advanced)

Instead of a real video, a server may answer with a **NOBGA package**, a mountable
"fake video" bundle used by the game. To serve one, make the movie request **redirect to a
`.nobga` URL**:

```
GET /1040.mpg  →  302  Location: https://.../1040.nobga
```

The client detects the `.nobga` final extension, saves it to `NOBGA/1040.NOBGA` in the
game folder, and mounts it live (no restart needed). The game handles playback from there.
If you don't use this feature, ignore it; plain video files are the default.

---

## 10. Building your own server

**Any static file host already works.** Point a provider line at a folder served over
HTTP and drop your videos in it:

- nginx / Apache / Caddy serving a directory (disable autoindex).
- Object storage with public read: S3, Cloudflare R2, Backblaze B2, GitHub Pages, Netlify.
- One of the included reference servers: Go (`bga-server-go/`), PHP
  (`bga-server-php/`), or Node.js (`bga-server-node/`). See each folder's
  README for setup/run instructions.
- Ultra‑quick, no server code at all: Python 3.7+ already supports Range, so
  `cd videos && python -m http.server 8080` is enough.

---

## 11. Recommended security (you implement it)

The game only enforces the client‑side checks in §7. Everything else is up to you. A solid,
low‑effort setup:

- **Put Cloudflare (free tier) in front.** Absorbs DDoS, caches files at the edge (videos
  never change once published), and gives you rate limiting + "I'm Under Attack" with one
  click. This alone handles most abuse concerns for a home server.
- **Rate limit per IP** (e.g. token bucket, 20 req/min) and answer `429` + `Retry-After`.
- **No directory listing.** Don't expose an index of your catalog.
- **Hotlink filter (light):** you may check `User-Agent: XSANITY` or `X-Client: XSANITY`.
  This is *not* real security (headers are trivially forged) but filters generic bots.
- **Aggressive cache headers:** `Cache-Control: public, max-age=31536000`. The files are
  immutable once published, so let CDNs/edges cache them.
- **HTTPS** with a valid certificate (the client uses the OS trust store).
- Keep the extension whitelist and path‑traversal blocking from §8.
