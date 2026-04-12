/**
 * AquaGo - To'liq ishlaydigan Real-Time Server
 * Socket.IO bilan buyurtma tizimi
 * 
 * MUAMMOLAR YECHIMI:
 * 1. Har bir socket alohida auth qilish kerak
 * 2. Driverlar ro'yxati global saqlanishi kerak
 * 3. Emit va on eventlar to'g'ri nomlanishi kerak
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = 7474;
const ROOT = __dirname;

// ── GLOBAL O'ZGARUVCHILAR ─────────────────────────────────
let drivers = new Map();    // socketId -> { userId, name, socket, location }
let customers = new Map();  // socketId -> { userId, name, socket }
let orders = [];            // barcha buyurtmalar
let orderId = 1;

// ── HTTP SERVER (static files) ─────────────────────────
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

// ── SOCKET.IO ─────────────────────────────────────────────
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

console.log('🚀 Starting AquaGo Real-Time Server...\n');

io.on('connection', (socket) => {
    console.log(`🔗 [${socket.id}] Yangi ulanish`);
    
    // ── 1. AUTHENTICATION ────────────────────────────────
    socket.on('auth', (data) => {
        const { userId, role, name } = data;
        
        if (!userId || !role) {
            socket.emit('auth_error', 'userId va role kiritilishi shart');
            return;
        }
        
        // Socketga ma'lumotlarni saqlash
        socket.userId = userId;
        socket.role = role;
        socket.userName = name;
        
        if (role === 'driver') {
            // Driverni ro'yxatga qo'shish
            drivers.set(socket.id, {
                userId,
                name,
                socket: socket,
                location: null
            });
            console.log(`✅ [${socket.id}] DRIVER online: ${name} (${userId})`);
            console.log(`📊 Jami driverlar: ${drivers.size} ta\n`);
            
            // Driverga tasdiqlash
            socket.emit('auth_success', {
                userId,
                role: 'driver',
                message: 'Suvchi sifatida ulandingiz'
            });
            
            // Barcha mijozlarga yangi driver online xabari
            socket.broadcast.emit('driver_online', {
                userId,
                name,
                totalDrivers: drivers.size
            });
            
        } else if (role === 'user' || role === 'customer') {
            // Mijozni ro'yxatga qo'shish
            customers.set(socket.id, {
                userId,
                name,
                socket: socket
            });
            console.log(`✅ [${socket.id}] CUSTOMER online: ${name} (${userId})`);
            
            socket.emit('auth_success', {
                userId,
                role: 'user',
                message: 'Mijoz sifatida ulandingiz',
                activeDrivers: drivers.size
            });
        }
    });
    
    // ── 2. DRIVER LOCATION ─────────────────────────────
    socket.on('update_location', (data) => {
        if (socket.role !== 'driver') return;
        
        const driver = drivers.get(socket.id);
        if (driver) {
            driver.location = {
                lat: data.lat,
                lng: data.lng,
                updatedAt: Date.now()
            };
            console.log(`📍 [${socket.id}] ${socket.userName} joylashuvi: ${data.lat.toFixed(4)}, ${data.lng.toFixed(4)}`);
        }
    });
    
    // ── 3. CREATE ORDER (Mijoz) ─────────────────────────
    socket.on('create_order', (data) => {
        console.log(`\n📦 [${socket.id}] BUYURTMA KELDI`);
        console.log('   Data:', JSON.stringify(data, null, 2));
        
        // Tekshirish: mijozmi?
        if (socket.role !== 'user' && socket.role !== 'customer') {
            console.log(`❌ [${socket.id}] Role xato: ${socket.role}`);
            socket.emit('order_error', 'Faqat mijoz buyurtma berishi mumkin');
            return;
        }
        
        const { location, waterAmount, address } = data;
        
        if (!location || !location.lat || !location.lng) {
            socket.emit('order_error', 'Manzil koordinatalari kiritilishi shart');
            return;
        }
        
        // Buyurtma yaratish
        const newOrder = {
            id: `ORDER-${orderId++}`,
            customerId: socket.userId,
            customerName: socket.userName,
            customerSocketId: socket.id,
            location: location,
            waterAmount: waterAmount || 1,
            address: address || 'Manzil koorsatilmagan',
            status: 'pending',
            createdAt: Date.now(),
            driverId: null,
            driverName: null
        };
        
        orders.push(newOrder);
        
        console.log(`\n✅ BUYURTMA YARATILDI:`);
        console.log(`   ID: ${newOrder.id}`);
        console.log(`   Mijoz: ${newOrder.customerName}`);
        console.log(`   Suv: ${newOrder.waterAmount} dona`);
        console.log(`   Manzil: ${newOrder.location.lat}, ${newOrder.location.lng}`);
        console.log(`   Aktiv driverlar: ${drivers.size} ta\n`);
        
        // Mijozga tasdiqlash
        socket.emit('order_created', {
            orderId: newOrder.id,
            status: 'pending',
            message: 'Buyurtma qabul qilindi. Suvchi qidirilmoqda...',
            timestamp: newOrder.createdAt
        });
        
        // ── ASOSIY QISM: Driverlarga yuborish ──────────────
        if (drivers.size === 0) {
            console.log('⚠️ Aktiv driver yoq!');
            socket.emit('no_drivers', {
                message: 'Hozircha aktiv suvchi yoq. Iltimos keyinroq urinib koring.'
            });
            return;
        }
        
        // Har bir driverga yuborish
        let sentCount = 0;
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
                
                // Driverga buyurtma yuborish
                driver.socket.emit('new_order', {
                    orderId: newOrder.id,
                    customerId: newOrder.customerId,
                    customerName: newOrder.customerName,
                    location: newOrder.location,
                    address: newOrder.address,
                    waterAmount: newOrder.waterAmount,
                    distance: distance,
                    createdAt: newOrder.createdAt
                });
                
                sentCount++;
                console.log(`📤 Driver ${driver.name} ga yuborildi (masofa: ${distance || 'noma'lum'})`);
                
            } catch (err) {
                console.log(`❌ Driver ${driver.name} ga yuborilmadi:`, err.message);
            }
        });
        
        console.log(`\n📊 Jami ${sentCount} ta driverga yuborildi\n`);
    });
    
    // ── 4. ACCEPT ORDER (Driver) ─────────────────────────
    socket.on('accept_order', (data) => {
        const { orderId } = data;
        
        console.log(`\n🤚 [${socket.id}] DRIVER BUYURTMANI OLMOQCHI: ${orderId}`);
        
        // Tekshirish: drivermi?
        if (socket.role !== 'driver') {
            socket.emit('accept_error', 'Faqat driver buyurtma olishi mumkin');
            return;
        }
        
        // Buyurtmani topish
        const order = orders.find(o => o.id === orderId);
        if (!order) {
            socket.emit('accept_error', 'Buyurtma topilmadi');
            return;
        }
        
        if (order.status !== 'pending') {
            socket.emit('accept_error', `Buyurtma allaqachon ${order.status} statusda`);
            return;
        }
        
        // Buyurtmani yangilash
        order.status = 'accepted';
        order.driverId = socket.userId;
        order.driverName = socket.userName;
        order.acceptedAt = Date.now();
        
        console.log(`✅ BUYURTMALANDI: ${orderId}`);
        console.log(`   Driver: ${socket.userName}`);
        console.log(`   Mijoz: ${order.customerName}`);
        
        // Driverga tasdiqlash
        socket.emit('order_accepted_success', {
            orderId: order.id,
            customerName: order.customerName,
            location: order.location,
            waterAmount: order.waterAmount,
            message: 'Buyurtmani qabul qildingiz!'
        });
        
        // Mijozga xabar (agar online bo'lsa)
        const customerSocket = customers.get(order.customerSocketId);
        if (customerSocket && customerSocket.socket) {
            customerSocket.socket.emit('order_accepted', {
                orderId: order.id,
                driverId: socket.userId,
                driverName: socket.userName,
                message: `${socket.userName} buyurtmangizni qabul qildi!`,
                eta: '15 daqiqa'
            });
            console.log(`📤 Mijozga xabar yuborildi`);
        } else {
            console.log(`⚠️ Mijoz offline (socketId: ${order.customerSocketId})`);
        }
        
        // Boshqa driverlarga xabar
        socket.broadcast.emit('order_taken', {
            orderId: order.id,
            driverName: socket.userName,
            message: 'Bu buyurtma allaqachon olingan'
        });
    });
    
    // ── 5. DISCONNECT ────────────────────────────────────
    socket.on('disconnect', (reason) => {
        console.log(`❌ [${socket.id}] Ulanish uzildi: ${reason}`);
        
        // Driver ro'yxatdan o'chirish
        if (drivers.has(socket.id)) {
            const driver = drivers.get(socket.id);
            drivers.delete(socket.id);
            console.log(`🚗 Driver ${driver.name} offline. Qolgan: ${drivers.size} ta`);
            
            // Barchaga xabar
            io.emit('driver_offline', {
                userId: driver.userId,
                totalDrivers: drivers.size
            });
        }
        
        // Mijoz ro'yxatdan o'chirish
        if (customers.has(socket.id)) {
            const customer = customers.get(socket.id);
            customers.delete(socket.id);
            console.log(`👤 Mijoz ${customer.name} offline`);
        }
    });
});

// ── YORDAMCHI FUNKSIYALAR ─────────────────────────────────
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

// ── SERVER ISHGA TUSHIRISH ───────────────────────────────
httpServer.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║          🌊 AquaGo Real-Time Server v5.0                 ║');
    console.log('║              TO‘LIQ ISHLAYDIGAN TIZIM                    ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log(`║  🌐 URL: http://localhost:${PORT}                         ║`);
    console.log(`║  📡 Port: ${PORT}                                          ║`);
    console.log('║                                                           ║');
    console.log('║  🧪 Test sahifalari:                                      ║');
    console.log(`║     • Mijoz:  http://localhost:${PORT}/customer-test.html   ║`);
    console.log(`║     • Driver: http://localhost:${PORT}/driver-test.html     ║`);
    console.log('║                                                           ║');
    console.log('║  📋 Eventlar:                                             ║');
    console.log('║     auth, create_order, accept_order, new_order          ║`);
    console.log('║     order_created, order_accepted, driver_online         ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
});
