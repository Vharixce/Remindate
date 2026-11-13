#!/usr/bin/env node
/*
 * Remmin Sync Server — keeps your remmin.json on your own (paid) server.
 * No packages needed: only Node.js 18 or newer.
 *
 *   SYNC_TOKEN=<a long secret> node scripts/remmin-sync-server.js
 *
 * Settings (environment variables):
 *   SYNC_TOKEN    required. The same token you type in Remmin > Sync Settings > Server Sync.
 *   PORT          port to listen on (default 8787; hosts like Railway/Render set this for you).
 *   DATA_DIR      folder where remmin.json is stored (default ./data). Use a persistent disk/volume.
 *   ALLOW_ORIGIN  which website may sync (default * = any). Example: https://vharixce.github.io
 *
 * In Remmin use the address  https://<your-server>/remmin.json
 *
 * API:  GET /remmin.json  -> the file (+ ETag), 404 when nothing stored yet
 *       PUT /remmin.json  -> saves the JSON body; send "If-Match: <ETag>" to avoid overwriting
 *                           someone else's newer save (answers 412 then)
 *       GET /health      -> "ok"
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN = process.env.SYNC_TOKEN || '';
const PORT = Number(process.env.PORT) || 8787;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const FILE = path.join(DATA_DIR, 'remmin.json');
const MAX_BYTES = 50 * 1024 * 1024; // drawings and voice notes can make the file big

if (TOKEN.length < 16) {
    console.error('Set SYNC_TOKEN to a secret of at least 16 characters, e.g.:');
    console.error(`  SYNC_TOKEN=${crypto.randomBytes(24).toString('hex')} node ${path.basename(__filename)}`);
    process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
// older versions stored the file as remindate.json or notes.json
const OLD_FILES = [path.join(DATA_DIR, 'remindate.json'), path.join(DATA_DIR, 'notes.json')];
const oldFile = OLD_FILES.find((f) => fs.existsSync(f));
if (!fs.existsSync(FILE) && oldFile) fs.copyFileSync(oldFile, FILE); // the old file stays as a backup

const etagOf = (buf) => `"${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}"`;
const readFile = () => { try { return fs.readFileSync(FILE); } catch { return null; } };
function tokenOk(req) {
    const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(TOKEN);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
}
function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') return send(res, 200, '"ok"');
    // /remindate.json and /notes.json are the old addresses and still work
    if (!['/remmin.json', '/remindate.json', '/notes.json'].includes(url.pathname)) return send(res, 404, { error: 'use /remmin.json' });
    if (!tokenOk(req)) return send(res, 401, { error: 'wrong or missing token' });

    if (req.method === 'GET') {
        const data = readFile();
        if (!data) return send(res, 404, { error: 'nothing stored yet' });
        return send(res, 200, data, { ETag: etagOf(data) });
    }
    if (req.method === 'PUT') {
        const chunks = []; let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BYTES) { send(res, 413, { error: 'file too large' }); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            if (res.writableEnded) return;
            const body = Buffer.concat(chunks);
            try { const v = JSON.parse(body.toString('utf8')); if (!v || typeof v !== 'object') throw 0; }
            catch { return send(res, 400, { error: 'body must be JSON' }); }
            const current = readFile();
            const ifMatch = req.headers['if-match'];
            if (ifMatch && current && ifMatch !== etagOf(current)) {
                return send(res, 412, { error: 'someone else saved first' }, { ETag: etagOf(current) });
            }
            // write to a temp file first so a crash never leaves a half-written remmin.json
            const tmp = `${FILE}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, body);
            if (current) fs.copyFileSync(FILE, path.join(DATA_DIR, 'notes.backup.json'));
            fs.renameSync(tmp, FILE);
            return send(res, 200, { ok: true }, { ETag: etagOf(body) });
        });
        return;
    }
    send(res, 405, { error: 'use GET or PUT' });
});

server.listen(PORT, () => console.log(`Remmin sync server on port ${PORT}, storing ${FILE}`));
