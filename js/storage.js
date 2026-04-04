/* ===================================================
   AquaGo – Storage v3
   Auto-detect server → real-time cross-device sync
   Fallback → localStorage (offline / same-device)
   =================================================== */

const AQUAGO_PORT = 7474;

// ── Demo accounts – always available ─────────────────────
const DEMO_USERS = [
  {
    id: 'driver-demo', name: 'Alisher Suvchi', phone: '+998901234567',
    password: '123456', vehicle: '01 A 777 BC', role: 'driver',
    createdAt: Date.now(), todayEarnings: 0, completedCount: 0
  },
  {
    id: 'user-demo', name: 'Bobur Abdullayev', phone: '+998907654321',
    password: '123456', role: 'user', createdAt: Date.now()
  }
];

/** Ensure demo accounts always exist in a users array */
function _ensureDemoUsers(users) {
  const result = Array.isArray(users) ? [...users] : [];
  for (const demo of DEMO_USERS) {
    const exists = result.find(u => u.id === demo.id);
    if (!exists) {
      result.push(demo);
    }
  }
  return result;
}

// ── Server URL detection ─────────────────────────────────
const API_BASE = (() => {
  if (location.protocol !== 'file:') {
    // Agar capacitor localhost bo'lsa
    if (location.hostname === 'localhost' && !location.port) {
      return `https://web-production-12311.up.railway.app`;
    }
    // Netlify yoki boshqa host – o'zining origin'idan foydalanadi
    return location.origin;
  }
  return null; // file:// mode – auto-detect
})();

let _resolvedBase = API_BASE;   // may be updated after auto-detect
let _online = false;            // is server reachable?
let _sse = null;                // EventSource

// ── Try to connect to server (for file:// mode) ──────────
async function _detectServer() {
  if (_resolvedBase) { await _testAndConnect(_resolvedBase); return; }

  // Try localhost first, then common LAN IPs
  const candidates = [
    `https://web-production-12311.up.railway.app`,
    `http://localhost:${AQUAGO_PORT}`,
    `http://127.0.0.1:${AQUAGO_PORT}`,
  ];

  // Try to guess LAN IP from previous session
  const savedIP = localStorage.getItem('aquago_server_ip');
  if (savedIP) candidates.unshift(`http://${savedIP}:${AQUAGO_PORT}`);

  // Saqlangan tunnel URL ni sinash
  const savedTunnel = localStorage.getItem('aquago_tunnel_url');
  if (savedTunnel) candidates.unshift(savedTunnel);

  for (const base of candidates) {
    const ok = await _testAndConnect(base);
    if (ok) {
      localStorage.setItem('aquago_server_ip', new URL(base).hostname);
      // Agar lokal serverga ulangan bo'lsa, tunnel URL ni so'rash
      if (base.includes('localhost') || base.includes('127.0.0.1') || base.includes('192.168')) {
        _fetchAndSaveTunnelUrl(base);
      }
      break;
    }
  }
}

// ── Tunnel URL ni serverdan olish va saqlash ──────────────
async function _fetchAndSaveTunnelUrl(base) {
  try {
    const r = await fetch(base + '/api/tunnel-url');
    if (r.ok) {
      const data = await r.json();
      if (data.url) {
        localStorage.setItem('aquago_tunnel_url', data.url);
        console.log('[AquaGo] Tunnel URL saqlandi:', data.url);
      }
    }
  } catch { }
}


async function _testAndConnect(base) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch(base + '/api/orders', { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      _resolvedBase = base;
      _online = true;
      window._aquagoServer = base;
      _connectSSE();
      console.log('[AquaGo] Server topildi:', base);
      return true;
    }
  } catch { }
  return false;
}


// ── Real-time sync: SSE (lokal server) yoki Polling (Netlify) ───
let _pollTimer = null;

function _connectSSE() {
  if (!_resolvedBase || _sse) return;

  window._aquagoServer = _resolvedBase;  // expose for user.js / driver.js chat

  // Netlify yoki Cloudflare'da SSE ishlamaydi → polling ishlatamiz
  const isNetlify = _resolvedBase.includes('netlify.app') ||
                    _resolvedBase.includes('netlify.com') ||
                    (!_resolvedBase.includes('localhost') &&
                     !_resolvedBase.includes('127.0.0.1') &&
                     !_resolvedBase.includes('192.168') &&
                     !_resolvedBase.includes('railway.app'));

  if (isNetlify) {
    _startPolling();
    return;
  }

  // Lokal server – SSE ishlatamiz
  try {
    _sse = new EventSource(_resolvedBase + '/api/events');

    _sse.addEventListener('orders', e => {
      try {
        const orders = JSON.parse(e.data);
        localStorage.setItem('aquago_orders', JSON.stringify(orders));
        window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
      } catch { }
    });

    _sse.addEventListener('users', e => {
      try {
        let users = JSON.parse(e.data);
        users = _ensureDemoUsers(users);
        localStorage.setItem('aquago_users', JSON.stringify(users));
      } catch { }
    });

    _sse.addEventListener('driver-location', e => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('aquago_driver_location', { detail: data }));
      } catch { }
    });

    _sse.addEventListener('message', e => {
      try {
        const msg = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('aquago_message', { detail: msg }));
      } catch { }
    });

    _sse.onerror = () => {
      _sse.close();
      _sse = null;
      _online = false;
      window._aquagoServer = null;
      // SSE ishlamasa polling'ga o'tamiz
      _startPolling();
    };
  } catch {
    _startPolling();
  }
}

