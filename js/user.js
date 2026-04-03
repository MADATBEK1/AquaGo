/* ===================================================
   AquaGo – User Dashboard Logic  (v3 – ULTRA PREMIUM)
   Particles, Live Clock, Animated Counters, Enhanced UX
   =================================================== */

let currentUser = null;
let userMap = null;
let userMarker = null;
let driverMapMarker = null;
let userLocation = null;
let activeOrderId = null;
let waitTimerInterval = null;
let waitSeconds = 0;
let orderCheckInterval = null;
let chatPolling = null;
let lastMsgId = null;

const DEFAULT_LAT = 41.1944;
const DEFAULT_LNG = 61.3098;

// ─── PARTICLE SYSTEM ─────────────────────────────────
function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 50;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
        constructor() { this.reset(); }
        reset() {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = Math.random() * 2 + 0.5;
            this.speedX = (Math.random() - 0.5) * 0.3;
            this.speedY = (Math.random() - 0.5) * 0.3;
            this.opacity = Math.random() * 0.3 + 0.1;
            this.pulse = Math.random() * Math.PI * 2;
            this.pulseSpeed = Math.random() * 0.02 + 0.005;
            // Color: blue/cyan water theme
            const colors = ['14,165,233', '6,182,212', '56,189,248', '34,197,94'];
            this.color = colors[Math.floor(Math.random() * colors.length)];
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            this.pulse += this.pulseSpeed;
            const pulseFactor = Math.sin(this.pulse) * 0.15 + 0.85;
            this.currentOpacity = this.opacity * pulseFactor;
            if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) this.reset();
        }
        draw() {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color}, ${this.currentOpacity})`;
            ctx.fill();
            // Glow
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${this.color}, ${this.currentOpacity * 0.15})`;
            ctx.fill();
        }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    // Draw connections between close particles
    function drawConnections() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 120) {
                    const opacity = (1 - dist / 120) * 0.08;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(14, 165, 233, ${opacity})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => { p.update(); p.draw(); });
        drawConnections();
        requestAnimationFrame(animate);
    }
    animate();
}

// ─── LIVE CLOCK ──────────────────────────────────────
function initLiveClock() {
    function update() {
        const now = new Date();
        const timeEl = document.getElementById('clockTime');
        const dateEl = document.getElementById('clockDate');
        if (timeEl) timeEl.textContent = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (dateEl) {
            const months = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avg', 'Sent', 'Okt', 'Noy', 'Dek'];
            dateEl.textContent = `${now.getDate()} ${months[now.getMonth()]}`;
        }
    }
    update();
    setInterval(update, 1000);
}

// ─── ANIMATED COUNTER ────────────────────────────────
function animateCounter(el, target) {
    if (!el) return;
    const start = parseInt(el.textContent) || 0;
    if (start === target) return;
    const duration = 800;
    const stepTime = 16;
    const steps = Math.ceil(duration / stepTime);
    const increment = (target - start) / steps;
    let current = start;
    let step = 0;
    const timer = setInterval(() => {
        step++;
        current += increment;
        el.textContent = Math.round(current);
        if (step >= steps) {
            el.textContent = target;
            clearInterval(timer);
        }
    }, stepTime);
}

// ─── INIT ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'user') {
        window.location.href = 'index.html'; return;
    }
    initParticles();
    initLiveClock();
    initUserDashboard();
    startOrderWatcher();
    // Init weather after a short delay (location may not be set yet)
    setTimeout(initWeather, 1500);
});

