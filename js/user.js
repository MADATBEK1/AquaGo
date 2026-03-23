/* ===================================================
   AquaGo – User Dashboard Logic  (v2 – Enhanced)
   New: real driver tracking, chat, rating
   =================================================== */

let currentUser = null;
let userMap = null;
let userMarker = null;
let driverMapMarker = null;   // real driver on user's map
let userLocation = null;
let activeOrderId = null;
let waitTimerInterval = null;
let waitSeconds = 0;
let orderCheckInterval = null;
let chatPolling = null;
let lastMsgId = null;

const DEFAULT_LAT = 41.5501;
const DEFAULT_LNG = 60.6333;

// ─── INIT ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'user') {
        window.location.href = 'index.html'; return;
    }
    initUserDashboard();
    startOrderWatcher();
});

function initUserDashboard() {
    document.getElementById('navUserName').textContent = currentUser.name;
    document.getElementById('greetingText').textContent =
        `Assalomu alaykum, ${currentUser.name.split(' ')[0]}! 👋`;

    refreshStats();
    renderOrdersList();

    const activeOrder = DB.getUserOrders(currentUser.id)
        .find(o => o.status === 'pending' || o.status === 'accepted');

    if (activeOrder) {
        activeOrderId = activeOrder.id;
        userLocation = { lat: activeOrder.lat, lng: activeOrder.lng };
        activeOrder.status === 'pending' ? showPendingScreen(activeOrder)
            : showArrivingScreen(activeOrder);
    } else {
        showLocationDialog();
    }
}

// ─── LOCATION ────────────────────────────────────────────
function showLocationDialog() {
    document.getElementById('locationDialog').classList.remove('hidden');
}
function getLocation() {
    document.getElementById('locationDialog').classList.add('hidden');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                showToast('📍 Joylashuv aniqlandi!', 'success');
            },
            () => useDefaultLocation()
        );
    } else { useDefaultLocation(); }
}
function useDefaultLocation() {
    document.getElementById('locationDialog').classList.add('hidden');
    userLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    showToast('📍 Standart joylashuv (Urganch) ishlatildi', 'info');
}

// ─── ORDER MODAL ─────────────────────────────────────────
function openOrderModal() {
    if (!userLocation) { showLocationDialog(); return; }
    document.getElementById('orderModal').classList.remove('hidden');
}
function closeOrderModal() {
    document.getElementById('orderModal').classList.add('hidden');
}

let orderParams = { quantity: 1 };
function changeQuantity(val) {
    orderParams.quantity = Math.max(1, Math.min(20, orderParams.quantity + val));
    document.getElementById('orderQuantity').textContent = orderParams.quantity;
}

function confirmOrder() {
    closeOrderModal();
    const btn = document.getElementById('waterBtn');
    btn.classList.add('loading');
    const txt = btn.querySelector('.water-btn-text');
    txt.textContent = 'YUBORILMOQDA...';

    const wType = document.getElementById('waterType').value;
    const pType = document.getElementById('paymentType').value;
    const qty = orderParams.quantity;

    setTimeout(() => {
        btn.classList.remove('loading');
        txt.textContent = 'SUV BUYURTMA QILISH';

        const order = {
            id: DB.generateId(),
            userId: currentUser.id,
            userName: currentUser.name,
            userPhone: currentUser.phone,
            lat: userLocation.lat + (Math.random() - 0.5) * 0.001,
            lng: userLocation.lng + (Math.random() - 0.5) * 0.001,
            status: 'pending',
            createdAt: Date.now(),
            address: `Joylashuv: ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}\n📦 ${qty} x ${wType} | ${pType}`,
            waterType: wType,
            paymentType: pType,
            quantity: qty,
            driverId: null,
            driverName: null,
            completedAt: null,
            rating: null
        };

        DB.addOrder(order);
        activeOrderId = order.id;
        showToast('💧 Buyurtma yuborildi! Suvchi qidirilmoqda...', 'info');
        showPendingScreen(order);
    }, 800);
}

// ─── SCREENS ─────────────────────────────────────────────
function showMain() {
    document.getElementById('mainScreen').classList.remove('hidden');
    document.getElementById('pendingScreen').classList.add('hidden');
    document.getElementById('arrivingScreen').classList.add('hidden');
    closeChatPanel();
    if (userMap) { userMap.remove(); userMap = null; }
    refreshStats();
    renderOrdersList();
}

