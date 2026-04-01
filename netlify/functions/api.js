/**
 * AquaGo – Netlify Serverless Function
 * Barcha API endpointlarni bitta serverless functionda boshqaradi
 * Ma'lumotlar localStorage (client-side) orqali saqlanadi
 * SSE o'rniga polling ishlatiladi (serverless cheklovi)
 */

// In-memory store (har bir function invocation uchun yangilanadi)
// Netlify serverless da persistent storage yo'q, shuning uchun
// client-side localStorage asosiy storage bo'lib qoladi
let memOrders = [];
let memUsers = [];
let memMessages = [];
let driverLocs = {};

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event, context) => {
  const { httpMethod, path, body } = event;
  
  // CORS preflight
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // Parse path - remove /api/ or /.netlify/functions/api/ prefix
  let route = path
    .replace(/^\/?\.netlify\/functions\/api/, '')
    .replace(/^\/?api/, '')
    .replace(/^\//, '');

  const parsedBody = body ? (() => { try { return JSON.parse(body); } catch { return {}; } })() : {};

  // ── TUNNEL URL (compatibility) ──
  if (route === 'tunnel-url' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: null }),
    };
  }

  // ── DRIVER LOCATION ──
  if (route === 'driver-location' && httpMethod === 'POST') {
    const { driverId, lat, lng, heading } = parsedBody;
    if (driverId) {
      driverLocs[driverId] = { lat, lng, heading, ts: Date.now() };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  if (route === 'driver-location' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(driverLocs),
    };
  }

  // ── MESSAGES ──
  if (route.startsWith('messages')) {
    const params = event.queryStringParameters || {};
    const orderId = params.orderId;

    if (httpMethod === 'GET') {
      const msgs = orderId
        ? memMessages.filter(m => m.orderId === orderId)
        : memMessages.slice(-50);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(msgs),
      };
    }

    if (httpMethod === 'POST') {
      const msg = parsedBody;
      msg.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      msg.ts = Date.now();
      memMessages.push(msg);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, msg }),
      };
    }
  }

  // ── RATINGS ──
  if (route === 'ratings' && httpMethod === 'POST') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  // ── EVENTS (SSE replacement - polling endpoint) ──
  if (route === 'events') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        orders: memOrders,
        users: memUsers,
        messages: memMessages.slice(-50),
        driverLocations: driverLocs,
      }),
    };
  }

  // ── USERS ──
  if (route === 'users' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(memUsers),
    };
  }

  if (route === 'users' && httpMethod === 'POST') {
    memUsers = parsedBody;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  // ── ORDERS ──
  if (route === 'orders' && httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(memOrders),
    };
  }

  if (route === 'orders' && httpMethod === 'POST') {
    const order = parsedBody;
    if (!memOrders.find(o => o.id === order.id)) {
      memOrders.unshift(order);
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, order }),
    };
  }

  if (route === 'orders' && httpMethod === 'PUT') {
    if (Array.isArray(parsedBody)) {
      memOrders = parsedBody;
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  // PATCH /orders/:id
  const orderMatch = route.match(/^orders\/([^/]+)$/);
  if (orderMatch && (httpMethod === 'PATCH' || httpMethod === 'PUT')) {
    const id = orderMatch[1];
    const i = memOrders.findIndex(o => o.id === id);
    if (i >= 0) {
      memOrders[i] = { ...memOrders[i], ...parsedBody };
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, order: memOrders[i] }),
      };
    }
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Order not found' }),
    };
  }

  // ── 404 ──
  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not found', route }),
  };
};