function initUserDashboard() {
    // Nav
    document.getElementById('navUserName').textContent = currentUser.name;
    const avatarLetter = document.getElementById('navAvatarLetter');
    if (avatarLetter) avatarLetter.textContent = currentUser.name.charAt(0).toUpperCase();

    // Greeting with time-based message
    const hour = new Date().getHours();
    let greetPrefix = 'Assalomu alaykum';
    if (hour >= 6 && hour < 12) greetPrefix = 'Xayrli tong';
    else if (hour >= 12 && hour < 18) greetPrefix = 'Xayrli kun';
    else if (hour >= 18 && hour < 22) greetPrefix = 'Xayrli kech';
    else greetPrefix = 'Xayrli tun';

    document.getElementById('greetingText').textContent =
        `${greetPrefix}, ${currentUser.name.split(' ')[0]}! 👋`;

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

// ─── LOCATION ────────────────────────────────────────
function showLocationDialog() {
    document.getElementById('locationDialog').classList.remove('hidden');
}
function getLocation() {
    document.getElementById('locationDialog').classList.add('hidden');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                const locText = document.getElementById('locationText');
                if (locText) locText.textContent = `📍 ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
                showToast('📍 Joylashuv aniqlandi!', 'success');
            },
            () => useDefaultLocation()
        );
    } else { useDefaultLocation(); }
}
function useDefaultLocation() {
    document.getElementById('locationDialog').classList.add('hidden');
    userLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
    const locText = document.getElementById('locationText');
    if (locText) locText.textContent = '📍 Urganch, Xorazm';
    showToast('📍 Standart joylashuv (Urganch, Xorazm) ishlatildi', 'info');
}

// ─── ORDER MODAL ─────────────────────────────────────
function openOrderModal() {
    if (!userLocation) { showLocationDialog(); return; }
    document.getElementById('orderModal').classList.remove('hidden');
}
function closeOrderModal() {
    document.getElementById('orderModal').classList.add('hidden');
}

let orderParams = { quantity: 1 };

// ─── WATER TYPE DESCRIPTION ──────────────────────────
const WATER_DESCS = {
    '19L Kalyonka': '💧 <strong style="color:#38bdf8;">19 Litr Kalyonka</strong> — Eng ko\'p ishlatiladigan hajm. Idish qaytariladi. Narxi: ~12,000 – 15,000 so\'m.',
    '5L Baklajka': '🧴 <strong style="color:#38bdf8;">5 Litr Baklajka</strong> — Kichik hajm, sayohat yoki ofis uchun qulay. Narxi: ~4,000 – 6,000 so\'m.',
    'Pompa': '⚙️ <strong style="color:#38bdf8;">Suv pompasi</strong> — Kalyonkaga o\'rnatiladigan elektr nasos. Narxi: ~25,000 – 40,000 so\'m.'
};

function updateWaterDesc() {
    const val = document.getElementById('waterType').value;
    const el = document.getElementById('waterTypeDesc');
    if (el) el.innerHTML = WATER_DESCS[val] || '';
}

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
        txt.textContent = 'SUV KERAK';

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

// ─── SCREENS ─────────────────────────────────────────
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
        `🚗 Suvchi: ${order.driverName || 'Suvchi'} kelayapti!`;

    const callBtn = document.getElementById('callDriverBtn');
    if (callBtn && order.driverPhone) callBtn.href = `tel:${order.driverPhone}`;

    setTimeout(() => initArrivingMap(order), 200);

    if (order.driverId) startChat(order.id);
}

// ─── MAPS ─────────────────────────────────────────────
function initPendingMap(order) {
    if (userMap) { userMap.remove(); userMap = null; }
    userMap = L.map('pendingMap', { zoomControl: false, dragging: false })
        .setView([order.lat, order.lng], 15);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', subdomains: 'abcd', maxZoom: 19
    }).addTo(userMap);

    const html = `<div style="width:42px;height:42px;background:linear-gradient(135deg,#0ea5e9,#06b6d4);
      border-radius:50%;display:flex;align-items:center;justify-content:center;
      font-size:1.4rem;border:3px solid rgba(255,255,255,0.6);
      box-shadow:0 0 20px rgba(14,165,233,0.8), 0 0 60px rgba(14,165,233,0.3);">💧</div>`;
    L.marker([order.lat, order.lng],
        { icon: L.divIcon({ html, className: '', iconAnchor: [21, 21] }) }).addTo(userMap);

    L.circle([order.lat, order.lng], { radius: 100, color: '#0ea5e9', fillOpacity: 0.08, weight: 2 })
        .addTo(userMap);
}

function initArrivingMap(order) {
    if (userMap) { userMap.remove(); userMap = null; }
    driverMapMarker = null;

    userMap = L.map('arrivingMap', { zoomControl: true })
        .setView([order.lat, order.lng], 14);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© CartoDB', subdomains: 'abcd', maxZoom: 19
    }).addTo(userMap);

    L.marker([order.lat, order.lng], {
        icon: L.divIcon({
            html: `<div style="width:44px;height:44px;background:linear-gradient(135deg,#0ea5e9,#06b6d4);
              border-radius:50%;display:flex;align-items:center;justify-content:center;
              font-size:1.4rem;border:3px solid white;box-shadow:0 0 20px rgba(14,165,233,0.8);">🏠</div>`,
            className: '', iconAnchor: [22, 22]
        })
    }).addTo(userMap).bindPopup('<strong>Sizning manzilingiz</strong>');

    const driverHtml = `<div style="width:46px;height:46px;
      background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:50%;
      display:flex;align-items:center;justify-content:center;font-size:1.5rem;
      border:3px solid white;box-shadow:0 0 20px rgba(34,197,94,0.8);
      animation:mapMarkerPulse 1.2s ease-in-out infinite;">🚗</div>`;

    const initLat = order.lat + 0.006;
    const initLng = order.lng + 0.006;
    driverMapMarker = L.marker([initLat, initLng], {
        icon: L.divIcon({ html: driverHtml, className: '', iconAnchor: [23, 23] })
    }).addTo(userMap).bindPopup(`<strong>${order.driverName || 'Suvchi'}</strong><br>Siz tomon kelmoqda`);

    userMap._routeLine = L.polyline([[order.lat, order.lng], [initLat, initLng]], {
        color: '#0ea5e9', weight: 3.5, opacity: 0.7, dashArray: '8,8'
    }).addTo(userMap);

    updateDistanceDisplay(order.lat, order.lng, initLat, initLng);
}