function showPendingScreen(order) {
    document.getElementById('mainScreen').classList.add('hidden');
    document.getElementById('pendingScreen').classList.remove('hidden');
    document.getElementById('arrivingScreen').classList.add('hidden');

    waitSeconds = 0;
    clearInterval(waitTimerInterval);
    waitTimerInterval = setInterval(() => {
        waitSeconds++;
        document.getElementById('waitTimer').textContent = formatTime(waitSeconds);
    }, 1000);

    setTimeout(() => initPendingMap(order), 200);
}

function showArrivingScreen(order) {
    document.getElementById('mainScreen').classList.add('hidden');
    document.getElementById('pendingScreen').classList.add('hidden');
    document.getElementById('arrivingScreen').classList.remove('hidden');
    clearInterval(waitTimerInterval);

    document.getElementById('driverNameDisplay').textContent =
        `🚗 Suvchi: ${order.driverName || 'Suvchi'} ketayapti!`;

    setTimeout(() => initArrivingMap(order), 200);

    // Start chat
    if (order.driverId) startChat(order.id);
}

// ─── MAPS ─────────────────────────────────────────────────
function initPendingMap(order) {
    if (userMap) { userMap.remove(); userMap = null; }
    userMap = L.map('pendingMap', { zoomControl: false, dragging: false })
        .setView([order.lat, order.lng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', subdomains: 'abcd', maxZoom: 19
    }).addTo(userMap);

    const html = `<div style="width:40px;height:40px;background:linear-gradient(135deg,#0ea5e9,#0284c7);
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:1.3rem;border:3px solid rgba(255,255,255,0.5);
      box-shadow:0 4px 15px rgba(14,165,233,0.6);">💧</div>`;
    L.marker([order.lat, order.lng],
        { icon: L.divIcon({ html, className: '', iconAnchor: [20, 20] }) }).addTo(userMap);

    // Pulse ring
    L.circle([order.lat, order.lng], { radius: 100, color: '#0ea5e9', fillOpacity: 0.08, weight: 2 })
        .addTo(userMap);
}

function initArrivingMap(order) {
    if (userMap) { userMap.remove(); userMap = null; }
    driverMapMarker = null;

    userMap = L.map('arrivingMap', { zoomControl: true })
        .setView([order.lat, order.lng], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', subdomains: 'abcd', maxZoom: 19
    }).addTo(userMap);

    // User (home) marker
    L.marker([order.lat, order.lng], {
        icon: L.divIcon({
            html: `<div style="width:42px;height:42px;background:linear-gradient(135deg,#0ea5e9,#0284c7);
              border-radius:50%;display:flex;align-items:center;justify-content:center;
              font-size:1.4rem;border:3px solid white;box-shadow:0 4px 15px rgba(14,165,233,0.7);">🏠</div>`,
            className: '', iconAnchor: [21, 21]
        })
    }).addTo(userMap).bindPopup('<strong>Sizning manzilingiz</strong>');

    // Driver marker (will be updated via SSE / polling)
    const driverHtml = `<div id="driverMovingIcon" style="width:44px;height:44px;
      background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:1.5rem;
      border:3px solid white;box-shadow:0 4px 18px rgba(34,197,94,0.8);
      animation:mapMarkerPulse 1.2s ease-in-out infinite;">🚗</div>`;

    // Initial driver position (slightly away, will update via GPS)
    const initLat = order.lat + 0.006;
    const initLng = order.lng + 0.006;
    driverMapMarker = L.marker([initLat, initLng], {
        icon: L.divIcon({ html: driverHtml, className: '', iconAnchor: [22, 22] })
    }).addTo(userMap).bindPopup(`<strong>${order.driverName || 'Suvchi'}</strong><br>Siz tomon kelmoqda`);

    // Route line (will update)
    userMap._routeLine = L.polyline([[order.lat, order.lng], [initLat, initLng]], {
        color: '#0ea5e9', weight: 3.5, opacity: 0.7, dashArray: '8,8'
    }).addTo(userMap);

    // Distance display
    updateDistanceDisplay(order.lat, order.lng, initLat, initLng);
}

// Update driver position on user's map (called from SSE)
function updateDriverOnUserMap(lat, lng, orderId) {
    if (!userMap || !driverMapMarker) return;
    if (activeOrderId !== orderId && orderId) return;

    driverMapMarker.setLatLng([lat, lng]);

    // Update route line
    const order = DB.getOrderById(activeOrderId);
    if (order && userMap._routeLine) {
        userMap._routeLine.setLatLngs([[order.lat, order.lng], [lat, lng]]);
    }

    updateDistanceDisplay(order ? order.lat : DEFAULT_LAT, order ? order.lng : DEFAULT_LNG, lat, lng);

    // Auto-follow driver
    if (userMap.getBounds().contains([lat, lng])) return;
    userMap.panTo([lat, lng]);
}

