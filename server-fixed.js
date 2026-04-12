/**
 * AquaGo - TO'LIQ ISHLAYDIGAN Real-Time Server
 * 
 * MUAMMO TUZATILDI: Driver socket to'g'ridan-to'g'ri saqlanadi
 * va emit qilinadi
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 7878;
const ROOT = __dirname;

// =============================================================================
// GLOBAL STATE - Barcha connectionlar shu yerda saqlanadi
// =============================================================================

const drivers = new Map();     // socketId -> { userId, name, socket, location }
const customers = new Map();   // socketId -> { userId, name, socket }
const orders = [];             // barcha buyurtmalar
let orderCounter = 1;

// =============================================================================
// HTTP SERVER (Static fayllar uchun)
// =============================================================================

const httpServer = http.createServer((req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(ROOT, url.split('?')[0]);
    const ext = path.extname(filePath).slice(1) || 'html';
    
    const mime = {
        html: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', png: 'image/png', jpg: 'image/jpeg'
    };
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found: ' + url);
            return;
        }
        res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
        res.end(data);
    });
});

// =============================================================================
// SOCKET.IO - Real-time communication
// =============================================================================

const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'] // WebSocket + fallback
});

console.log('[SYSTEM] AquaGo Real-Time Server starting...\n');

io.on('connection', (socket) => {
    console.log('[CONNECT] New socket: ' + socket.id);
    
    // =========================================================================
    // 1. AUTHENTICATION - Login
    // =========================================================================
    socket.on('auth', (data) => {
        const { userId, role, name } = data;
        
        if (!userId || !role) {
            socket.emit('auth_error', 'userId and role required');
            return;
        }
        
        // Socketga ma'lumotlarni biriktirish
        socket.userId = userId;
        socket.role = role;
        socket.userName = name || 'Unknown';
        
        // ====================================================================
        // 🔧 MUAMMO TUZATISH #1: Driver socket to'g'ridan-to'g'ri saqlanadi
        // ====================================================================
        if (role === 'driver') {
            // ✅ TO'G'RI: Socket instance to'g'ridan-to'g'ri saqlanadi
            drivers.set(socket.id, {
                userId: userId,
                name: name,
                socket: socket,  // ← BU MUHUM! Socket instance saqlanadi
                location: null,
                isOnline: true
            });
            
            console.log('[DRIVER ONLINE] ' + name + ' (' + userId + ')');
            console.log('[STATS] Total drivers: ' + drivers.size);
            
            socket.emit('auth_success', {
                userId: userId,
                role: 'driver',
                message: 'Connected as driver',
                activeDrivers: drivers.size
            });
            
            // Boshqalarga xabar
            socket.broadcast.emit('driver_online', {
                userId: userId,
                name: name,
                totalDrivers: drivers.size
            });
            
        } else {
            // Mijoz
            customers.set(socket.id, {
                userId: userId,
                name: name,
                socket: socket
            });
            
            console.log('[CUSTOMER ONLINE] ' + name + ' (' + userId + ')');
            
            socket.emit('auth_success', {
                userId: userId,
                role: 'user',
                message: 'Connected as customer',
                activeDrivers: drivers.size
            });
        }
    });
    
    // =========================================================================
    // 2. DRIVER LOCATION - Joylashuv yangilash
    // =========================================================================
    socket.on('update_location', (data) => {
        if (socket.role !== 'driver') {
            console.log('[WARN] Non-driver tried to update location');
            return;
        }
        
        const driver = drivers.get(socket.id);
        if (driver) {
            driver.location = {
                lat: parseFloat(data.lat),
                lng: parseFloat(data.lng),
                updatedAt: Date.now()
            };
            
            console.log('[LOCATION] ' + driver.name + ': ' + 
                        driver.location.lat.toFixed(4) + ', ' + 
                        driver.location.lng.toFixed(4));
        }
    });
    
    // =========================================================================
    // 3. CREATE ORDER - Mijoz buyurtma beradi
    // =========================================================================
    socket.on('create_order', (data) => {
        console.log('\n[ORDER REQUEST] From: ' + socket.id);
        console.log('[ORDER DATA] ' + JSON.stringify(data));
        
        // Tekshirish: mijozmi?
        if (socket.role !== 'user') {
            console.log('[ERROR] Not a customer. Role: ' + socket.role);
            socket.emit('order_error', 'Only customers can create orders');
            return;
        }
        
        const { location, waterAmount, address } = data;
        
        if (!location || !location.lat || !location.lng) {
            socket.emit('order_error', 'Location coordinates required');
            return;
        }
        
        // Buyurtma yaratish
        const newOrder = {
            id: 'ORDER-' + String(orderCounter++).padStart(4, '0'),
            customerId: socket.userId,
            customerName: socket.userName,
            customerSocketId: socket.id,
            location: {
                lat: parseFloat(location.lat),
                lng: parseFloat(location.lng)
            },
            waterAmount: parseInt(waterAmount) || 1,
            address: address || 'No address provided',
            status: 'pending',
            createdAt: Date.now(),
            driverId: null,
            driverName: null
        };
        
        orders.push(newOrder);
        
        console.log('[ORDER CREATED] ID: ' + newOrder.id);
        console.log('[ORDER INFO] Customer: ' + newOrder.customerName);
        console.log('[ORDER INFO] Water: ' + newOrder.waterAmount);
        console.log('[ORDER INFO] Location: ' + newOrder.location.lat + ', ' + newOrder.location.lng);
        console.log('[STATS] Active drivers: ' + drivers.size);
        
        // Mijozga tasdiqlash
        socket.emit('order_created', {
            orderId: newOrder.id,
            status: 'pending',
            message: 'Order received! Looking for drivers...',
            timestamp: newOrder.createdAt,
            activeDrivers: drivers.size
        });
        
        // =================================================================
        // 🔧 MUAMMO TUZATISH #2: Driverga to'g'ridan-to'g'ri emit
        // =================================================================
        
        if (drivers.size === 0) {
            console.log('[WARN] No active drivers available!');
            socket.emit('no_drivers', {
                message: 'No active drivers. Please try again later.'
            });
            return;
        }
        
        let sentCount = 0;
        
        // ✅ TO'G'RI: Map orqali iterate qilish va to'g'ridan-to'g'ri emit
        drivers.forEach((driver, driverSocketId) => {
            try {
                // Masofani hisoblash
                let distance = null;
                if (driver.location && newOrder.location) {
                    distance = calculateDistance(
                        driver.location.lat, driver.location.lng,
                        newOrder.location.lat, newOrder.location.lng
                    );
                }
                
                // 🔥 ASOSIY YECHIM: driver.socket to'g'ridan-to'g'ri emit!
                driver.socket.emit('new_order', {
                    orderId: newOrder.id,
                    customerId: newOrder.customerId,
                    customerName: newOrder.customerName,
                    location: newOrder.location,
                    address: newOrder.address,
                    waterAmount: newOrder.waterAmount,
                    distance: distance ? distance + ' km' : 'Unknown',
                    createdAt: newOrder.createdAt
                });
                
                sentCount++;
                console.log('[SENT TO DRIVER] ' + driver.name + 
                           ' (distance: ' + (distance || 'unknown') + ')');
                
            } catch (err) {
                console.log('[ERROR] Failed to send to driver ' + driver.name + ': ' + err.message);
            }
        });
        
        console.log('[SENT TOTAL] ' + sentCount + ' drivers\n');
    });
    
    // =========================================================================
    // 4. ACCEPT ORDER - Driver buyurtma oladi
    // =========================================================================
    socket.on('accept_order', (data) => {
        const { orderId } = data;
        
        console.log('\n[ACCEPT REQUEST] Driver ' + socket.userName + 
                    ' wants order ' + orderId);
        
        if (socket.role !== 'driver') {
            socket.emit('accept_error', 'Only drivers can accept orders');
            return;
        }
        
        const order = orders.find(o => o.id === orderId);
        if (!order) {
            socket.emit('accept_error', 'Order not found');
            return;
        }
        
        if (order.status !== 'pending') {
            socket.emit('accept_error', 'Order already ' + order.status);
            return;
        }
        
        // Buyurtmani yangilash
        order.status = 'accepted';
        order.driverId = socket.userId;
        order.driverName = socket.userName;
        order.acceptedAt = Date.now();
        
        console.log('[ACCEPTED] Order: ' + orderId);
        console.log('[ACCEPTED] Driver: ' + socket.userName);
        console.log('[ACCEPTED] Customer: ' + order.customerName);
        
        // Driverga tasdiqlash
        socket.emit('order_accepted_success', {
            orderId: order.id,
            customerName: order.customerName,
            location: order.location,
            address: order.address,
            waterAmount: order.waterAmount,
            message: 'You accepted the order!'
        });
        
        // =================================================================
        // 🔧 MUAMMO TUZATISH #3: Mijozga xabar yetkazish
        // =================================================================
        const customer = customers.get(order.customerSocketId);
        if (customer && customer.socket) {
            customer.socket.emit('order_accepted', {
                orderId: order.id,
                driverId: socket.userId,
                driverName: socket.userName,
                message: socket.userName + ' accepted your order!',
                eta: '15 minutes'
            });
            console.log('[NOTIFIED CUSTOMER] ' + order.customerName);
        } else {
            console.log('[WARN] Customer offline: ' + order.customerName);
        }
        
        // Boshqa driverlarga xabar
        socket.broadcast.emit('order_taken', {
            orderId: order.id,
            driverName: socket.userName
        });
    });
    
    // =========================================================================
    // 5. DISCONNECT - Ulanish uzilganda
    // =========================================================================
    socket.on('disconnect', (reason) => {
        console.log('[DISCONNECT] ' + socket.id + ' reason: ' + reason);
        
        // Driver o'chirildi
        if (drivers.has(socket.id)) {
            const driver = drivers.get(socket.id);
            drivers.delete(socket.id);
            
            console.log('[DRIVER OFFLINE] ' + driver.name);
            console.log('[STATS] Remaining drivers: ' + drivers.size);
            
            // Barchaga xabar
            io.emit('driver_offline', {
                userId: driver.userId,
                name: driver.name,
                totalDrivers: drivers.size
            });
        }
        
        // Mijoz o'chirildi
        if (customers.has(socket.id)) {
            customers.delete(socket.id);
        }
    });
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Yer radiusi km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(2);
}

// =============================================================================
// SERVER START
// =============================================================================

httpServer.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║     🌊 AquaGo Real-Time Server (FIXED) v6.0              ║');
    console.log('║          FULLY WORKING SOLUTION                          ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  🌐 URL: http://localhost:' + PORT + '                        ║');
    console.log('║  📡 Port: ' + PORT + '                                         ║');
    console.log('║                                                           ║');
    console.log('║  Test Pages:                                              ║');
    console.log('║    • Customer: http://localhost:' + PORT + '/simple-customer.html ║');
    console.log('║    • Driver:   http://localhost:' + PORT + '/simple-driver.html   ║');
    console.log('║                                                           ║');
    console.log('║  Key Events:                                              ║');
    console.log('║    • auth → auth_success                                  ║');
    console.log('║    • create_order → new_order (to ALL drivers)           ║');
    console.log('║    • accept_order → order_accepted (to customer)         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
});
