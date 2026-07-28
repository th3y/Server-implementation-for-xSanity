# XSanity BGA Repository: PHP reference server

Same protocol as the Go reference server, reimplemented in plain PHP for shared hosting
(Apache + `mod_rewrite`, no build step, no CLI access needed).

For the full protocol contract (request/response contract, redirect/resolver pattern,
`.nobga` packages, security recommendations) see
[`../bga-server-protocol.md`](../bga-server-protocol.md). This document only covers
running *this* PHP implementation.

## Setup

1. Upload this whole folder to your host (e.g. `public_html/bga/`).
2. Make sure `mod_rewrite` is enabled and `.htaccess` overrides are allowed
   (`AllowOverride All` in the vhost, or ask your host; most shared hosts allow this by
   default).
3. Drop your video files into `videos/` (e.g. `1040.mpg`).
4. Add `https://yourdomain.com/bga/` to `Providers/bgas.txt`.

Requires PHP 7.4+. No Composer dependencies.

## Behavior

- `GET /{filename}` serves the file from `videos/` if its extension is on the
  whitelist (`mpg mpeg mp4 avi webm mkv mov flv f4v ogv wmv nobga`), with `Range`
  support (resumable downloads, `206 Partial Content`).
- Filenames are resolved through `basename()` first and rejected on `..`/`/`/`\`, so
  there is no path traversal.
- If the requested video is missing but a `{basename}.nobga` file exists next to it, the
  server issues a `302` redirect to it (see the NOBGA packages section in the main
  protocol doc).
- Anything else (unknown extension, missing file, no `.nobga` fallback) is a `404`.
- `videos/` is served exclusively through `index.php`: the `.htaccess` routes every
  request through the script and forbids direct access to `videos/*`, so extension
  whitelisting and the `.nobga` fallback can't be bypassed by hitting the file directly.
- `Options -Indexes` disables directory listing.

## Config

Edit `config.php`:

```php
return [
	'throttle_kbps' => 0,   // >0 to throttle downloads, e.g. to test the in-game progress bar
];
```

## Large videos (50–200 MB+)

`index.php` calls `set_time_limit(0)` so a slow client downloading a large video doesn't
get cut off by PHP's execution-time limit; the file is streamed in chunks (never loaded
fully into memory), so `memory_limit` isn't a concern either. Still worth checking on
shared hosting:

- Some hosts hard-cap execution time at the FastCGI/Apache level (ignoring
  `set_time_limit`). If large downloads get cut off, ask your host to raise it or move
  to the Node/Go server, which don't have this limit.
- If you sit behind nginx as a reverse proxy in front of PHP-FPM, check
  `client_max_body_size` and proxy buffering settings so large responses aren't
  truncated.
- For heavy concurrent traffic, prefer the redirect/resolver pattern from the main
  protocol doc (§6): point this server at small/rare files and let a CDN or object
  storage (S3/R2/B2) serve the bulk of the bandwidth.