function updateDistanceDisplay(userLat, userLng, driverLat, driverLng) {
    const R = 6371000;
    const dLat = (driverLat - userLat) * Math.PI / 180;
    const dLng = (driverLng - userLng) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(userLat * Math.PI / 180) * Math.cos(driverLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

    const el = document.getElementById('driverDistance');
    if (el) el.textContent = dist < 1000 ? `${dist} m` : `${(dist / 1000).toFixed(1)} km`;

    // ETA at ~30 km/h
    const etaMin = Math.max(1, Math.round(dist / 500));
    const etaEl = document.getElementById('driverEta');
    if (etaEl) etaEl.textContent = `~${etaMin} min`;
}

// ─── CHAT ─────────────────────────────────────────────────
function toggleChat() {
    const panel = document.getElementById('chatPanel');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        startChat(activeOrderId);
        document.getElementById('chatInput').focus();
    } else {
        closeChatPanel();
    }
}

function closeChatPanel() {
    const panel = document.getElementById('chatPanel');
    if (panel) panel.classList.add('hidden');
    clearInterval(chatPolling);
    chatPolling = null;
}

function startChat(orderId) {
    if (!orderId) return;
    loadMessages(orderId);
    clearInterval(chatPolling);
    chatPolling = setInterval(() => loadMessages(orderId), 2000);
}

async function loadMessages(orderId) {
    const base = window._aquagoServer;
    if (!base) return;
    try {
        const r = await fetch(`${base}/api/messages?orderId=${orderId}`);
        const msgs = await r.json();
        renderMessages(msgs, orderId);
    } catch { }
}

function renderMessages(msgs, orderId) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    container.innerHTML = msgs.map(m => {
        const isMine = m.senderId === currentUser.id;
        return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}">
          <div class="chat-bubble">
            ${!isMine ? `<span class="chat-sender">${m.senderName}</span>` : ''}
            <p>${escapeHtml(m.text)}</p>
            <span class="chat-time">${new Date(m.ts).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text || !activeOrderId) return;
    input.value = '';

    const base = window._aquagoServer;
    if (!base) { showToast('Server ulanmagan', 'warning'); return; }

    const order = DB.getOrderById(activeOrderId);
    await fetch(`${base}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: activeOrderId,
            senderId: currentUser.id,
            senderName: currentUser.name,
            senderRole: 'user',
            receiverId: order ? order.driverId : null,
            text
        })
    });
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

// ─── RATING ───────────────────────────────────────────────
function showRatingModal(orderId) {
    const modal = document.getElementById('ratingModal');
    if (!modal) return;
    modal.dataset.orderId = orderId;
    modal.classList.remove('hidden');
    renderStars(0);
}

function closeRatingModal() {
    document.getElementById('ratingModal').classList.add('hidden');
}

let _selectedStars = 0;
function renderStars(count) {
    _selectedStars = count;
    document.querySelectorAll('.star-btn').forEach((s, i) => {
        s.textContent = i < count ? '⭐' : '☆';
        s.classList.toggle('active', i < count);
    });
}

async function submitRating() {
    if (_selectedStars === 0) { showToast('Baho bering!', 'warning'); return; }
    const modal = document.getElementById('ratingModal');
    const orderId = modal.dataset.orderId;
    const comment = document.getElementById('ratingComment').value;

    const base = window._aquagoServer;
    if (base) {
        await fetch(`${base}/api/ratings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId,
                userId: currentUser.id,
                stars: _selectedStars,
                comment,
                createdAt: Date.now()
            })
        });
    }

    DB.updateOrder(orderId, { rating: { stars: _selectedStars, comment } });
    closeRatingModal();
    showToast(`⭐ ${_selectedStars} yulduz berildi! Rahmat!`, 'success');
}

// ─── CANCEL & COMPLETE ────────────────────────────────────
function cancelOrder() {
    if (!activeOrderId) return;
    DB.updateOrder(activeOrderId, { status: 'cancelled', cancelledAt: Date.now() });
    activeOrderId = null;
    clearInterval(waitTimerInterval);
    closeChatPanel();
    showToast('❌ Buyurtma bekor qilindi', 'warning');
    if (userMap) { userMap.remove(); userMap = null; }
    showMain();
}