// ── Polling (Netlify serverless uchun) ───────────────────
let _lastMsgTs = 0;

function _startPolling() {
  if (_pollTimer) return; // allaqachon ishlamoqda
  console.log('[AquaGo] Polling mode (Netlify)');
  _poll();
  _pollTimer = setInterval(_poll, 4000);
}

async function _poll() {
  if (!_resolvedBase || !_online) return;
  try {
    const r = await fetch(_resolvedBase + '/api/events');
    if (!r.ok) { _online = false; return; }
    const data = await r.json();

    // Orders
    if (Array.isArray(data.orders)) {
      localStorage.setItem('aquago_orders', JSON.stringify(data.orders));
      window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: data.orders }));
    }

    // Users
    if (Array.isArray(data.users)) {
      const users = _ensureDemoUsers(data.users);
      localStorage.setItem('aquago_users', JSON.stringify(users));
    }

    // Messages – faqat yangi xabarlarni yuborish
    if (Array.isArray(data.messages)) {
      const newMsgs = data.messages.filter(m => m.ts > _lastMsgTs);
      if (newMsgs.length > 0) {
        _lastMsgTs = Math.max(...newMsgs.map(m => m.ts));
        for (const msg of newMsgs) {
          window.dispatchEvent(new CustomEvent('aquago_message', { detail: msg }));
        }
      }
    }

    // Driver locations
    if (data.driverLocations) {
      for (const [driverId, loc] of Object.entries(data.driverLocations)) {
        window.dispatchEvent(new CustomEvent('aquago_driver_location', {
          detail: { driverId, ...loc }
        }));
      }
    }
  } catch {
    _online = false;
    clearInterval(_pollTimer);
    _pollTimer = null;
    setTimeout(_detectServer, 5000);
  }
}


// ── HTTP helpers ─────────────────────────────────────────
async function _post(path, body) {
  if (!_resolvedBase || !_online) return null;
  try {
    const r = await fetch(_resolvedBase + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.ok ? r.json() : null;
  } catch { _online = false; return null; }
}

async function _put(path, body) {
  if (!_resolvedBase || !_online) return null;
  try {
    const r = await fetch(_resolvedBase + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.ok ? r.json() : null;
  } catch { _online = false; return null; }
}

async function _patch(path, body) {
  if (!_resolvedBase || !_online) return null;
  try {
    const r = await fetch(_resolvedBase + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return r.ok ? r.json() : null;
  } catch { _online = false; return null; }
}

// ============================================================
// DB object – same public interface as before
// ============================================================
const DB = {

  /* ---- USERS ---- */
  getUsers() {
    return JSON.parse(localStorage.getItem('aquago_users') || '[]');
  },
  saveUsers(users) {
    localStorage.setItem('aquago_users', JSON.stringify(users));
    _post('/api/users', users);
  },
  getUserByPhone(phone) { return this.getUsers().find(u => u.phone === phone); },
  addUser(user) {
    const users = this.getUsers();
    users.push(user);
    this.saveUsers(users);
  },

  /** Demo accountlarni qayta tiklash (har doim mavjud bo'lishini ta'minlash) */
  ensureDemoUsers() {
    const users = _ensureDemoUsers(this.getUsers());
    localStorage.setItem('aquago_users', JSON.stringify(users));
    return users;
  },

  /* ---- SESSION ---- */
  setCurrentUser(user) { localStorage.setItem('aquago_current_user', JSON.stringify(user)); },
  getCurrentUser() { return JSON.parse(localStorage.getItem('aquago_current_user') || 'null'); },
  clearCurrentUser() { localStorage.removeItem('aquago_current_user'); },

  /* ---- ORDERS ---- */
  getOrders() {
    return JSON.parse(localStorage.getItem('aquago_orders') || '[]');
  },
  saveOrders(orders) {
    localStorage.setItem('aquago_orders', JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
    _put('/api/orders', orders);
  },
  addOrder(order) {
    const orders = this.getOrders();
    orders.unshift(order);
    localStorage.setItem('aquago_orders', JSON.stringify(orders));
    window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
    // Server: just add this order
    _post('/api/orders', order);
    return order;
  },
  getOrderById(id) { return this.getOrders().find(o => o.id === id); },
  updateOrder(id, updates) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === id);
    if (idx !== -1) {
      orders[idx] = { ...orders[idx], ...updates };
      localStorage.setItem('aquago_orders', JSON.stringify(orders));
      window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
      _patch(`/api/orders/${id}`, updates);
      return orders[idx];
    }
    return null;
  },
  getPendingOrders() { return this.getOrders().filter(o => o.status === 'pending'); },
  getActiveOrder() { return this.getOrders().find(o => ['pending', 'accepted'].includes(o.status)); },
  getUserOrders(uid) { return this.getOrders().filter(o => o.userId === uid); },
  generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
};

// ── Cross-tab sync (same browser) ────────────────────────
window.addEventListener('storage', e => {
  if (e.key === 'aquago_orders') {
    const orders = JSON.parse(e.newValue || '[]');
    window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
  }
});

// ── Bootstrap ────────────────────────────────────────────
(async function boot() {
  // Har doim demo accountlar mavjudligini ta'minlash
  // (birinchi marta yoki serverdan o'chirilgan bo'lsa)
  DB.ensureDemoUsers();

  // Try server connection
  await _detectServer();

  // Server ulanganidan keyin ham demo accountlarni tekshirish
  // (SSE orqali bo'sh list kelgan bo'lishi mumkin)
  DB.ensureDemoUsers();
})();
