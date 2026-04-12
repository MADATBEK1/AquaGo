/**
 * AquaGo Real-Time Server with Socket.IO
 * Socket.IO = real-time bidirectional communication
 * Port: 7474 (same as main server)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 7474;
const ROOT = __dirname;

// ── In-Memory Database (test uchun) ──────────────────────
let orders = [];           // barcha buyurtmalar
let activeDrivers = [];      // aktiv suvchilar
let onlineUsers = new Map(); // socketId -> { userId, role, location }

// Order ID generator
let orderIdCounter = 1;
const generateOrderId = () => `ORD-${Date.now()}-${orderIdCounter++}`;

// ── HTTP Server (static files) ───────────────────────────
const httpServer = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    // Serve static files
    let filePath = url === '/' ? '/index.html' : url;
    filePath = path.join(ROOT, filePath);
    
    const ext = path.extname(filePath).slice(1) || 'html';
    const mimeTypes = {
        html: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg'
    };
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
    });
});

// ── Socket.IO Server ───────────────────────────────────
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

console.log('🚀 AquaGo Socket.IO Server initializing...\n');

// Socket.IO connection handler
io.on('connection', (socket) => {
    console.log(`✅ New connection: ${socket.id}`);
    
    // ── USER AUTHENTICATION ───────────────────────────────
    socket.on('auth', ({ userId, role, name }) => {
        onlineUsers.set(socket.id, { userId, role, name, socket });
        socket.userId = userId;
        socket.role = role;
        
        console.log(`🔐 ${role.toUpperCase()} logged in: ${name} (${userId})`);
        
        // Driver online bo'lsa, activeDrivers ga qo'shish
        if (role === 'driver') {
            if (!activeDrivers.find(d => d.userId === userId)) {
                activeDrivers.push({ userId, name, socketId: socket.id, location: null });
            }
            socket.broadcast.emit('driver_online', { userId, name });
        }
        
        socket.emit('auth_success', { userId, role });
    });
    
    // ── DRIVER LOCATION UPDATE ────────────────────────────
    socket.on('update_location', ({ lat, lng }) => {
        const user = onlineUsers.get(socket.id);
        if (user && user.role === 'driver') {
            const driver = activeDrivers.find(d => d.userId === user.userId);
            if (driver) {
                driver.location = { lat, lng, updatedAt: Date.now() };
                console.log(`📍 Driver ${user.name} location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            }
        }
    });
    
    // ── CREATE ORDER (Customer) ───────────────────────────
    socket.on('create_order', (orderData) => {
        const user = onlineUsers.get(socket.id);
        if (!user || user.role !== 'user') {
            socket.emit('error', { message: 'Faqat mijoz buyurtma berishi mumkin' });
            return;
        }
        
        const order = {
            id: generateOrderId(),
            customerId: user.userId,
            customerName: user.name,
            location: orderData.location,
            waterAmount: orderData.waterAmount || 1,
            status: 'pending',
            createdAt: Date.now(),
            driverId: null,
            driverName: null
        };
        
        orders.push(order);
        
        console.log(`\n📦 NEW ORDER: #${order.id}`);
        console.log(`   Mijoz: ${order.customerName}`);
        console.log(`   Suv miqdori: ${order.waterAmount} dona`);
        console.log(`   Manzil: ${order.location.lat.toFixed(4)}, ${order.location.lng.toFixed(4)}`);
        console.log(`   Aktiv suvchilar: ${activeDrivers.length} ta\n`);
        
        // 1. Mijozga tasdiqlash
        socket.emit('order_created', { 
            orderId: order.id, 
            status: order.status,
            message: 'Buyurtma qabul qilindi! Suvchi qidirilmoqda...' 
        });
        
        // 2. BARCHA aktiv driverlarga yuborish
        activeDrivers.forEach(driver => {
            const driverSocket = io.sockets.sockets.get(driver.socketId);
            if (driverSocket) {
                driverSocket.emit('new_order', {
                    orderId: order.id,
                    customerName: order.customerName,
                    location: order.location,
                    waterAmount: order.waterAmount,
                    distance: calculateDistance(driver.location, order.location),
                    timestamp: order.createdAt
                });
                console.log(`📤 Order sent to driver: ${driver.name}`);
            }
        });
        
        // 3. Agar driver bo'lmasa, mijozga xabar
        if (activeDrivers.length === 0) {
            socket.emit('no_drivers', { message: 'Hozircha aktiv suvchi yo\'q. Iltimos, keyinroq urinib ko\'ring.' });
        }
    });
    
    // ── ACCEPT ORDER (Driver) ─────────────────────────────
    socket.on('accept_order', ({ orderId }) => {
        const user = onlineUsers.get(socket.id);
        if (!user || user.role !== 'driver') {
            socket.emit('error', { message: 'Faqat suvchi buyurtma qabul qilishi mumkin' });
            return;
        }
        
        const order = orders.find(o => o.id === orderId);
        if (!order) {
            socket.emit('error', { message: 'Buyurtma topilmadi' });
            return;
        }
        
        if (order.status !== 'pending') {
            socket.emit('error', { message: 'Bu buyurtma allaqachon band' });
            return;
        }
        
        // Buyurtma statusini yangilash
        order.status = 'accepted';
        order.driverId = user.userId;
        order.driverName = user.name;
        order.acceptedAt = Date.now();
        
        console.log(`\n✅ ORDER ACCEPTED: #${order.id}`);
        console.log(`   Suvchi: ${user.name}`);
        console.log(`   Mijoz: ${order.customerName}\n`);
        
        // 1. Suvchiga tasdiqlash
        socket.emit('order_accepted_success', {
            orderId: order.id,
            customerName: order.customerName,
            location: order.location,
            waterAmount: order.waterAmount,
            phone: '+998901234567' // demo
        });
        
        // 2. Mijozga xabar (agar online bo'lsa)
        const customerSocket = findSocketByUserId(order.customerId);
        if (customerSocket) {
            customerSocket.emit('order_accepted', {
                orderId: order.id,
                driverName: user.name,
                driverPhone: '+998901234567',
                message: `${user.name} buyurtmangizni qabul qildi!`
            });
        }
        
        // 3. Boshqa driverlarga xabar (bu buyurtma band)
        socket.broadcast.emit('order_taken', { 
            orderId: order.id,
            driverName: user.name 
        });
    });
    
    // ── DRIVER OFFLINE ────────────────────────────────────
    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            console.log(`❌ ${user.role.toUpperCase()} disconnected: ${user.name}`);
            
            if (user.role === 'driver') {
                activeDrivers = activeDrivers.filter(d => d.userId !== user.userId);
                socket.broadcast.emit('driver_offline', { userId: user.userId });
            }
            
            onlineUsers.delete(socket.id);
        }
    });
});

// ── Helper Functions ─────────────────────────────────────
function findSocketByUserId(userId) {
    for (const [socketId, user] of onlineUsers.entries()) {
        if (user.userId === userId) {
            return io.sockets.sockets.get(socketId);
        }
    }
    return null;
}

function calculateDistance(loc1, loc2) {
    if (!loc1 || !loc2) return null;
    const R = 6371; // Earth's radius in km
    const dLat = (loc2.lat - loc1.lat) * Math.PI / 180;
    const dLon = (loc2.lng - loc1.lng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(loc1.lat * Math.PI / 180) * Math.cos(loc2.lat * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(2); // km
}

// ── Start Server ─────────────────────────────────────────
httpServer.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           🌊 AquaGo Real-Time Server v4.0                 ║');
    console.log('║              Socket.IO + Node.js                          ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  🌐 Local:     http://localhost:${PORT}                    ║`);
    console.log(`║  📡 Port:       ${PORT}                                    ║`);
    console.log('║                                                            ║');
    console.log('║  Socket Events:                                            ║');
    console.log('║    • auth           - Login                               ║');
    console.log('║    • create_order   - Mijoz buyurtma beradi               ║');
    console.log('║    • accept_order   - Suvchi buyurtma oladi               ║');
    console.log('║    • new_order      - Suvchiga yangi buyurtma             ║');
    console.log('║    • order_accepted - Mijozga tasdiqlash                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
});

module.exports = { io, orders, activeDrivers };
