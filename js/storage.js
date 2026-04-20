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

  // Add current origin if not file:// and not localhost
  if (location.protocol !== 'file:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    candidates.unshift(location.origin);
  }

  // For HTML file mode - still try server candidates (don't bail out)
  if (location.protocol === 'file:') {
    console.log('[AquaGo] HTML file mode - trying server candidates...');
    // Don't return early — fall through to try all candidates below
  }

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


// ── Real-time sync: SSE (server) yoki Polling (Netlify) ───
let _pollTimer = null;

function _connectSSE() {
  if (!_resolvedBase || _sse) return;

  window._aquagoServer = _resolvedBase;  // expose for user.js / driver.js chat

  // Faqat Netlify'da SSE ishlamaydi → polling ishlatamiz
  // Railway, localhost, LAN – SSE ishlaydi
  const isNetlify = _resolvedBase.includes('netlify.app') ||
                    _resolvedBase.includes('netlify.com');

  if (isNetlify) {
    console.log('[AquaGo] Using polling mode (Netlify)');
    _startPolling();
    return;
  }

  // Lokal server – SSE ishlatamiz
  try {
    console.log('[AquaGo] Connecting to SSE:', _resolvedBase + '/api/events');
    _sse = new EventSource(_resolvedBase + '/api/events');

    _sse.addEventListener('orders', e => {
      try {
        const orders = JSON.parse(e.data);
        console.log('[AquaGo] SSE orders received:', orders.length, 'orders');
        localStorage.setItem('aquago_orders', JSON.stringify(orders));
        window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
      } catch (err) {
        console.error('[AquaGo] SSE orders error:', err);
      }
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

    _sse.addEventListener('open', () => {
      console.log('[AquaGo] SSE connection opened');
      _online = true;
    });

    _sse.onerror = () => {
      console.error('[AquaGo] SSE xatosi – 5s da qayta ulaniladi...');
      _sse.close();
      _sse = null;
      // _resolvedBase va window._aquagoServer ni tozalamaslik!
      // Polling ham ishga tushirish (SSE qayta ulangunch)
      if (!_pollTimer) _startPolling();
      // 5 soniyadan keyin SSE qayta ulanish urinish
      setTimeout(() => {
        if (!_sse) _connectSSE();
      }, 5000);
    };
  } catch (err) {
    console.error('[AquaGo] SSE connection failed:', err);
    _startPolling();
  }
}

// ── Polling (Netlify serverless uchun) ───────────────────
let _lastMsgTs = 0;

function _startPolling() {
  if (_pollTimer) return; // allaqachon ishlamoqda
  console.log('[AquaGo] Polling mode (Real-time sync)');
  _poll();
  _pollTimer = setInterval(_poll, 2000); // More frequent polling for better sync
}

async function _poll() {
  if (!_resolvedBase) return; // Try to poll even if _online is false to reconnect
  
  try {
    // Orders ni to'g'ridan-to'g'ri /api/orders dan olish
    const r = await fetch(_resolvedBase + '/api/orders', {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!r.ok) { 
      _online = false; 
      return; 
    }
    const orders = await r.json();
    if (Array.isArray(orders)) {
      const currentOrders = JSON.parse(localStorage.getItem('aquago_orders') || '[]');
      // Force update if different
      if (JSON.stringify(orders) !== JSON.stringify(currentOrders)) {
        localStorage.setItem('aquago_orders', JSON.stringify(orders));
        window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
        console.log('[AquaGo] Polling: Orders synced:', orders.length, 'orders');
      }
    } else {
      console.warn('[AquaGo] Polling: Invalid orders response');
    }

    // Users ni /api/users dan olish
    const ru = await fetch(_resolvedBase + '/api/users', {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (ru.ok) {
      const users = _ensureDemoUsers(await ru.json());
      localStorage.setItem('aquago_users', JSON.stringify(users));
    }

    // Messages - faqat yangi xabarlarni yuborish
    const rm = await fetch(_resolvedBase + '/api/messages');
    if (rm.ok) {
      const msgs = await rm.json();
      if (Array.isArray(msgs)) {
        const newMsgs = msgs.filter(m => m.ts > _lastMsgTs);
        if (newMsgs.length > 0) {
          _lastMsgTs = Math.max(...newMsgs.map(m => m.ts));
          for (const msg of newMsgs) {
            window.dispatchEvent(new CustomEvent('aquago_message', { detail: msg }));
          }
        }
      }
    }

    // Driver locations
    const rd = await fetch(_resolvedBase + '/api/driver-location');
    if (rd.ok) {
      const locs = await rd.json();
      for (const [driverId, loc] of Object.entries(locs)) {
        window.dispatchEvent(new CustomEvent('aquago_driver_location', {
          detail: { driverId, ...loc }
        }));
      }
    }
    
    // Mark as online if we got here
    _online = true;
  } catch (err) {
    console.warn('[AquaGo] Poll error:', err);
    _online = false;
    clearInterval(_pollTimer);
    _pollTimer = null;
    // Try to reconnect after 3 seconds
    setTimeout(_detectServer, 3000);
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
  // Add order to localStorage with cross-tab sync
  addOrder(order) {
    const orders = this.getOrders();
    orders.unshift(order);
    localStorage.setItem('aquago_orders', JSON.stringify(orders));
    
    // Trigger cross-tab sync event
    window.dispatchEvent(new CustomEvent('aquago_orders_updated', { detail: orders }));
    
    // Server: always try to send the order, even if _online flag is false
    // Use best-effort POST with retry
    const _sendOrderToServer = (retries = 3) => {
      const base = _resolvedBase || window._aquagoServer;
      if (!base) {
        // Server hali topilmagan — qisqa kutib, qayta urinish
        if (retries > 0) {
          setTimeout(() => _sendOrderToServer(retries - 1), 2000);
        }
        return;
      }
      fetch(base + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order)
      }).then(r => {
        if (r.ok) {
          console.log('[AquaGo] Order sent to server:', order.id);
          _online = true;
          window._aquagoServer = base;
        } else if (retries > 0) {
          setTimeout(() => _sendOrderToServer(retries - 1), 2000);
        }
      }).catch(() => {
        if (retries > 0) setTimeout(() => _sendOrderToServer(retries - 1), 2000);
      });
    };
    _sendOrderToServer();
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
