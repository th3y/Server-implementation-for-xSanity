# XSanity Pack Repository: PHP reference server

Same protocol as the other reference servers, reimplemented in plain PHP for shared hosting
(Apache + `mod_rewrite`, no build step, no CLI access needed).

For the full protocol contract (catalog JSON shape, `type`/`version`/`crc32` fields, zip
layout, security recommendations) see
[`../pack-server-protocol.md`](../pack-server-protocol.md). This document only covers
running *this* PHP implementation.

## Setup

1. Upload this whole folder to your host (e.g. `public_html/packs/`).
2. Make sure `mod_rewrite` is enabled and `.htaccess` overrides are allowed
   (`AllowOverride All` in the vhost, or ask your host; most shared hosts allow this by default).
3. Drop your `.zip` packs into `packs/`, optional thumbnails into `thumbs/`.
4. Point `Providers/packs.txt` in the game at `https://yourdomain.com/packs/catalog.json`.

Requires PHP 7.4+ (uses `hash_file('crc32b', ...)`, available since PHP 7.0). No Composer
dependencies.

## Endpoints

- `GET /catalog.json`: auto-generated from `packs/*.zip` (+ optional `packs/{id}.json`
  metadata, + `thumbs/{id}.ext`), or served as-is from `catalog.json.static` if that file
  exists (manual mode, same idea as the Go server's `catalog.json`, renamed here because
  `catalog.json` itself is the routed URL).
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

`crc32` is computed automatically and cached in a `packs/{id}.zip.crc` sidecar (keyed by
mtime+size) so multi-GB packs aren't rehashed on every request.

## Config

Edit `config.php`:

```php
return [
	'catalog_name'  => 'My Pack Repo',
	'throttle_kbps' => 0,   // >0 to throttle downloads, e.g. to test the in-game progress bar
];
```

## Notes

- `packs/` and `thumbs/` are served exclusively through `packs.php`/`thumbs.php`, which
  whitelist extensions and reject path traversal. The `.htaccess` routes every request
  under those folders through the scripts, so raw files (including `.json` metadata and
  `.crc` cache sidecars) are never served directly.
- `Options -Indexes` disables directory listing.
- For HTTPS behind a reverse proxy, this reads `X-Forwarded-Proto` for the catalog's
  generated URLs, so make sure your proxy sets it.

## Large packs (50–200 MB+)

`packs.php` calls `set_time_limit(0)` so a slow client downloading a large zip doesn't
get cut off by PHP's execution-time limit; the file is streamed in chunks (never loaded
fully into memory), so `memory_limit` isn't a concern either. Still worth checking on
shared hosting:

- Some hosts hard-cap execution time at the FastCGI/Apache level (ignoring
  `set_time_limit`). If large downloads get cut off, ask your host to raise it or move
  to the Node/Go server, which don't have this limit.
- If you sit behind nginx as a reverse proxy in front of PHP-FPM, check
  `client_max_body_size` and proxy buffering settings so large responses aren't
  truncated.
- For heavy concurrent traffic, serving multi-hundred-MB files through PHP/Node is less
  efficient than a CDN or static file host with `X-Accel-Redirect` (nginx) /
  `X-Sendfile`. That is fine for a small/personal repo, but worth changing at scale.
