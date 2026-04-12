/**
 * AquaGo - To'liq ishlaydigan Real-Time Server
 * MUAMMO: Mijoz buyurtma bersa, driverga yetib bormayapti
 * YECHIM: To'g'ri socket emit/on eventlar
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = 7474;
const ROOT = __dirname;

// Global o'zgaruvchilar
const drivers = new Map();
const customers = new Map();
const orders = [];
let orderCounter = 1;

// HTTP server
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

// Socket.IO
const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
});

console.log('Starting AquaGo Real-Time Server...\n');

io.on('connection', (socket) => {
    console.log('[' + socket.id + '] New connection');
    
    // AUTHENTICATION
    socket.on('auth', (data) => {
        const { userId, role, name } = data;
        
        if (!userId || !role) {
            socket.emit('auth_error', 'userId and role required');
            return;
        }
        
        socket.userId = userId;
        socket.role = role;
        socket.userName = name || 'Unknown';
        
        if (role === 'driver') {
            drivers.set(socket.id, {
                userId: userId,
                name: name,
                socket: socket,
                location: null
            });
            
            console.log('[DRIVER ONLINE] ' + name + ' (' + userId + ')');
            console.log('Total drivers: ' + drivers.size);
            
            socket.emit('auth_success', {
                userId: userId,
                role: 'driver',
                message: 'Connected as driver'
            });
            
            socket.broadcast.emit('driver_online', {
                userId: userId,
                name: name,
                totalDrivers: drivers.size
            });
            
        } else {
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
    
    // DRIVER LOCATION
    socket.on('update_location', (data) => {
        if (socket.role !== 'driver') return;
        
        const driver = drivers.get(socket.id);
        if (driver) {
            driver.location = {
                lat: data.lat,
                lng: data.lng
            };
        }
    });
    
    // CREATE ORDER (Mijoz)
    socket.on('create_order', (data) => {
        console.log('\n[NEW ORDER REQUEST] from ' + socket.id);
        console.log('Data:', JSON.stringify(data));
        
        if (socket.role !== 'user') {
            console.log('[ERROR] Not a customer role: ' + socket.role);
            socket.emit('order_error', 'Only customers can create orders');
            return;
        }
        
        const { location, waterAmount, address } = data;
        
        if (!location || !location.lat || !location.lng) {
            socket.emit('order_error', 'Location coordinates required');
            return;
        }
        
        // Create order
        const newOrder = {
            id: 'ORDER-' + orderCounter++,
            customerId: socket.userId,
            customerName: socket.userName,
            customerSocketId: socket.id,
            location: location,
            waterAmount: waterAmount || 1,
            address: address || 'No address',
            status: 'pending',
            createdAt: Date.now(),
            driverId: null,
            driverName: null
        };
        
        orders.push(newOrder);
        
        console.log('\n[ORDER CREATED]');
        console.log('  ID: ' + newOrder.id);
        console.log('  Customer: ' + newOrder.customerName);
        console.log('  Water: ' + newOrder.waterAmount);
        console.log('  Location: ' + location.lat + ', ' + location.lng);
        console.log('  Active drivers: ' + drivers.size);
        
        // Send confirmation to customer
        socket.emit('order_created', {
            orderId: newOrder.id,
            status: 'pending',
            message: 'Order received. Looking for drivers...',
            timestamp: newOrder.createdAt
        });
        
        // SEND TO ALL DRIVERS
        if (drivers.size === 0) {
            console.log('[WARNING] No active drivers!');
            socket.emit('no_drivers', {
                message: 'No active drivers available'
            });
            return;
        }
        
        let sentCount = 0;
        drivers.forEach((driver, driverSocketId) => {
            try {
                let distance = null;
                if (driver.location) {
                    distance = calculateDistance(
                        driver.location.lat, driver.location.lng,
                        newOrder.location.lat, newOrder.location.lng
                    );
                }
                
                // IMPORTANT: Emit to driver
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
                console.log('[SENT TO DRIVER] ' + driver.name + ' (distance: ' + (distance || 'unknown') + ')');
                
            } catch (err) {
                console.log('[ERROR] Failed to send to driver: ' + err.message);
            }
        });
        
        console.log('[SENT TO] ' + sentCount + ' drivers\n');
    });
    
    // ACCEPT ORDER (Driver)
    socket.on('accept_order', (data) => {
        const { orderId } = data;
        
        console.log('\n[ACCEPT REQUEST] Driver ' + socket.id + ' wants order ' + orderId);
        
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
        
        // Update order
        order.status = 'accepted';
        order.driverId = socket.userId;
        order.driverName = socket.userName;
        order.acceptedAt = Date.now();
        
        console.log('[ACCEPTED] Order ' + orderId);
        console.log('  Driver: ' + socket.userName);
        console.log('  Customer: ' + order.customerName);
        
        // Send to driver
        socket.emit('order_accepted_success', {
            orderId: order.id,
            customerName: order.customerName,
            location: order.location,
            waterAmount: order.waterAmount,
            message: 'You accepted the order!'
        });
        
        // Send to customer
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
            console.log('[WARNING] Customer offline');
        }
        
        // Notify other drivers
        socket.broadcast.emit('order_taken', {
            orderId: order.id,
            driverName: socket.userName
        });
    });
    
    // DISCONNECT
    socket.on('disconnect', (reason) => {
        console.log('[' + socket.id + '] Disconnected: ' + reason);
        
        if (drivers.has(socket.id)) {
            const driver = drivers.get(socket.id);
            drivers.delete(socket.id);
            console.log('[DRIVER OFFLINE] ' + driver.name + '. Remaining: ' + drivers.size);
            
            io.emit('driver_offline', {
                userId: driver.userId,
                totalDrivers: drivers.size
            });
        }
        
        if (customers.has(socket.id)) {
            customers.delete(socket.id);
        }
    });
});

// Calculate distance
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return (R * c).toFixed(2);
}

// Start server
httpServer.listen(PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║          AQUAGO REAL-TIME SERVER v5.0                    ║');
    console.log('╠═══════════════════════════════════════════════════════════╣');
    console.log('║  URL: http://localhost:' + PORT + '                        ║');
    console.log('║  Port: ' + PORT + '                                         ║');
    console.log('║                                                           ║');
    console.log('║  Test pages:                                              ║');
    console.log('║    Customer: http://localhost:' + PORT + '/customer-test.html ║');
    console.log('║    Driver:   http://localhost:' + PORT + '/driver-test.html   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
});
