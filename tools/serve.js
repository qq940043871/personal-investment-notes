#!/usr/bin/env node
/**
 * Zero-dependency static file server for the interview workbench.
 * Replaces `npx http-server` so startup costs only a bare `node` launch (~60ms).
 *
 * Usage: node tools/serve.js [port]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 3001);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jsonl': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.pdf': 'application/pdf',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.sh': 'text/plain; charset=utf-8',
    '.bat': 'text/plain; charset=utf-8',
};

function mimeOf(file) {
    return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function dirListing(urlPath, dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.'))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'zh') : a.isDirectory() ? -1 : 1));

    const items = entries.map((e) => {
        const name = e.name + (e.isDirectory() ? '/' : '');
        const href = encodeURI(urlPath.replace(/\/?$/, '/') + name);
        return `<li><a href="${href}">${escapeHtml(name)}</a></li>`;
    });

    if (urlPath !== '/') items.unshift('<li><a href="../">../</a></li>');

    return `<!doctype html><meta charset="utf-8"><title>Index of ${escapeHtml(urlPath)}</title>
<style>body{font:14px/1.7 system-ui,sans-serif;margin:2rem}li{list-style:none}a{text-decoration:none;color:#0366d6}</style>
<h3>Index of ${escapeHtml(urlPath)}</h3><ul>${items.join('')}</ul>`;
}

function send(res, status, type, body, req) {
    const headers = {
        'Content-Type': type,
        'Cache-Control': 'no-store', // 等价 http-server 的 -c-1：改完内容刷新即生效
    };
    if (body !== undefined) headers['Content-Length'] = Buffer.byteLength(body);
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'text/plain; charset=utf-8', 'Method Not Allowed', req);
    }

    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', req);
    }

    if (urlPath.includes('\0')) {
        return send(res, 400, 'text/plain; charset=utf-8', 'Bad Request', req);
    }

    const target = path.join(ROOT, urlPath);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
        return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden', req);
    }

    fs.stat(target, (err, stat) => {
        if (err) return send(res, 404, 'text/plain; charset=utf-8', 'Not Found: ' + urlPath, req);

        if (stat.isDirectory()) {
            const indexFile = path.join(target, 'index.html');
            if (fs.existsSync(indexFile)) return streamFile(indexFile, res, req);
            if (!urlPath.endsWith('/')) {
                res.writeHead(301, { Location: encodeURI(urlPath + '/') });
                return res.end();
            }
            return send(res, 200, 'text/html; charset=utf-8', dirListing(urlPath, target), req);
        }

        return streamFile(target, res, req);
    });
});

function streamFile(file, res, req) {
    const stat = fs.statSync(file);
    res.writeHead(200, {
        'Content-Type': mimeOf(file),
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
    }
    console.error(err.message);
    process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`  Workbench: http://127.0.0.1:${PORT}/`);
    console.log(`  Root     : ${ROOT}`);
    console.log('  Press Ctrl+C to stop');
});