function updateDriverOnUserMap(lat, lng, orderId) {
    if (!userMap || !driverMapMarker) return;
    if (activeOrderId !== orderId && orderId) return;
    driverMapMarker.setLatLng([lat, lng]);
    const order = DB.getOrderById(activeOrderId);
    if (order && userMap._routeLine) {
        userMap._routeLine.setLatLngs([[order.lat, order.lng], [lat, lng]]);
    }
    updateDistanceDisplay(order ? order.lat : DEFAULT_LAT, order ? order.lng : DEFAULT_LNG, lat, lng);
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
    const etaMin = Math.max(1, Math.round(dist / 500));
    const etaEl = document.getElementById('driverEta');
    if (etaEl) etaEl.textContent = `~${etaMin} min`;
}

// ─── CHAT ─────────────────────────────────────────────
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
    if (!msgs || !msgs.length) {
        container.innerHTML = '<div class="chat-empty">Xabar yo\'q. Birinchi xabar yuboring!</div>';
        return;
    }
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
    }).catch(() => { });
}

function handleChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

// ─── RATING ───────────────────────────────────────────
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
        }).catch(() => { });
    }

    DB.updateOrder(orderId, { rating: { stars: _selectedStars, comment } });
    closeRatingModal();
    showToast(`⭐ ${_selectedStars} yulduz berildi! Rahmat!`, 'success');
}

// ─── CANCEL & COMPLETE ────────────────────────────────
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
    const order = DB.getOrderById(activeOrderId);
    showPaymentModal(order);
}

// ─── PAYMENT MODAL ────────────────────────────────────
function showPaymentModal(order) {
    if (!order) return;
    const modal = document.getElementById('paymentModal');
    if (!modal) return;
    modal.dataset.orderId = order.id;

    const payType = order.paymentType || 'Naqd';
    document.getElementById('payMethodName').textContent =
        payType === 'Click' ? '💳 Click orqali' :
            payType === 'Payme' ? '📱 Payme orqali' : '💵 Naqd pul';

    const cardSection = document.getElementById('cardSection');
    const cashSection = document.getElementById('cashSection');

    if (payType === 'Click' || payType === 'Payme') {
        cardSection.classList.remove('hidden');
        cashSection.style.display = 'none';
        const allUsers = DB.getUsers();
        const driver = allUsers.find(u => u.id === order.driverId);
        const cardNum = driver && driver.cardNumber ? driver.cardNumber : '8600 — — — —';
        const cardName = driver ? driver.name : 'Suvchi';
        document.getElementById('driverCardNumber').textContent = cardNum;
        document.getElementById('driverCardName').textContent = '👤 ' + cardName;
    } else {
        cardSection.classList.add('hidden');
        cashSection.style.display = 'block';
    }

    document.getElementById('payConfirmSection').classList.remove('hidden');
    document.getElementById('payDoneSection').classList.add('hidden');
    modal.classList.remove('hidden');
}

function copyCardNumber() {
    const num = document.getElementById('driverCardNumber').textContent;
    navigator.clipboard.writeText(num).then(() => {
        showToast('📋 Karta raqami nusxalandi!', 'success', 2000);
    }).catch(() => {
        showToast('Nusxalash muvaffaqiyatsiz', 'warning');
    });
}

