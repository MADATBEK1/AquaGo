/**
 * AquaGo – Database Module (Cloud - PostgreSQL)
 * Uses PostgreSQL for cloud deployment
 */

const { Pool } = require('pg');

// ── Database Connection ───────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ── Initialize Database Tables ───────────────────────────────
async function initDatabase() {
    try {
        // Create users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(20) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) NOT NULL,
                vehicle VARCHAR(50),
                createdAt BIGINT NOT NULL,
                todayEarnings DECIMAL(10, 2) DEFAULT 0,
                completedCount INTEGER DEFAULT 0
            )
        `);

        // Create orders table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(255) PRIMARY KEY,
                userId VARCHAR(255),
                userName VARCHAR(255),
                userPhone VARCHAR(20),
                lat DECIMAL(10, 8),
                lng DECIMAL(11, 8),
                address TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                waterType VARCHAR(100),
                paymentType VARCHAR(50),
                quantity INTEGER DEFAULT 1,
                driverId VARCHAR(255),
                driverName VARCHAR(255),
                createdAt BIGINT NOT NULL,
                acceptedAt BIGINT,
                completedAt BIGINT,
                rating JSONB
            )
        `);

        // Create messages table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                orderId VARCHAR(255),
                senderId VARCHAR(255) NOT NULL,
                senderName VARCHAR(255),
                text TEXT NOT NULL,
                ts BIGINT NOT NULL
            )
        `);

        // Create driver_locations table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS driver_locations (
                driver_id VARCHAR(255) PRIMARY KEY,
                lat DECIMAL(10, 8) NOT NULL,
                lng DECIMAL(11, 8) NOT NULL,
                heading DECIMAL(5, 2),
                ts BIGINT NOT NULL
            )
        `);

        // Insert demo users if they don't exist
        const demoUsers = [
            { id: 'driver-demo', name: 'Alisher Suvchi', phone: '+998901234567', password: '123456', vehicle: '01 A 777 BC', role: 'driver', createdAt: Date.now(), todayEarnings: 0, completedCount: 0 },
            { id: 'user-demo', name: 'Bobur Abdullayev', phone: '+998907654321', password: '123456', role: 'user', createdAt: Date.now() }
        ];

        for (const user of demoUsers) {
            const existing = await pool.query('SELECT id FROM users WHERE id = $1', [user.id]);
            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO users (id, name, phone, password, role, vehicle, createdAt, todayEarnings, completedCount)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [user.id, user.name, user.phone, user.password, user.role, user.vehicle, user.createdAt, user.todayEarnings, user.completedCount]);
                console.log('[Database] Demo user added:', user.id);
            }
        }

        console.log('[Database] PostgreSQL initialized successfully');
    } catch (err) {
        console.error('[Database] Initialization error:', err);
        throw err;
    }
}

// ── Orders Operations ─────────────────────────────────────────
async function getOrders() {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY createdAt DESC');
        return result.rows;
    } catch (err) {
        console.error('[Database] getOrders error:', err);
        return [];
    }
}

async function getOrderById(id) {
    try {
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        return result.rows[0] || null;
    } catch (err) {
        console.error('[Database] getOrderById error:', err);
        return null;
    }
}

async function createOrder(order) {
    try {
        // Ensure order has required fields
        if (!order.status) order.status = 'pending';
        if (!order.createdAt) order.createdAt = Date.now();

        const result = await pool.query(`
            INSERT INTO orders (id, userId, userName, userPhone, lat, lng, address, status, waterType, paymentType, quantity, driverId, driverName, createdAt, acceptedAt, completedAt, rating)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            ON CONFLICT (id) DO NOTHING
            RETURNING *
        `, [
            order.id, order.userId, order.userName, order.userPhone,
            order.lat, order.lng, order.address, order.status,
            order.waterType, order.paymentType, order.quantity,
            order.driverId, order.driverName, order.createdAt,
            order.acceptedAt, order.completedAt, JSON.stringify(order.rating)
        ]);

        if (result.rows.length > 0) {
            console.log('[Database] Order created:', order.id);
            return result.rows[0];
        }

        // Order already exists, return existing
        const existing = await pool.query('SELECT * FROM orders WHERE id = $1', [order.id]);
        return existing.rows[0];
    } catch (err) {
        console.error('[Database] createOrder error:', err);
        throw err;
    }
}