function completeOrder() {
    if (!activeOrderId) return;
    const ordId = activeOrderId;
    DB.updateOrder(ordId, { status: 'done', completedAt: Date.now() });
    activeOrderId = null;
    clearInterval(waitTimerInterval);
    closeChatPanel();
    showToast('✅ Suv qabul qilindi! Rahmat!', 'success');
    if (userMap) { userMap.remove(); userMap = null; }
    showMain();
    // Show rating after short delay
    setTimeout(() => showRatingModal(ordId), 1000);
}

// ─── ORDER WATCHER ────────────────────────────────────────
function startOrderWatcher() {
    orderCheckInterval = setInterval(checkOrderStatus, 2000);
    window.addEventListener('aquago_orders_updated', checkOrderStatus);

    // SSE: driver location
    window.addEventListener('aquago_driver_location', e => {
        const { lat, lng } = e.detail;
        updateDriverOnUserMap(lat, lng);
    });

    // SSE: new chat message
    window.addEventListener('aquago_message', e => {
        const msg = e.detail;
        if (msg.orderId !== activeOrderId) return;
        if (msg.senderId === currentUser.id) return;
        // Auto-load messages
        loadMessages(activeOrderId);
        showToast(`💬 ${msg.senderName}: ${msg.text.slice(0, 30)}`, 'info', 3000);
    });
}

function checkOrderStatus() {
    if (!activeOrderId) return;
    const order = DB.getOrderById(activeOrderId);
    if (!order) return;

    if (order.status === 'accepted') {
        const pend = document.getElementById('pendingScreen');
        if (!pend.classList.contains('hidden')) {
            showToast(`🚗 ${order.driverName} suv olib kelayapti!`, 'success', 5000);
            showArrivingScreen(order);
        }
    }
    if (order.status === 'done') {
        const arriving = document.getElementById('arrivingScreen');
        if (!arriving.classList.contains('hidden')) {
            completeOrder();
        }
    }
}

// ─── STATS ────────────────────────────────────────────────
function refreshStats() {
    const orders = DB.getUserOrders(currentUser.id);
    document.getElementById('totalOrders').textContent = orders.length;
    document.getElementById('completedOrders').textContent = orders.filter(o => o.status === 'done').length;
    document.getElementById('pendingOrders').textContent = orders.filter(o => ['pending', 'accepted'].includes(o.status)).length;
}

// ─── ORDERS LIST ──────────────────────────────────────────
function renderOrdersList() {
    const container = document.getElementById('ordersList');
    const userOrders = DB.getUserOrders(currentUser.id).slice(0, 10);

    if (userOrders.length === 0) {
        container.innerHTML = `<div class="empty-orders"><div class="empty-icon">📋</div><p>Hozircha buyurtmalar yo'q</p></div>`;
        return;
    }

    container.innerHTML = userOrders.map(order => {
        const si = getStatusInfo(order.status);
        const date = new Date(order.createdAt).toLocaleString('uz-UZ', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const stars = order.rating ? '⭐'.repeat(order.rating.stars) : '';
        return `<div class="order-item">
          <div class="order-item-left">
            <span class="order-status-icon">${si.icon}</span>
            <div class="order-info">
              <strong>${order.waterType || 'Suv buyurtmasi'}</strong>
              <span class="order-date">${date}</span>
              ${order.driverName ? `<span class="order-driver">🚗 ${order.driverName}</span>` : ''}
              ${stars ? `<span class="order-stars">${stars}</span>` : ''}
            </div>
          </div>
          <span class="order-status-badge ${si.class}">${si.label}</span>
        </div>`;
    }).join('');
}

function getStatusInfo(status) {
    return ({
        pending: { icon: '⏳', label: 'Kutilmoqda', class: 'badge-pending' },
        accepted: { icon: '🚗', label: "Yo'lda", class: 'badge-pending' },
        done: { icon: '✅', label: 'Bajarildi', class: 'badge-done' },
        cancelled: { icon: '❌', label: 'Bekor qilindi', class: 'badge-cancelled' }
    })[status] || { icon: '⏳', label: 'Kutilmoqda', class: 'badge-pending' };
}

// ─── HELPERS ──────────────────────────────────────────────
function centerOnMyLocation() {
    if (userMap && userLocation) userMap.setView([userLocation.lat, userLocation.lng], 15);
}

function escapeHtml(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function logout() {
    clearInterval(waitTimerInterval);
    clearInterval(orderCheckInterval);
    closeChatPanel();
    DB.clearCurrentUser();
    window.location.href = 'index.html';
}

// ─── TOAST ────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-text">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(toast);
    setTimeout(() => { toast.classList.add('removing'); setTimeout(() => toast.remove(), 300); }, duration);
}
