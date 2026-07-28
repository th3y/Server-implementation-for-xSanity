'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function parseArgs(argv) {
	const args = { port: 8090, dir: '.', name: 'Local Pack Repo', kbps: 0 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--port') args.port = parseInt(argv[++i], 10);
		else if (a === '--dir') args.dir = argv[++i];
		else if (a === '--name') args.name = argv[++i];
		else if (a === '--kbps') args.kbps = parseInt(argv[++i], 10);
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(args.dir);
const packsDir = path.join(rootDir, 'packs');
const thumbsDir = path.join(rootDir, 'thumbs');

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++)
			c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32File(filePath) {
	return new Promise((resolve, reject) => {
		let crc = 0xFFFFFFFF;
		const stream = fs.createReadStream(filePath);
		stream.on('data', (chunk) => {
			for (let i = 0; i < chunk.length; i++)
				crc = CRC_TABLE[(crc ^ chunk[i]) & 0xFF] ^ (crc >>> 8);
		});
		stream.on('end', () => resolve(((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')));
		stream.on('error', reject);
	});
}

async function cachedCrc32(zipPath) {
	const cachePath = zipPath + '.crc';
	const st = fs.statSync(zipPath);
	const mtime = Math.floor(st.mtimeMs);
	const size = st.size;

	if (fs.existsSync(cachePath)) {
		try {
			const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
			if (cache.mtime === mtime && cache.size === size)
				return cache.crc32;
		} catch (e) {}
	}

	const crc32 = await crc32File(zipPath);
	try {
		fs.writeFileSync(cachePath, JSON.stringify({ mtime, size, crc32 }));
	} catch (e) {}
	return crc32;
}

function baseUrl(req) {
	const proto = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http');
	return `${proto}://${req.headers.host}`;
}

function safeBasename(name) {
	if (!name) return null;
	const base = path.basename(name).toLowerCase();
	if (base === '' || base === '.' || base === '..' || base.includes('..'))
		return null;
	return base;
}

async function handleCatalog(req, res) {
	const staticCatalog = path.join(rootDir, 'catalog.json');
	if (fs.existsSync(staticCatalog) && fs.statSync(staticCatalog).isFile()) {
		res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
		fs.createReadStream(staticCatalog).pipe(res);
		return;
	}

	const base = baseUrl(req);
	const packs = [];

	let zips = [];
	try {
		zips = fs.readdirSync(packsDir).filter((f) => f.toLowerCase().endsWith('.zip'));
	} catch (e) {}

	for (const zipName of zips) {
		const zipPath = path.join(packsDir, zipName);
		const st = fs.statSync(zipPath);
		if (!st.isFile()) continue;
		const id = zipName.slice(0, -4);

		const pack = {
			id,
			name: id,
			size: st.size,
			url: `${base}/packs/${encodeURIComponent(id)}.zip`,
			type: 'songpackage',
			version: '1.0.0',
		};

		const metaPath = path.join(packsDir, id + '.json');
		if (fs.existsSync(metaPath)) {
			try {
				const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
				if (meta.name) pack.name = meta.name;
				if (meta.author) pack.author = meta.author;
				if (meta.songs !== undefined) pack.songs = meta.songs;
				if (meta.type === 'userpackage') pack.type = 'userpackage';
				if (meta.version) pack.version = meta.version;
			} catch (e) {}
		}

		const crc32 = await cachedCrc32(zipPath);
		if (crc32) pack.crc32 = crc32;

		for (const ext of ['png', 'jpg', 'jpeg']) {
			const thumbPath = path.join(thumbsDir, id + '.' + ext);
			if (fs.existsSync(thumbPath)) {
				pack.image = `${base}/thumbs/${encodeURIComponent(id)}.${ext}`;
				break;
			}
		}

		packs.push(pack);
	}

	const catalog = { name: args.name, packs };
	res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
	res.end(JSON.stringify(catalog, null, 2));
}

function serveFile(req, res, fullPath, contentType) {
	const st = fs.statSync(fullPath);
	let start = 0;
	let end = st.size - 1;
	let partial = false;

	const range = req.headers.range;
	if (range) {
		const m = /bytes=(\d*)-(\d*)/.exec(range);
		if (m) {
			if (m[1] !== '') start = parseInt(m[1], 10);
			if (m[2] !== '') end = parseInt(m[2], 10);
			if (start > end || end >= st.size) {
				res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
				res.end();
				return;
			}
			partial = true;
		}
	}

	const length = end - start + 1;
	const headers = {
		'Content-Type': contentType,
		'Accept-Ranges': 'bytes',
		'Content-Length': length,
		'Cache-Control': 'public, max-age=31536000',
	};
	if (partial)
		headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
	res.writeHead(partial ? 206 : 200, headers);

	const stream = fs.createReadStream(fullPath, { start, end });

	if (args.kbps > 0) {
		const chunkSize = Math.max(1024, Math.floor(args.kbps * 1024 / 10));
		stream.on('data', (chunk) => {
			stream.pause();
			let offset = 0;
			const pushChunk = () => {
				if (offset >= chunk.length) {
					stream.resume();
					return;
				}
				const piece = chunk.subarray(offset, offset + chunkSize);
				res.write(piece);
				offset += chunkSize;
				setTimeout(pushChunk, 100);
			};
			pushChunk();
		});
		stream.on('end', () => res.end());
		stream.on('error', () => res.end());
	} else {
		stream.pipe(res);
	}
}

function handlePacks(req, res, fileParam) {
	const name = safeBasename(fileParam);
	if (!name || !name.endsWith('.zip')) {
		res.writeHead(404);
		res.end();
		return;
	}
	const fullPath = path.join(packsDir, name);
	if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
		res.writeHead(404);
		res.end();
		return;
	}
	serveFile(req, res, fullPath, 'application/zip');
}

const THUMB_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

function handleThumbs(req, res, fileParam) {
	const name = safeBasename(fileParam);
	const ext = name ? path.extname(name).slice(1).toLowerCase() : '';
	if (!name || !THUMB_MIME[ext]) {
		res.writeHead(404);
		res.end();
		return;
	}
	const fullPath = path.join(thumbsDir, name);
	if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
		res.writeHead(404);
		res.end();
		return;
	}
	serveFile(req, res, fullPath, THUMB_MIME[ext]);
}

const server = http.createServer((req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405);
		res.end();
		return;
	}

	const url = new URL(req.url, `http://${req.headers.host}`);
	const p = url.pathname;

	if (p === '/catalog.json') {
		handleCatalog(req, res).catch((err) => {
			res.writeHead(500);
			res.end(String(err));
		});
	} else if (p.startsWith('/packs/')) {
		handlePacks(req, res, p.slice('/packs/'.length));
	} else if (p.startsWith('/thumbs/')) {
		handleThumbs(req, res, p.slice('/thumbs/'.length));
	} else {
		res.writeHead(404);
		res.end();
	}
});

if (!fs.existsSync(packsDir))
	console.warn(`warning: ${packsDir} does not exist; create it and drop .zip packs inside`);

server.listen(args.port, () => {
	console.log(`Pack server serving ${rootDir} on :${args.port}`);
	if (args.kbps > 0)
		console.log(`Throttling downloads to ~${args.kbps} KB/s`);
});