async function updateOrder(id, updates) {
    try {
        const fields = [];
        const values = [];
        let paramCount = 1;

        for (const [key, value] of Object.entries(updates)) {
            if (key === 'rating') {
                fields.push(`${key} = $${paramCount}`);
                values.push(JSON.stringify(value));
            } else {
                fields.push(`${key} = $${paramCount}`);
                values.push(value);
            }
            paramCount++;
        }

        values.push(id);
        const query = `UPDATE orders SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        const result = await pool.query(query, values);

        if (result.rows.length > 0) {
            console.log('[Database] Order updated:', id);
            return result.rows[0];
        }
        return null;
    } catch (err) {
        console.error('[Database] updateOrder error:', err);
        throw err;
    }
}

async function deleteOrder(id) {
    try {
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length > 0) {
            console.log('[Database] Order deleted:', id);
            return result.rows[0];
        }
        return null;
    } catch (err) {
        console.error('[Database] deleteOrder error:', err);
        throw err;
    }
}

async function getPendingOrders() {
    try {
        const result = await pool.query("SELECT * FROM orders WHERE status = 'pending' ORDER BY createdAt DESC");
        return result.rows;
    } catch (err) {
        console.error('[Database] getPendingOrders error:', err);
        return [];
    }
}

// ── Users Operations ─────────────────────────────────────────
async function getUsers() {
    try {
        const result = await pool.query('SELECT * FROM users');
        return result.rows;
    } catch (err) {
        console.error('[Database] getUsers error:', err);
        return [];
    }
}

async function getUserById(id) {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0] || null;
    } catch (err) {
        console.error('[Database] getUserById error:', err);
        return null;
    }
}

async function getUserByPhone(phone) {
    try {
        const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
        return result.rows[0] || null;
    } catch (err) {
        console.error('[Database] getUserByPhone error:', err);
        return null;
    }
}

async function createUser(user) {
    try {
        if (!user.createdAt) user.createdAt = Date.now();

        const result = await pool.query(`
            INSERT INTO users (id, name, phone, password, role, vehicle, createdAt, todayEarnings, completedCount)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO NOTHING
            RETURNING *
        `, [user.id, user.name, user.phone, user.password, user.role, user.vehicle, user.createdAt, user.todayEarnings, user.completedCount]);

        if (result.rows.length > 0) {
            console.log('[Database] User created:', user.id);
            return result.rows[0];
        }

        // User already exists, return existing
        const existing = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
        return existing.rows[0];
    } catch (err) {
        console.error('[Database] createUser error:', err);
        throw err;
    }
}

async function updateUser(id, updates) {
    try {
        const fields = [];
        const values = [];
        let paramCount = 1;

        for (const [key, value] of Object.entries(updates)) {
            fields.push(`${key} = $${paramCount}`);
            values.push(value);
            paramCount++;
        }

        values.push(id);
        const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
        const result = await pool.query(query, values);

        if (result.rows.length > 0) {
            console.log('[Database] User updated:', id);
            return result.rows[0];
        }
        return null;
    } catch (err) {
        console.error('[Database] updateUser error:', err);
        throw err;
    }
}

// ── Messages Operations ───────────────────────────────────────
async function getMessages() {
    try {
        const result = await pool.query('SELECT * FROM messages ORDER BY ts DESC LIMIT 200');
        return result.rows;
    } catch (err) {
        console.error('[Database] getMessages error:', err);
        return [];
    }
}

async function createMessage(message) {
    try {
        if (!message.ts) message.ts = Date.now();

        const result = await pool.query(`
            INSERT INTO messages (id, orderId, senderId, senderName, text, ts)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `, [message.id, message.orderId, message.senderId, message.senderName, message.text, message.ts]);

        console.log('[Database] Message created:', message.id);
        return result.rows[0];
    } catch (err) {
        console.error('[Database] createMessage error:', err);
        throw err;
    }
}

// ── Driver Locations ─────────────────────────────────────────
async function getDriverLocations() {
    try {
        const result = await pool.query('SELECT * FROM driver_locations');
        const locs = {};
        for (const row of result.rows) {
            locs[row.driver_id] = {
                lat: row.lat,
                lng: row.lng,
                heading: row.heading,
                ts: row.ts
            };
        }
        return locs;
    } catch (err) {
        console.error('[Database] getDriverLocations error:', err);
        return {};
    }
}

async function updateDriverLocation(driverId, location) {
    try {
        const result = await pool.query(`
            INSERT INTO driver_locations (driver_id, lat, lng, heading, ts)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (driver_id) DO UPDATE SET
                lat = EXCLUDED.lat, lng = EXCLUDED.lng, heading = EXCLUDED.heading, ts = EXCLUDED.ts
            RETURNING *
        `, [driverId, location.lat, location.lng, location.heading, Date.now()]);

        const row = result.rows[0];
        return {
            lat: row.lat,
            lng: row.lng,
            heading: row.heading,
            ts: row.ts
        };
    } catch (err) {
        console.error('[Database] updateDriverLocation error:', err);
        throw err;
    }
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
