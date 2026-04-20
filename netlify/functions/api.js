/**
 * AquaGo – Netlify Serverless Function v3 (Supabase)
 * Persistent storage via Supabase PostgreSQL
 * Ma'lumotlar doimiy saqlanadi, kompyuter o'chiq bo'lsa ham ishlaydi!
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// ── Supabase REST API helper ──────────────────────────────
const sb = {
  h: () => ({
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }),

  async get(table, query = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      headers: this.h(),
    });
    if (!res.ok) return [];
    return res.json();
  },

  async post(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.h(),
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async upsert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        ...this.h(),
        'Prefer': 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async patch(table, query, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method: 'PATCH',
      headers: this.h(),
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  },

  async delete(table, query) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
      method: 'DELETE',
      headers: { ...this.h(), 'Prefer': 'return=minimal' },
    });
    return res.ok;
  },
};

// ── Demo foydalanuvchilar ─────────────────────────────────
const DEMO_USERS = [
  {
    id: 'driver-demo', name: 'Alisher Suvchi', phone: '+998901234567',
    password: '123456', vehicle: '01 A 777 BC', role: 'driver',
    createdAt: 1700000000000, todayEarnings: 0, completedCount: 0
  },
  {
    id: 'user-demo', name: 'Bobur Abdullayev', phone: '+998907654321',
    password: '123456', role: 'user', createdAt: 1700000000000
  }
];

async function ensureDemoUsers() {
  for (const demo of DEMO_USERS) {
    await sb.upsert('users', { id: demo.id, data: demo });
  }
}

// ── Main handler ──────────────────────────────────────────
exports.handler = async (event) => {
  const { httpMethod, path, body: rawBody } = event;

  // CORS preflight
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  const parsedBody = rawBody
    ? (() => { try { return JSON.parse(rawBody); } catch { return {}; } })()
    : {};

  // Parse route
  let route = path
    .replace(/^\/?\.netlify\/functions\/api/, '')
    .replace(/^\/?api/, '')
    .replace(/^\//, '');

  try {
    // Supabase mavjudligini tekshirish
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.warn('[AquaGo] Supabase sozlanmagan – bo\'sh javob qaytarilmoqda');
      // 503 o'rniga bo'sh massiv – frontend ishlashda davom etadi
      if (route === 'orders' && httpMethod === 'GET') {
        return { statusCode: 200, headers: corsHeaders, body: '[]' };
      }
      if (route === 'users' && httpMethod === 'GET') {
        return { statusCode: 200, headers: corsHeaders, body: '[]' };
      }
      if (route === 'events') {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ orders: [], users: [], messages: [], driverLocations: {} }) };
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    // ── TUNNEL URL ──
    if (route === 'tunnel-url' && httpMethod === 'GET') {
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ url: null }) };
    }

    // ── DRIVER LOCATION ──
    if (route === 'driver-location') {
      if (httpMethod === 'POST') {
        const { driverId, lat, lng, heading } = parsedBody;
        if (driverId) {
          await sb.upsert('driver_locations', {
            driver_id: driverId, lat, lng, heading,
            updated_at: new Date().toISOString()
          });
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
      }
      if (httpMethod === 'GET') {
        const rows = await sb.get('driver_locations');
        const result = {};
        if (Array.isArray(rows)) {
          for (const loc of rows) {
            result[loc.driver_id] = {
              lat: loc.lat, lng: loc.lng, heading: loc.heading,
              ts: new Date(loc.updated_at).getTime()
            };
          }
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
      }
    }

    // ── MESSAGES ──
    if (route.startsWith('messages')) {
      const params = event.queryStringParameters || {};
      const orderId = params.orderId;

      if (httpMethod === 'GET') {
        let query = '?order=created_at.asc&limit=50';
        const rows = await sb.get('messages', query);
        let msgs = Array.isArray(rows) ? rows.map(r => r.data) : [];
        if (orderId) msgs = msgs.filter(m => m.orderId === orderId);
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(msgs) };
      }

      if (httpMethod === 'POST') {
        const msg = { ...parsedBody };
        msg.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        msg.ts = Date.now();
        await sb.post('messages', { id: msg.id, data: msg });
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, msg }) };
      }
    }

    // ── RATINGS ──
    if (route === 'ratings' && httpMethod === 'POST') {
      const rating = parsedBody;
      if (rating.orderId) {
        const rows = await sb.get('orders', `?id=eq.${rating.orderId}`);
        if (Array.isArray(rows) && rows.length > 0) {
          const order = { ...rows[0].data, rating };
          await sb.patch('orders', `?id=eq.${rating.orderId}`, { data: order });
        }
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
    }

    // ── EVENTS (polling snapshot – SSE o'rniga) ──
    if (route === 'events') {
      await ensureDemoUsers();
      const [ordersRows, usersRows, msgsRows, locsRows] = await Promise.all([
        sb.get('orders', '?order=created_at.desc'),
        sb.get('users'),
        sb.get('messages', '?order=created_at.asc&limit=50'),
        sb.get('driver_locations'),
      ]);

      const orders = Array.isArray(ordersRows) ? ordersRows.map(r => r.data) : [];
      const users = Array.isArray(usersRows) ? usersRows.map(r => r.data) : [];
      const messages = Array.isArray(msgsRows) ? msgsRows.map(r => r.data) : [];
      const driverLocations = {};
      if (Array.isArray(locsRows)) {
        for (const loc of locsRows) {
          driverLocations[loc.driver_id] = {
            lat: loc.lat, lng: loc.lng, heading: loc.heading,
            ts: new Date(loc.updated_at).getTime()
          };
        }
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ orders, users, messages, driverLocations }),
      };
    }

    // ── USERS ──
    if (route === 'users') {
      if (httpMethod === 'GET') {
        await ensureDemoUsers();
        const rows = await sb.get('users');
        const users = Array.isArray(rows) ? rows.map(r => r.data) : [];
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(users) };
      }

      if (httpMethod === 'POST') {
        const newUsers = Array.isArray(parsedBody) ? parsedBody : [];
        // Upsert (yangi qo'shadi, mavjudini yangilaydi)
        for (const u of newUsers) {
          if (u.id) await sb.upsert('users', { id: u.id, data: u });
        }
        // Demo accountlarni ta'minlash
        await ensureDemoUsers();
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
      }
    }

    // ── ORDERS ──
    if (route === 'orders') {
      if (httpMethod === 'GET') {
        const rows = await sb.get('orders', '?order=created_at.desc');
        const orders = Array.isArray(rows) ? rows.map(r => r.data) : [];
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(orders) };
      }

      if (httpMethod === 'POST') {
        const order = parsedBody;
        if (order.id) {
          await sb.upsert('orders', { id: order.id, data: order });
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, order }) };
      }

      if (httpMethod === 'PUT') {
        // To'liq almashtirish
        const newOrders = Array.isArray(parsedBody) ? parsedBody : [];
        // Avval hammasini o'chirish
        await sb.delete('orders', '?id=neq.PLACEHOLDER_DELETE_ALL');
        // Yangilarini qo'shish
        for (const o of newOrders) {
          if (o.id) await sb.upsert('orders', { id: o.id, data: o });
        }
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
      }
    }

    // ── PATCH /orders/:id ──
    const orderMatch = route.match(/^orders\/([^/]+)$/);
    if (orderMatch && (httpMethod === 'PATCH' || httpMethod === 'PUT')) {
      const id = orderMatch[1];
      const rows = await sb.get('orders', `?id=eq.${id}`);
      if (Array.isArray(rows) && rows.length > 0) {
        const updatedOrder = { ...rows[0].data, ...parsedBody };
        await sb.patch('orders', `?id=eq.${id}`, { data: updatedOrder });
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: true, order: updatedOrder }),
        };
      }
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // ── 404 ──
    return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Not found', route }) };

  } catch (err) {
    console.error('[AquaGo API Error]', err.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server xatosi: ' + err.message }),
    };
  }
};
