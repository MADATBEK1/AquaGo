/**
 * AquaGo – Database Module
 * Uses lowdb for persistent JSON-based database
 */

const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, '.aquago-db.json');

// ── Initialize Database ──────────────────────────────────────
const adapter = new JSONFile(DB_FILE);
const db = new Low(adapter, {
    orders: [],
    users: [],
    messages: [],
    driverLocations: {}
});

// ── Demo Users ───────────────────────────────────────────────
const DEMO_USERS = [
    { id: 'driver-demo', name: 'Alisher Suvchi', phone: '+998901234567', password: '123456', vehicle: '01 A 777 BC', role: 'driver', createdAt: Date.now(), todayEarnings: 0, completedCount: 0 },
    { id: 'user-demo', name: 'Bobur Abdullayev', phone: '+998907654321', password: '123456', role: 'user', createdAt: Date.now() }
];

async function initDatabase() {
    await db.read();
    
    // Initialize demo users if not exists
    if (!db.data.users || db.data.users.length === 0) {
        db.data.users = DEMO_USERS;
        await db.write();
        console.log('[Database] Demo users initialized');
    }
    
    // Ensure all demo users exist
    for (const demo of DEMO_USERS) {
        if (!db.data.users.find(u => u.id === demo.id)) {
            db.data.users.push(demo);
            await db.write();
            console.log('[Database] Added demo user:', demo.id);
        }
    }
    
    console.log('[Database] Initialized successfully');
}

// ── Orders Operations ─────────────────────────────────────────
async function getOrders() {
    await db.read();
    return db.data.orders || [];
}

async function getOrderById(id) {
    await db.read();
    return (db.data.orders || []).find(o => o.id === id);
}

async function createOrder(order) {
    await db.read();
    if (!db.data.orders) db.data.orders = [];
    
    // Ensure order has required fields
    if (!order.status) order.status = 'pending';
    if (!order.createdAt) order.createdAt = Date.now();
    
    // Check if order already exists
    const exists = db.data.orders.find(o => o.id === order.id);
    if (exists) {
        console.log('[Database] Order already exists:', order.id);
        return exists;
    }
    
    // Add new order to beginning of array
    db.data.orders.unshift(order);
    await db.write();
    console.log('[Database] Order created:', order.id, 'Total orders:', db.data.orders.length);
    return order;
}

async function updateOrder(id, updates) {
    await db.read();
    if (!db.data.orders) db.data.orders = [];
    
    const index = db.data.orders.findIndex(o => o.id === id);
    if (index === -1) {
        console.log('[Database] Order not found:', id);
        return null;
    }
    
    db.data.orders[index] = { ...db.data.orders[index], ...updates };
    await db.write();
    console.log('[Database] Order updated:', id);
    return db.data.orders[index];
}

async function deleteOrder(id) {
    await db.read();
    if (!db.data.orders) db.data.orders = [];
    
    const index = db.data.orders.findIndex(o => o.id === id);
    if (index === -1) return null;
    
    const deleted = db.data.orders.splice(index, 1)[0];
    await db.write();
    console.log('[Database] Order deleted:', id);
    return deleted;
}

async function getPendingOrders() {
    await db.read();
    return (db.data.orders || []).filter(o => o.status === 'pending');
}

// ── Users Operations ──────────────────────────────────────────
async function getUsers() {
    await db.read();
    return db.data.users || [];
}

async function getUserById(id) {
    await db.read();
    return (db.data.users || []).find(u => u.id === id);
}

async function getUserByPhone(phone) {
    await db.read();
    return (db.data.users || []).find(u => u.phone === phone);
}

async function createUser(user) {
    await db.read();
    if (!db.data.users) db.data.users = [];
    
    const exists = db.data.users.find(u => u.id === user.id);
    if (exists) {
        console.log('[Database] User already exists:', user.id);
        return exists;
    }
    
    if (!user.createdAt) user.createdAt = Date.now();
    db.data.users.push(user);
    await db.write();
    console.log('[Database] User created:', user.id);
    return user;
}

async function updateUser(id, updates) {
    await db.read();
    if (!db.data.users) db.data.users = [];
    
    const index = db.data.users.findIndex(u => u.id === id);
    if (index === -1) return null;
    
    db.data.users[index] = { ...db.data.users[index], ...updates };
    await db.write();
    console.log('[Database] User updated:', id);
    return db.data.users[index];
}

// ── Messages Operations ───────────────────────────────────────
async function getMessages() {
    await db.read();
    return (db.data.messages || []).slice(-200); // Last 200 messages
}

async function createMessage(message) {
    await db.read();
    if (!db.data.messages) db.data.messages = [];
    
    if (!message.ts) message.ts = Date.now();
    db.data.messages.push(message);
    
    // Keep only last 200 messages
    if (db.data.messages.length > 200) {
        db.data.messages = db.data.messages.slice(-200);
    }
    
    await db.write();
    console.log('[Database] Message created:', message.id || 'no-id');
    return message;
}

// ── Driver Locations ─────────────────────────────────────────
async function getDriverLocations() {
    await db.read();
    return db.data.driverLocations || {};
}

async function updateDriverLocation(driverId, location) {
    await db.read();
    if (!db.data.driverLocations) db.data.driverLocations = {};
    
    db.data.driverLocations[driverId] = {
        ...location,
        ts: Date.now()
    };
    await db.write();
    return db.data.driverLocations[driverId];
}

// ── Export All Functions ─────────────────────────────────────
module.exports = {
    initDatabase,
    // Orders
    getOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    getPendingOrders,
    // Users
    getUsers,
    getUserById,
    getUserByPhone,
    createUser,
    updateUser,
    // Messages
    getMessages,
    createMessage,
    // Driver Locations
    getDriverLocations,
    updateDriverLocation
};
