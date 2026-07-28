# XSanity Servers

XSanity can download content from the internet while the game is running. There are two
separate features, and this repository holds the documentation and a set of small working
servers for both:

- **BGA repositories** serve the background videos that charts reference.
- **Pack repositories** serve song packs and user packages (noteskins, themes) as `.zip`.

Both features are plain HTTP(S). There is no custom wire format, no handshake and no
authentication built into the protocol, so any static file host already works. The servers
here exist as a starting point and as a working description of what the game expects.

## Start with the protocol documents

| Document | What it covers |
|---|---|
| [bga-server-protocol.md](bga-server-protocol.md) | How the game requests videos, provider fallback, redirects and the resolver pattern, filename sanitization, NOBGA packages. |
| [pack-server-protocol.md](pack-server-protocol.md) | The JSON catalog format, pack fields, zip layout for song packs and user packages, versioning, thumbnails. |

Each one is the reference for its feature. Everything below implements those documents, and
so should any server you write yourself, in whatever language you prefer.

## Reference servers

| Folder | Feature | Stack | Notes |
|---|---|---|---|
| [bga-server-go](bga-server-go/) | BGA | Go | Single binary, no dependencies. |
| [bga-server-node](bga-server-node/) | BGA | Node.js | Single file, zero npm dependencies. |
| [bga-server-php](bga-server-php/) | BGA | PHP | Shared hosting (Apache + mod_rewrite). |
| [pack-server-go](pack-server-go/) | Packs | Go | Single binary, no dependencies. |
| [pack-server-node](pack-server-node/) | Packs | Node.js | Single file, zero npm dependencies. |
| [pack-server-php](pack-server-php/) | Packs | PHP | Shared hosting (Apache + mod_rewrite). |

The three implementations of a feature behave the same way, so pick whichever fits your
hosting. Each folder has its own README with build and run instructions.

## How it works, briefly

A chart asks for a video such as `1040.mpg`. If the player doesn't have it locally, the game
requests `GET {base-url}/1040.mpg` from each configured repository in order and keeps the
first response that turns out to be a supported video file. Your server can send the bytes
itself or answer with a `302` pointing at a CDN.

Packs work through a catalog. The game fetches a JSON file from each repository, merges the
results by pack `id` and lists them in-game. Downloading a pack is a single `GET` against
the URL in the catalog, which has to deliver a real `.zip`. The archive is then mounted
live, so the new songs or noteskins show up without restarting.

## Where players configure this

Two plain-text files in the game folder, one URL per line:

```
Providers/bgas.txt     base URLs of BGA repositories
Providers/packs.txt    catalog URLs of pack repositories
```

They are the only source of providers. If a file is missing or empty, that feature stays
disabled.

## Security

The game validates only what it has to: a supported video extension for BGAs, a valid zip
signature for packs. Rate limiting, DDoS protection, blocking path traversal and
whitelisting extensions are up to you as the operator. Both protocol documents end with a
section of concrete recommendations, and the reference servers already implement the basics.
