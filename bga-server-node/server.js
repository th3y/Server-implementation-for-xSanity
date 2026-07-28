'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ALLOWED_EXT = new Set([
	'.mpg', '.mpeg', '.mp4', '.avi', '.webm', '.mkv', '.mov', '.flv', '.f4v', '.ogv', '.wmv', '.nobga',
]);

function parseArgs(argv) {
	const args = { addr: 8080, dir: './videos', kbps: 0 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--addr' || a === '--port') args.addr = parseInt(argv[++i], 10);
		else if (a === '--dir') args.dir = argv[++i];
		else if (a === '--kbps') args.kbps = parseInt(argv[++i], 10);
	}
	return args;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.dir);

if (!fs.existsSync(root)) {
	console.error(`dir does not exist: ${root}`);
	process.exit(1);
}

function mimeFor(ext) {
	switch (ext) {
		case '.mpg':
		case '.mpeg': return 'video/mpeg';
		case '.mp4': return 'video/mp4';
		case '.avi': return 'video/x-msvideo';
		case '.webm': return 'video/webm';
		case '.mkv': return 'video/x-matroska';
		case '.mov': return 'video/quicktime';
		case '.flv':
		case '.f4v': return 'video/x-flv';
		case '.ogv': return 'video/ogg';
		case '.wmv': return 'video/x-ms-wmv';
		default: return 'application/octet-stream';
	}
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
	if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
	res.writeHead(partial ? 206 : 200, headers);

	if (req.method === 'HEAD') {
		res.end();
		return;
	}

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

const server = http.createServer((req, res) => {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405);
		res.end();
		return;
	}

	const url = new URL(req.url, `http://${req.headers.host}`);
	const name = path.basename(url.pathname).toLowerCase();

	if (!name || name === '.' || name === '..') {
		res.writeHead(404);
		res.end();
		return;
	}

	const ext = path.extname(name);
	if (!ALLOWED_EXT.has(ext)) {
		console.log(`reject ${url.pathname} (ext "${ext}" not allowed)`);
		res.writeHead(404);
		res.end();
		return;
	}

	const full = path.join(root, name);
	let st;
	try {
		st = fs.statSync(full);
	} catch (e) {
		st = null;
	}

	if (!st || !st.isFile()) {
		const base = name.slice(0, name.length - ext.length);
		const nobgaPath = path.join(root, base + '.nobga');
		try {
			if (fs.statSync(nobgaPath).isFile()) {
				console.log(`302 ${name} -> ${base}.nobga`);
				res.writeHead(302, { Location: `/${base}.nobga` });
				res.end();
				return;
			}
		} catch (e) {}
		console.log(`404 ${name}`);
		res.writeHead(404);
		res.end();
		return;
	}

	console.log(`${req.socket.remoteAddress} -> ${name} (${st.size} bytes)`);
	serveFile(req, res, full, mimeFor(ext));
});

server.listen(args.addr, () => {
	console.log(`BGA server serving ${root} on :${args.addr}`);
	if (args.kbps > 0) console.log(`Throttling downloads to ~${args.kbps} KB/s`);
});
