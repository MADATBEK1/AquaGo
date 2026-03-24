/* ===================================================
   AquaGo – Storage v3
   Auto-detect server → real-time cross-device sync
   Fallback → localStorage (offline / same-device)
   =================================================== */

const AQUAGO_PORT = 7474;

// ── Server URL detection ─────────────────────────────────
// 1) file:// → try to find server on local network
// 2) http://  → use current host
const API_BASE = (() => {
  if (location.protocol !== 'file:') {
    // Agar capacitor localhost bo'lsa
    if (location.hostname === 'localhost' && !location.port) {
      return `https://web-production-12311.up.railway.app`;
    }
    return location.origin;
  }
  return null; // will be resolved async
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

  for (const base of candidates) {
    const ok = await _testAndConnect(base);
    if (ok) {
      localStorage.setItem('aquago_server_ip', new URL(base).hostname);
      break;
    }
  }
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


// ── SSE ──────────────────────────────────────────────────
function _connectSSE() {
  if (!_resolvedBase || _sse) return;

  window._aquagoServer = _resolvedBase;  // expose for user.js / driver.js chat

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
      const users = JSON.parse(e.data);
      localStorage.setItem('aquago_users', JSON.stringify(users));
    } catch { }
  });

  // Driver GPS → user map real-time
  _sse.addEventListener('driver-location', e => {
    try {
      const data = JSON.parse(e.data);
      window.dispatchEvent(new CustomEvent('aquago_driver_location', { detail: data }));
    } catch { }
  });

  // Chat message
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
    setTimeout(_detectServer, 5000);
  };
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
  // Demo accounts (first run only)
  if (DB.getUsers().length === 0) {
    localStorage.setItem('aquago_users', JSON.stringify([
      {
        id: 'driver-demo', name: 'Alisher Suvchi', phone: '+998901234567',
        password: '123456', vehicle: '01 A 777 BC', role: 'driver',
        createdAt: Date.now(), todayEarnings: 0, completedCount: 0
      },
      {
        id: 'user-demo', name: 'Bobur Abdullayev', phone: '+998907654321',
        password: '123456', role: 'user', createdAt: Date.now()
      }
    ]));
  }

  // Try server connection
  await _detectServer();
})();
