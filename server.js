/**
 * AquaGo – Server v4 (with Database)
 * Port: 7474  (IjaraGo: 8080 – to'qnashuv yo'q)
 * HTTP + REST API + Server-Sent Events = real-time cross-device sync
 * + Tunnel: boshqa tarmoqdan ham kirish imkoniyati
 * + Database: lowdb for persistent storage
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PORT = process.env.PORT || 7474;

// ── Database ───────────────────────────────────────────────
// Use cloud database if DATABASE_URL is present, otherwise use local lowdb
const db = process.env.DATABASE_URL ? require('./database-cloud') : require('./database');
let dbInitialized = false;

// ── In-memory cache for SSE (synced with database) ──────────
let dbOrders = [];
let dbUsers = [];
let dbMessages = [];
let driverLocs = {};

// ── Sync cache with database ─────────────────────────────────
async function syncCache() {
    if (!dbInitialized) {
        await db.initDatabase();
        dbInitialized = true;
    }
    
    dbOrders = await db.getOrders();
    dbUsers = await db.getUsers();
    dbMessages = await db.getMessages();
    driverLocs = await db.getDriverLocations();
    
    console.log('[Server] Cache synced:', {
        orders: dbOrders.length,
        users: dbUsers.length,
        messages: dbMessages.length,
        drivers: Object.keys(driverLocs).length
    });
}

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

// ── Tunnel URL ───────────────────────────────────────────
let tunnelUrl = null;

// ── Router ───────────────────────────────────────────────
const handler = async (req, res) => {
    const url = req.url.split('?')[0];
    const mtd = req.method.toUpperCase();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (mtd === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // ── TUNNEL URL (client auto-detect) ──────────────────────
    if (url === '/api/tunnel-url' && mtd === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: tunnelUrl }));
        return;
    }

    // ── DRIVER LOCATION (lightweight POST, no SSE overhead) ─────
    if (url === '/api/driver-location' && mtd === 'POST') {
        body(req).then(async ({ driverId, lat, lng, heading }) => {
            if (driverId) {
                await db.updateDriverLocation(driverId, { lat, lng, heading });
                driverLocs = await db.getDriverLocations(); // Sync cache
                push('driver-location', { driverId, lat, lng, heading });
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{"ok":true}');
        });
        return;
    }
    if (url === '/api/driver-location' && mtd === 'GET') {
        const locs = await db.getDriverLocations();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(locs));
        return;
    }

    // ── CHAT MESSAGES ────────────────────────────────────────────
    if (url.startsWith('/api/messages')) {
        const orderId = new URL('http://x' + req.url).searchParams.get('orderId');
        if (mtd === 'GET') {
            const msgs = await db.getMessages();
            const filtered = orderId ? msgs.filter(m => m.orderId === orderId) : msgs.slice(-50);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(filtered));
            return;
        }
        if (mtd === 'POST') {
            body(req).then(async msg => {
                msg.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
                msg.ts = Date.now();
                const created = await db.createMessage(msg);
                dbMessages = await db.getMessages(); // Sync cache
                push('message', created);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, msg: created }));
            });
            return;
        }
    }

    // ── RATINGS ──────────────────────────────────────────────────
    if (url === '/api/ratings' && mtd === 'POST') {
        body(req).then(async rating => {
            // Save rating to order
            const updated = await db.updateOrder(rating.orderId, { rating });
            if (updated) {
                dbOrders = await db.getOrders(); // Sync cache
                push('orders', dbOrders);
            }
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
        const users = await db.getUsers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(users));
        return;
    }
    // POST /api/users
    if (url === '/api/users' && mtd === 'POST') {
        body(req).then(async user => {
            const created = await db.createUser(user);
            dbUsers = await db.getUsers();
            push('users', dbUsers);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, user: created }));
        });
        return;
    }

    // GET /api/orders
    if (url === '/api/orders' && mtd === 'GET') {
        const orders = await db.getOrders();
        dbOrders = orders; // Sync cache
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orders));
        return;
    }
    // POST /api/orders  (single new order)
    if (url === '/api/orders' && mtd === 'POST') {
        body(req).then(async order => {
            console.log('[SERVER] New order received:', order.id);
            const created = await db.createOrder(order);
            dbOrders = await db.getOrders(); // Sync cache
            // Push to all SSE clients immediately
            push('orders', dbOrders);
            console.log('[SERVER] SSE push sent to', clients.size, 'clients');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, order: created }));
        });
        return;
    }
    // PUT /api/orders  (full replace)
    if (url === '/api/orders' && mtd === 'PUT') {
        body(req).then(async orders => {
            if (Array.isArray(orders)) {
                // Delete all existing orders and add new ones
                for (const order of orders) {
                    await db.createOrder(order);
                }
                dbOrders = await db.getOrders(); // Sync cache
                push('orders', dbOrders);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
        });
        return;
    }
    // PATCH /api/orders/:id
    const pm = url.match(/^\/api\/orders\/([^/]+)$/);
    if (pm && (mtd === 'PATCH' || mtd === 'PUT')) {
        body(req).then(async upd => {
            const updated = await db.updateOrder(pm[1], upd);
            if (updated) {
                dbOrders = await db.getOrders(); // Sync cache
                push('orders', dbOrders);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, order: updated }));
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

http.createServer(handler).listen(PORT, '0.0.0.0', async () => {
    // Initialize database and sync cache
    await syncCache();
    
    const localUrl = `http://${IP}:${PORT}`;
    const { exec } = require('child_process');

    console.clear();
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║         🌊  AquaGo – Real-time Sync Server (DB)      ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║                                                        ║');
    console.log('║  💻  Kompyuter (brauzer avtomatik ochiladi)             ║');
    console.log('║                                                        ║');
    console.log('║  📱  BIR XIL WiFi: Telefonda shu manzilni oching:      ║');
    console.log(`║      ${localUrl.padEnd(52)}║`);
    console.log('║                                                        ║');
    console.log('║  🌐  BOSHQA TARMOQ: Tunnel ochilyapti...               ║');
    console.log('║                                                        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Auto-open browser on computer (app.html = login page)
    exec(`start chrome --app=http://localhost:${PORT}/app.html`, err => {
        if (err) exec(`start http://localhost:${PORT}/app.html`);
    });

    // ── Cloudflare Tunnel: boshqa tarmoqdan kirish ────────────
    const cfPath = path.join(ROOT, 'cloudflared.exe');
    if (fs.existsSync(cfPath)) {
        const cf = spawn(cfPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let urlFound = false;
        const parseUrl = (data) => {
            const text = data.toString();
            const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
            if (match && !urlFound) {
                urlFound = true;
                tunnelUrl = match[0];
                console.log('╔════════════════════════════════════════════════════════════╗');
                console.log('║  🌐  TUNNEL TAYYOR! Istalgan joydan kiring:               ║');
                console.log('║                                                            ║');
                console.log(`║  📱  ${tunnelUrl.padEnd(56)}║`);
                console.log('║                                                            ║');
                console.log('║  ☝️  Shu manzilni telefonning brauzeriga yozing!           ║');
                console.log('║      WiFi bir xil bo\'lmasa ham ishlaydi! ✅                ║');
                console.log('║      TO\'G\'RIDAN-TO\'G\'RI ochiladi! 🎉                     ║');
                console.log('║                                                            ║');
                console.log('╚════════════════════════════════════════════════════════════╝\n');
            }
        };

        cf.stdout.on('data', parseUrl);
        cf.stderr.on('data', parseUrl);

        cf.on('close', (code) => {
            tunnelUrl = null;
            console.log('⚠️  Tunnel yopildi (code:', code, '). Server hali ishlayapti (lokal).');
        });

        // Server yopilganda tunnel ham yopilsin
        process.on('exit', () => { try { cf.kill(); } catch {} });
        process.on('SIGINT', () => { try { cf.kill(); } catch {} process.exit(); });
    } else {
        console.log('⚠️  cloudflared.exe topilmadi. Faqat lokal tarmoqda ishlaydi.');
    }
});
