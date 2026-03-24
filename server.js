/**
 * AquaGo – Server v3
 * Port: 7474  (IjaraGo: 8080 – to'qnashuv yo'q)
 * HTTP + REST API + Server-Sent Events = real-time cross-device sync
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = process.env.PORT || 7474;

// ── Persistent DB ────────────────────────────────────────
const DB_ORDERS = path.join(ROOT, '.db_orders.json');
const DB_USERS = path.join(ROOT, '.db_users.json');
const DB_MSGS = path.join(ROOT, '.db_messages.json');

let dbOrders = [];
let dbUsers = [];
let dbMessages = [];     // chat xabarlari
let driverLocs = {};     // { driverId: { lat, lng, heading, ts } }

try { dbOrders = JSON.parse(fs.readFileSync(DB_ORDERS, 'utf8')); } catch { }
try { dbUsers = JSON.parse(fs.readFileSync(DB_USERS, 'utf8')); } catch { }
try { dbMessages = JSON.parse(fs.readFileSync(DB_MSGS, 'utf8')); } catch { }

const save = () => {
    try { fs.writeFileSync(DB_ORDERS, JSON.stringify(dbOrders)); } catch { }
    try { fs.writeFileSync(DB_USERS, JSON.stringify(dbUsers)); } catch { }
    try { fs.writeFileSync(DB_MSGS, JSON.stringify(dbMessages.slice(-200))); } catch { }
};

// ── SSE clients ──────────────────────────────────────────
const clients = new Set();
const push = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const r of clients) { try { r.write(msg); } catch { clients.delete(r); } }
};

// ── MIME ─────────────────────────────────────────────────
const MIME = {
    html: 'text/html; charset=utf-8', css: 'text/css', js: 'application/javascript',
    json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    ico: 'image/x-icon', svg: 'image/svg+xml', webp: 'image/webp', woff2: 'font/woff2',
    txt: 'text/plain', mp3: 'audio/mpeg', mp4: 'video/mp4', woff: 'font/woff',
};

const body = req => new Promise(ok => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { ok(JSON.parse(b)); } catch { ok({}); } });
});

// ── Router ───────────────────────────────────────────────
const handler = (req, res) => {
    const url = req.url.split('?')[0];
    const mtd = req.method.toUpperCase();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (mtd === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── DRIVER LOCATION (lightweight POST, no SSE overhead) ─────
    if (url === '/api/driver-location' && mtd === 'POST') {
        body(req).then(({ driverId, lat, lng, heading }) => {
            if (driverId) {
                driverLocs[driverId] = { lat, lng, heading, ts: Date.now() };
                push('driver-location', { driverId, lat, lng, heading });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        return;
    }
    if (url === '/api/driver-location' && mtd === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(driverLocs));
        return;
    }

    // ── CHAT MESSAGES ────────────────────────────────────────────
    if (url.startsWith('/api/messages')) {
        const orderId = new URL('http://x' + req.url).searchParams.get('orderId');
        if (mtd === 'GET') {
            const msgs = orderId ? dbMessages.filter(m => m.orderId === orderId) : dbMessages.slice(-50);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(msgs));
            return;
        }
        if (mtd === 'POST') {
            body(req).then(msg => {
                msg.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
                msg.ts = Date.now();
                dbMessages.push(msg);
                save();
                push('message', msg);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, msg }));
            });
            return;
        }
    }

    // ── RATINGS ──────────────────────────────────────────────────
    if (url === '/api/ratings' && mtd === 'POST') {
        body(req).then(rating => {
            // Save rating to order
            const i = dbOrders.findIndex(o => o.id === rating.orderId);
            if (i >= 0) { dbOrders[i].rating = rating; save(); push('orders', dbOrders); }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        return;
    }

    // SSE
    if (url === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });
        res.write(':ok\n\n');
        res.write(`event: orders\ndata: ${JSON.stringify(dbOrders)}\n\n`);
        res.write(`event: users\ndata: ${JSON.stringify(dbUsers)}\n\n`);
        res.write(`event: messages\ndata: ${JSON.stringify(dbMessages.slice(-50))}\n\n`);
        res.write(`event: driver-locations\ndata: ${JSON.stringify(driverLocs)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    // GET /api/users
    if (url === '/api/users' && mtd === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbUsers));
        return;
    }
    // POST /api/users  (full replace)
    if (url === '/api/users' && mtd === 'POST') {
        body(req).then(u => {
            dbUsers = u; save(); push('users', dbUsers);
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        });
        return;
    }

    // GET /api/orders
    if (url === '/api/orders' && mtd === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbOrders));
        return;
    }
    // POST /api/orders  (single new order)
    if (url === '/api/orders' && mtd === 'POST') {
        body(req).then(order => {
            if (!dbOrders.find(o => o.id === order.id)) { dbOrders.unshift(order); save(); }
            push('orders', dbOrders);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, order }));
        });
        return;
    }
    // PUT /api/orders  (full replace)
    if (url === '/api/orders' && mtd === 'PUT') {
        body(req).then(orders => {
            if (Array.isArray(orders)) { dbOrders = orders; save(); push('orders', dbOrders); }
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        });
        return;
    }
    // PATCH /api/orders/:id
    const pm = url.match(/^\/api\/orders\/([^/]+)$/);
    if (pm && (mtd === 'PATCH' || mtd === 'PUT')) {
        body(req).then(upd => {
            const i = dbOrders.findIndex(o => o.id === pm[1]);
            if (i >= 0) {
                dbOrders[i] = { ...dbOrders[i], ...upd }; save(); push('orders', dbOrders);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, order: dbOrders[i] }));
            } else { res.writeHead(404); res.end('{}'); }
        });
        return;
    }

    // Static files
    let p = url === '/' ? '/index.html' : url;
    const fp = path.normalize(path.join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    try {
        const data = fs.readFileSync(fp);
        const ext = path.extname(fp).slice(1).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(data);
    } catch { res.writeHead(404); res.end('404: ' + p); }
};

// ── Start ────────────────────────────────────────────────
function getIP() {
    const ifaces = os.networkInterfaces();
    for (const n of Object.keys(ifaces))
        for (const i of ifaces[n])
            if (i.family === 'IPv4' && !i.internal) return i.address;
    return '127.0.0.1';
}
const IP = getIP();

http.createServer(handler).listen(PORT, '0.0.0.0', () => {
    const url = `http://${IP}:${PORT}`;
    console.clear();
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║      🌊  AquaGo – Real-time Sync Server           ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log('║                                                    ║');
    console.log('║  💻  Kompyuterda (brauzer avtomatik ochiladi)      ║');
    console.log('║                                                    ║');
    console.log('║  📱  Telefonda shu manzilni oching:                ║');
    console.log(`║      ${url.padEnd(48)}║`);
    console.log('║                                                    ║');
    console.log('║  ✅  Telefon va kompyuter REAL-TIME ulangan!       ║');
    console.log('║                                                    ║');
    console.log('╚════════════════════════════════════════════════════╝\n');
    // Auto-open browser on computer
    const { exec } = require('child_process');
    exec(`start chrome --app=http://localhost:${PORT}`, err => {
        if (err) exec(`start http://localhost:${PORT}`);
    });
});