async function confirmPayment() {
    const modal = document.getElementById('paymentModal');
    const ordId = modal.dataset.orderId || activeOrderId;
    DB.updateOrder(ordId, { status: 'paid', paidAt: Date.now() });
    const base = window._aquagoServer;
    if (base) {
        await fetch(`${base}/api/orders/${ordId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'paid', paidAt: Date.now() })
        }).catch(() => { });
    }
    document.getElementById('payConfirmSection').classList.add('hidden');
    document.getElementById('payDoneSection').classList.remove('hidden');
    showToast('✅ To\'lov tasdiqlandi! Suvchiga xabar yuborildi.', 'success', 4000);

    setTimeout(() => {
        closePaymentModal();
        const ordIdFinal = ordId;
        activeOrderId = null;
        clearInterval(waitTimerInterval);
        closeChatPanel();
        if (userMap) { userMap.remove(); userMap = null; }
        showMain();
        setTimeout(() => showRatingModal(ordIdFinal), 800);
    }, 2000);
}

function closePaymentModal() {
    const modal = document.getElementById('paymentModal');
    if (modal) modal.classList.add('hidden');
}

// ─── ORDER WATCHER ────────────────────────────────────
function startOrderWatcher() {
    orderCheckInterval = setInterval(checkOrderStatus, 2000);
    window.addEventListener('aquago_orders_updated', checkOrderStatus);
    window.addEventListener('aquago_driver_location', e => {
        const { lat, lng } = e.detail;
        updateDriverOnUserMap(lat, lng);
    });
    window.addEventListener('aquago_message', e => {
        const msg = e.detail;
        if (msg.orderId !== activeOrderId) return;
        if (msg.senderId === currentUser.id) return;
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
    if (order.status === 'delivered') {
        const arriving = document.getElementById('arrivingScreen');
        if (!arriving.classList.contains('hidden')) {
            showToast('💧 Suvchi suv yetkazib berdi! To\'lovni tasdiqlang.', 'success', 5000);
            showPaymentModal(order);
        }
    }
    if (order.status === 'done' || order.status === 'paid') {
        const arriving = document.getElementById('arrivingScreen');
        if (arriving && !arriving.classList.contains('hidden')) {
            completeOrder();
        }
    }
}

// ─── STATS ────────────────────────────────────────────
function refreshStats() {
    const orders = DB.getUserOrders(currentUser.id);
    const totalEl = document.getElementById('totalOrders');
    const doneEl = document.getElementById('completedOrders');
    const pendEl = document.getElementById('pendingOrders');

    animateCounter(totalEl, orders.length);
    animateCounter(doneEl, orders.filter(o => ['done', 'paid'].includes(o.status)).length);
    animateCounter(pendEl, orders.filter(o => ['pending', 'accepted'].includes(o.status)).length);

    const countEl = document.getElementById('ordersCount');
    if (countEl) countEl.textContent = orders.length;
}

// ─── ORDERS LIST ──────────────────────────────────────
function renderOrdersList() {
    const container = document.getElementById('ordersList');
    const userOrders = DB.getUserOrders(currentUser.id).slice(0, 10);

    const countEl = document.getElementById('ordersCount');
    if (countEl) countEl.textContent = DB.getUserOrders(currentUser.id).length;

    if (userOrders.length === 0) {
        container.innerHTML = `<div class="empty-orders">
            <div class="empty-icon-wrap"><div class="empty-icon">📋</div></div>
            <p>Hozircha buyurtmalar yo'q</p>
            <span class="empty-sub">Birinchi buyurtmangizni bering!</span>
        </div>`;
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
              <span class="order-date">🕐 ${date}</span>
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
        paid: { icon: '✅', label: 'Bajarildi', class: 'badge-done' },
        cancelled: { icon: '❌', label: 'Bekor qilindi', class: 'badge-cancelled' },
        delivered: { icon: '📦', label: 'Yetkazildi', class: 'badge-done' }
    })[status] || { icon: '⏳', label: 'Kutilmoqda', class: 'badge-pending' };
}

// ─── QUICK ACTION HELPERS ─────────────────────────────
function showHistoryModal() { openHistoryModal(); }
function showSupportInfo() { openSupportModal(); }
function showPromoInfo() { openPromoModal(); }

// ─── HISTORY MODAL ───────────────────────────────────
let _historyFilter = 'all';
function openHistoryModal() {
    _historyFilter = 'all';
    document.getElementById('historyModal').classList.remove('hidden');
    renderHistoryList();
    renderHistoryStats();
    // reset filter tabs
    document.querySelectorAll('.hft-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('hft-all').classList.add('active');
}
function closeHistoryModal() {
    document.getElementById('historyModal').classList.add('hidden');
}
function filterHistory(filter) {
    _historyFilter = filter;
    document.querySelectorAll('.hft-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`hft-${filter}`).classList.add('active');
    renderHistoryList();
}
function renderHistoryList() {
    const container = document.getElementById('historyList');
    if (!container) return;
    let orders = DB.getUserOrders(currentUser.id);
    if (_historyFilter === 'done') orders = orders.filter(o => ['done','paid','delivered'].includes(o.status));
    else if (_historyFilter === 'cancelled') orders = orders.filter(o => o.status === 'cancelled');
    orders = orders.slice().reverse(); // newest first
    if (!orders.length) {
        container.innerHTML = '<div class="history-empty"><div style="font-size:2.5rem;margin-bottom:10px;">📭</div><p>Bu bo\'limda buyurtma yo\'q</p></div>';
        return;
    }
    container.innerHTML = orders.map((o, idx) => {
        const si = getStatusInfo(o.status);
        const date = new Date(o.createdAt).toLocaleString('uz-UZ', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const stars = o.rating ? '⭐'.repeat(o.rating.stars) : '';
        const price = o.waterType === '19L Kalyonka' ? '~13,000' : o.waterType === '5L Baklajka' ? '~5,000' : '~32,000';
        return `<div class="history-item" style="animation-delay:${idx * 0.06}s">
          <div class="hi-left">
            <div class="hi-num">#${orders.length - idx}</div>
            <div class="hi-icon">${si.icon}</div>
            <div class="hi-info">
              <strong>${o.waterType || 'Suv buyurtmasi'}</strong>
              <span class="hi-qty">📦 ${o.quantity || 1} ta · 💳 ${o.paymentType || 'Naqd'}</span>
              <span class="hi-date">${date}</span>
              ${o.driverName ? `<span class="hi-driver">🚗 ${o.driverName}</span>` : ''}
              ${stars ? `<span class="hi-stars">${stars}</span>` : ''}
            </div>
          </div>
          <div class="hi-right">
            <span class="order-status-badge ${si.class}">${si.label}</span>
            <span class="hi-price">${price} so'm</span>
          </div>
        </div>`;
    }).join('');
}
function renderHistoryStats() {
    const bar = document.getElementById('historyStatsBar');
    if (!bar) return;
    const orders = DB.getUserOrders(currentUser.id);
    const done = orders.filter(o => ['done','paid','delivered'].includes(o.status)).length;
    const cancelled = orders.filter(o => o.status === 'cancelled').length;
    const total = orders.length;
    const spend = done * 13000;
    bar.innerHTML = `
      <div class="hsb-item"><span class="hsb-num">${total}</span><span class="hsb-lab">Jami</span></div>
      <div class="hsb-item hsb-green"><span class="hsb-num">${done}</span><span class="hsb-lab">Bajarildi</span></div>
      <div class="hsb-item hsb-red"><span class="hsb-num">${cancelled}</span><span class="hsb-lab">Bekor</span></div>
      <div class="hsb-item hsb-gold"><span class="hsb-num">${spend.toLocaleString()}</span><span class="hsb-lab">Sarflandi (so'm)</span></div>`;
}

// ─── PROMO MODAL ─────────────────────────────────────
let _promoInterval = null;
function openPromoModal() {
    document.getElementById('promoModal').classList.remove('hidden');
    spawnFireworks();
    startPromoCountdown();
}
function closePromoModal() {
    document.getElementById('promoModal').classList.add('hidden');
    clearInterval(_promoInterval);
}
function startPromoCountdown() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    clearInterval(_promoInterval);
    function update() {
        const diff = Math.max(0, midnight - new Date());
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        const fmt = n => String(n).padStart(2, '0');
        const hEl = document.getElementById('pcHours');
        const mEl = document.getElementById('pcMins');
        const sEl = document.getElementById('pcSecs');
        if (hEl) hEl.textContent = fmt(h);
        if (mEl) mEl.textContent = fmt(m);
        if (sEl) sEl.textContent = fmt(s);
    }
    update();
    _promoInterval = setInterval(update, 1000);
}
function spawnFireworks() {
    const fw = document.getElementById('promoFireworks');
    if (!fw) return;
    fw.innerHTML = '';
    for (let i = 0; i < 20; i++) {
        const p = document.createElement('div');
        p.className = 'fw-particle';
        p.style.cssText = `
            left:${Math.random()*100}%; top:${Math.random()*60}%;
            animation-delay:${Math.random()*1.5}s;
            background:hsl(${Math.random()*360},80%,60%);`;
        fw.appendChild(p);
    }
}

// ─── SUPPORT MODAL ───────────────────────────────────
function openSupportModal() {
    document.getElementById('supportModal').classList.remove('hidden');
}
function closeSupportModal() {
    document.getElementById('supportModal').classList.add('hidden');
}
function toggleFaq(el) {
    const ans = el.querySelector('.faq-a');
    const ico = el.querySelector('.faq-q span');
    const open = ans.classList.contains('open');
    // close all
    document.querySelectorAll('.faq-a').forEach(a => a.classList.remove('open'));
    document.querySelectorAll('.faq-q span').forEach(s => s.textContent = '▾');
    if (!open) { ans.classList.add('open'); if (ico) ico.textContent = '▴'; }
}

// ─── QUICK REPLY ─────────────────────────────────────
function quickReply(text) {
    const input = document.getElementById('chatInput');
    if (input) { input.value = text; input.focus(); }
    sendMessage();
}

// ─── WEATHER WIDGET ──────────────────────────────────
async function initWeather() {
    const iconEl = document.getElementById('weatherIcon');
    const tempEl = document.getElementById('weatherTemp');
    const descEl = document.getElementById('weatherDesc');
    if (!iconEl) return;
    // Use Open-Meteo (free, no key)
    const lat = userLocation ? userLocation.lat : 41.1944;
    const lng = userLocation ? userLocation.lng : 61.3098;
    try {
        const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&wind_speed_unit=ms`);
        const d = await r.json();
        const cw = d.current_weather;
        const code = cw.weathercode;
        const temp = Math.round(cw.temperature);
        const icons = { 0:'☀️', 1:'🌤️', 2:'⛅', 3:'☁️', 45:'🌫️', 48:'🌫️', 51:'🌦️', 61:'🌧️', 71:'🌨️', 80:'🌧️', 95:'⛈️' };
        const descs = { 0:'Ochiq', 1:'Asosan ochiq', 2:'Bulutli', 3:'Qovoq', 45:'Tuman', 48:'Tuman', 51:'Mayda yomg\'ir', 61:'Yomg\'ir', 71:'Qor', 80:'Yomg\'ir', 95:'Momaqaldiroq' };
        const ic = Object.keys(icons).reduce((p,c) => Math.abs(c-code)<Math.abs(p-code)?c:p);
        if (iconEl) iconEl.textContent = icons[ic] || '🌡️';
        if (tempEl) tempEl.textContent = `${temp}°`;
        if (descEl) descEl.textContent = descs[ic] || 'Ob-havo';
    } catch {
        if (iconEl) iconEl.textContent = '🌡️';
        if (tempEl) tempEl.textContent = '--°';
        if (descEl) descEl.textContent = 'Ob-havo';
    }
}

// ─── HELPERS ──────────────────────────────────────────
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

// ─── TOAST ────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════
//  🏆 LOYALTY POINTS SYSTEM
// ══════════════════════════════════════════════════════
const POINTS_PER_ORDER = 10;
const LEVELS = [
    { name: "🥉 Boshlang'ich", min: 0, color: '#cd7f32' },
    { name: '🥈 Kumush',      min: 50,  color: '#94a3b8' },
    { name: '🥇 Oltin',       min: 150, color: '#f59e0b' },
    { name: '💎 Brilliant',   min: 300, color: '#38bdf8' },
    { name: '👑 Ustoz',       min: 500, color: '#a78bfa' }
];

function getUserPoints() {
    const key = `aquago_points_${currentUser?.id}`;
    return parseInt(localStorage.getItem(key) || '0');
}

function addPoints(pts) {
    const key = `aquago_points_${currentUser?.id}`;
    const prev = getUserPoints();
    const next = prev + pts;
    localStorage.setItem(key, next);
    const prevLevel = getLevelInfo(prev);
    const nextLevel = getLevelInfo(next);
    if (prevLevel.name !== nextLevel.name) {
        showToast(`🎉 ${nextLevel.name} darajasiga ko'tarildingiz!`, 'success', 5000);
        addNotification(`Level UP! ${nextLevel.name} darajasi qo'lga kiritildi! 🎊`, 'level');
    }
    updateLoyaltyUI();
}

function getLevelInfo(pts) {
    let lvl = LEVELS[0];
    LEVELS.forEach(l => { if (pts >= l.min) lvl = l; });
    return lvl;
}

function getNextLevel(pts) {
    return LEVELS.find(l => l.min > pts);
}

function updateLoyaltyUI() {
    const pts = getUserPoints();
    const lvl = getLevelInfo(pts);
    const next = getNextLevel(pts);
    const ptsEl = document.getElementById('userPoints');
    const lvlEl = document.getElementById('loyaltyLevel');
    const fillEl = document.getElementById('loyaltyFill');
    const nextEl = document.getElementById('loyaltyNext');
    if (ptsEl) ptsEl.textContent = pts.toLocaleString();
    if (lvlEl) { lvlEl.textContent = lvl.name; lvlEl.style.color = lvl.color; }
    if (fillEl && next) {
        const pct = Math.min(100, ((pts - lvl.min) / (next.min - lvl.min)) * 100);
        fillEl.style.width = pct + '%';
    } else if (fillEl) fillEl.style.width = '100%';
    if (nextEl) {
        if (next) nextEl.textContent = `${next.min - pts} ball → ${next.name}`;
        else nextEl.textContent = '👑 Eng yuqori daraja!';
    }
}

function openLoyaltyModal() {
    const pts = getUserPoints();
    const lvl = getLevelInfo(pts);
    const next = getNextLevel(pts);
    const orders = DB.getUserOrders(currentUser.id).filter(o => ['done','paid','delivered'].includes(o.status));

    const html = `
    <div style="text-align:center; margin-bottom:20px;">
        <div style="font-size:3rem; margin-bottom:8px;">${lvl.name.split(' ')[0]}</div>
        <h3 style="font-size:1.4rem;">${lvl.name}</h3>
        <div style="font-size:2rem; font-weight:900; color:#38bdf8; margin:8px 0;">${pts.toLocaleString()} ball</div>
        <p style="color:#64748b; font-size:0.85rem;">${next ? `${next.min - pts} ball qoldi → ${next.name}` : '👑 Maksimal daraja!'}</p>
    </div>
    <div class="loyalty-rewards-grid">
        ${LEVELS.map(l => `
        <div class="loyalty-reward-item ${pts >= l.min ? 'unlocked' : 'locked'}">
            <div class="lri-icon">${l.name.split(' ')[0]}</div>
            <div class="lri-name">${l.name.split(' ').slice(1).join(' ')}</div>
            <div class="lri-pts">${l.min} ball</div>
            ${pts >= l.min ? '<div class="lri-check">✅</div>' : '<div class="lri-lock">🔒</div>'}
        </div>`).join('')}
    </div>
    <div class="loyalty-history-title">📦 So'nggi buyurtmalar</div>
    <div class="loyalty-orders-mini">
        ${orders.slice(-5).reverse().map(o => `
        <div class="lom-item">
            <span>${o.waterType || 'Suv'}</span>
            <span style="color:#22c55e;">+${POINTS_PER_ORDER} ball</span>
        </div>`).join('') || '<div style="color:#64748b;text-align:center;padding:12px;">Hali bajarilgan buyurtma yo\'q</div>'}
    </div>`;

    const modal = document.getElementById('loyaltyModal');
    if (!modal) {
        // Create it on-the-fly
        const div = document.createElement('div');
        div.className = 'location-dialog hidden';
        div.id = 'loyaltyModal';
        div.innerHTML = `<div class="location-dialog-inner" style="max-width:420px; max-height:85vh; overflow-y:auto;">
            <div class="modal-glow-top"></div>
            <div class="history-modal-header">
                <div style="font-size:2rem;">🏆</div>
                <h3>AquaPoints</h3>
                <button class="history-close-btn" onclick="document.getElementById('loyaltyModal').classList.add('hidden')">✕</button>
            </div>
            <div id="loyaltyModalBody"></div>
            <button class="loc-deny-btn" onclick="document.getElementById('loyaltyModal').classList.add('hidden')" style="margin-top:12px;">Yopish</button>
        </div>`;
        document.body.appendChild(div);
    }
    document.getElementById('loyaltyModalBody').innerHTML = html;
    document.getElementById('loyaltyModal').classList.remove('hidden');
}

// ══════════════════════════════════════════════════════
//  💰 PRICE CALCULATOR
// ══════════════════════════════════════════════════════
const WATER_PRICES = {
    '19L Kalyonka': 13000,
    '5L Baklajka': 5000,
    'Pompa': 32000
};

function updatePriceCalc() {
    const wType = document.getElementById('waterType')?.value || '19L Kalyonka';
    const pType = document.getElementById('paymentType')?.value || 'Naqd';
    const qty = orderParams?.quantity || 1;
    const baseUnit = WATER_PRICES[wType] || 13000;
    const base = baseUnit * qty;
    const hasDiscount = (pType === 'Click' || pType === 'Payme');
    const discountAmt = hasDiscount ? Math.round(base * 0.1) : 0;
    const total = base - discountAmt;
    const pts = qty * POINTS_PER_ORDER;

    const baseEl = document.getElementById('pcBase');
    const discRow = document.getElementById('pcDiscountRow');
    const discEl = document.getElementById('pcDiscount');
    const totalEl = document.getElementById('pcTotal');
    const ptsEl = document.getElementById('pcPoints');

    if (baseEl) baseEl.textContent = base.toLocaleString() + " so'm";
    if (discRow) discRow.classList.toggle('hidden', !hasDiscount);
    if (discEl) discEl.textContent = '-' + discountAmt.toLocaleString() + " so'm";
    if (totalEl) totalEl.textContent = total.toLocaleString() + " so'm";
    if (ptsEl) ptsEl.textContent = pts;
}

// Override changeQuantity to also update price
const _origChangeQty = changeQuantity;
function changeQuantity(val) {
    orderParams.quantity = Math.max(1, Math.min(20, orderParams.quantity + val));
    document.getElementById('orderQuantity').textContent = orderParams.quantity;
    updatePriceCalc();
}

// ══════════════════════════════════════════════════════
//  🔔 NOTIFICATIONS CENTER
// ══════════════════════════════════════════════════════
function getNotifications() {
    const key = `aquago_notifs_${currentUser?.id}`;
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
}

function saveNotifications(arr) {
    const key = `aquago_notifs_${currentUser?.id}`;
    localStorage.setItem(key, JSON.stringify(arr.slice(-50)));
}

function addNotification(text, type = 'info') {
    const notifs = getNotifications();
    notifs.push({ id: Date.now(), text, type, read: false, ts: Date.now() });
    saveNotifications(notifs);
    updateNotifBadge();
}

function updateNotifBadge() {
    const notifs = getNotifications();
    const unread = notifs.filter(n => !n.read).length;
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (unread > 0) {
        badge.textContent = unread > 9 ? '9+' : unread;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function openNotifCenter() {
    // Mark all as read
    const notifs = getNotifications();
    notifs.forEach(n => n.read = true);
    saveNotifications(notifs);
    updateNotifBadge();
    renderNotifList();
    document.getElementById('notifCenter').classList.remove('hidden');
}

function closeNotifCenter() {
    document.getElementById('notifCenter').classList.add('hidden');
}

function clearAllNotifs() {
    saveNotifications([]);
    renderNotifList();
    updateNotifBadge();
}

function renderNotifList() {
    const container = document.getElementById('notifList');
    if (!container) return;
    const notifs = getNotifications().slice().reverse();
    if (!notifs.length) {
        container.innerHTML = '<div style="text-align:center; color:#475569; padding:30px 0; font-size:0.9rem;">🔕 Bildirishmalar yo\'q</div>';
        return;
    }
    const typeIcons = { info: 'ℹ️', success: '✅', warning: '⚠️', level: '🎖️', order: '📦' };
    container.innerHTML = notifs.map(n => {
        const ago = formatAgo(n.ts);
        return `<div class="notif-item ${n.read ? '' : 'unread'}">
            <span class="notif-item-icon">${typeIcons[n.type] || 'ℹ️'}</span>
            <div class="notif-item-body">
                <div class="notif-item-text">${n.text}</div>
                <div class="notif-item-time">${ago}</div>
            </div>
        </div>`;
    }).join('');
}

function formatAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Hozir';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} daqiqa oldin`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} soat oldin`;
    return new Date(ts).toLocaleDateString('uz-UZ');
}

// ══════════════════════════════════════════════════════
//  🌙 THEME TOGGLE (Dark / Light)
// ══════════════════════════════════════════════════════
function initTheme() {
    const saved = localStorage.getItem('aquago_theme') || 'dark';
    applyTheme(saved);
}

function toggleTheme() {
    const current = localStorage.getItem('aquago_theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('aquago_theme', next);
}

function applyTheme(theme) {
    const iconEl = document.getElementById('themeIcon');
    if (theme === 'light') {
        document.body.classList.add('light-theme');
        if (iconEl) iconEl.textContent = '☀️';
    } else {
        document.body.classList.remove('light-theme');
        if (iconEl) iconEl.textContent = '🌙';
    }
}

// ══════════════════════════════════════════════════════
//  📊 ACTIVITY CHART (7 days)
// ══════════════════════════════════════════════════════
function openActivityModal() {
    renderActivityChart();
    document.getElementById('activityModal').classList.remove('hidden');
}

function closeActivityModal() {
    document.getElementById('activityModal').classList.add('hidden');
}

function renderActivityChart() {
    const orders = DB.getUserOrders(currentUser.id);
    const days = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];
    const today = new Date();
    const counts = [];
    const labels = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dayStr = d.toDateString();
        const count = orders.filter(o => new Date(o.createdAt).toDateString() === dayStr).length;
        counts.push(count);
        labels.push(days[d.getDay()]);
    }
    const maxCount = Math.max(...counts, 1);
    const barsEl = document.getElementById('activityBars');
    const labelsEl = document.getElementById('activityLabels');
    const summaryEl = document.getElementById('activitySummary');
    if (!barsEl) return;

    barsEl.innerHTML = counts.map((c, i) => {
        const pct = (c / maxCount * 100).toFixed(1);
        const isToday = i === 6;
        return `<div class="act-bar-wrap">
            <div class="act-bar-count">${c > 0 ? c : ''}</div>
            <div class="act-bar ${isToday ? 'today' : ''}" style="height:${Math.max(pct, 4)}%;">
                <div class="act-bar-fill"></div>
            </div>
        </div>`;
    }).join('');

    if (labelsEl) labelsEl.innerHTML = labels.map((l, i) =>
        `<div class="act-label ${i === 6 ? 'today-label' : ''}">${l}</div>`
    ).join('');

    const totalWeek = counts.reduce((a, b) => a + b, 0);
    const bestDay = labels[counts.indexOf(Math.max(...counts))];
    if (summaryEl) summaryEl.innerHTML = `
        <div class="act-summary-grid">
            <div class="act-sum-item">
                <div class="act-sum-num">${totalWeek}</div>
                <div class="act-sum-lab">Bu hafta</div>
            </div>
            <div class="act-sum-item">
                <div class="act-sum-num">${counts[6]}</div>
                <div class="act-sum-lab">Bugun</div>
            </div>
            <div class="act-sum-item">
                <div class="act-sum-num">${bestDay}</div>
                <div class="act-sum-lab">Eng faol kun</div>
            </div>
            <div class="act-sum-item">
                <div class="act-sum-num">${getUserPoints()}</div>
                <div class="act-sum-lab">AquaPoints</div>
            </div>
        </div>`;
}

// ══════════════════════════════════════════════════════
//  🔁 OVERRIDE confirmOrder to add loyalty points + notif
// ══════════════════════════════════════════════════════
const _origConfirmOrder = confirmOrder;
window.addEventListener('aquago_order_completed', (e) => {
    addPoints(POINTS_PER_ORDER);
    addNotification(`✅ Buyurtma bajarildi! +${POINTS_PER_ORDER} AquaPoint qo'shildi.`, 'success');
});

// Hook into order status to add notifications
const _origCheckOrderStatus = checkOrderStatus;
let _lastOrderStatus = null;
function checkOrderStatus() {
    _origCheckOrderStatus();
    if (!activeOrderId) return;
    const order = DB.getOrderById(activeOrderId);
    if (!order) return;
    if (order.status !== _lastOrderStatus) {
        _lastOrderStatus = order.status;
        if (order.status === 'accepted') {
            addNotification(`🚗 ${order.driverName || 'Suvchi'} buyurtmangizni qabul qildi!`, 'order');
            updateNotifBadge();
        } else if (order.status === 'delivered') {
            addNotification('📦 Suvchi suv yetkazib berdi! To\'lovni tasdiqlang.', 'order');
            updateNotifBadge();
        }
    }
}

// Override initUserDashboard to init new features
const _origInitUserDashboard = initUserDashboard;
function initUserDashboard() {
    _origInitUserDashboard();
    initTheme();
    updateLoyaltyUI();
    updateNotifBadge();
    updatePriceCalc();
}
