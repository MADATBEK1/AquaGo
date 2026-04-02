/* ===================================================
   AquaGo – Driver Dashboard Logic  (v3 – Navigation)
   =================================================== */

let currentDriver = null;
let driverMap = null;
let driverMarker = null;
let orderMarkers = {};
let driverLocation = null;
let isOnline = false;
let activeOrderId = null;
let activeOrderTimer = null;
let activeOrderSecs = 0;
let alertTimer = null;
let pollInterval = null;
let pendingAlertId = null;
let currentWaterStock = 40;

// Navigation state
let navWatchId = null;          // GPS watchPosition ID
let navRouteLine = null;        // Leaflet polyline (route)
let navActive = false;          // Is navigation mode on?
let navDestination = null;      // { lat, lng }
let navUpdateTimer = null;      // interval for nav panel refresh
let lastHeading = 0;            // last known heading (degrees)

const DEFAULT_LAT = 41.1944;
const DEFAULT_LNG = 61.3098;

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    currentDriver = DB.getCurrentUser();
    if (!currentDriver || currentDriver.role !== 'driver') {
        window.location.href = 'index.html';
        return;
    }
    initDriverDashboard();
});

function initDriverDashboard() {
    document.getElementById('driverNavName').textContent = currentDriver.name;
    refreshDriverStats();
    initDriverMap();
    startGPSWatch();
    initDriverWidgets();   // ⭐ NEW WIDGETS

    pollInterval = setInterval(checkForNewOrders, 1000);

    window.addEventListener('storage', (e) => {
        if (e.key === 'aquago_orders') {
            const orders = JSON.parse(e.newValue || '[]');
            handleOrdersUpdate(orders);
        }
    });

    window.addEventListener('aquago_orders_updated', (e) => {
        handleOrdersUpdate(e.detail || []);
    });

    showExistingOrdersOnMap();
}

// ============================================================
// MAP
// ============================================================
function initDriverMap() {
    driverMap = L.map('driverMap', {
        center: [DEFAULT_LAT, DEFAULT_LNG],
        zoom: 14,
        zoomControl: true,
        attributionControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(driverMap);

    updateDriverMarker(DEFAULT_LAT, DEFAULT_LNG, 0);
}

function updateDriverMarker(lat, lng, heading = 0) {
    lastHeading = heading;
    // Rotating car icon based on heading
    const html = `
    <div style="
      width:48px; height:48px;
      background: linear-gradient(135deg, #22c55e, #16a34a);
      border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size: 1.6rem;
      border: 3px solid white;
      box-shadow: 0 4px 18px rgba(34,197,94,0.7);
      transform: rotate(${heading}deg);
      transition: transform 0.5s ease;
    ">🚗</div>
  `;
    if (driverMarker) {
        driverMarker.setLatLng([lat, lng]);
        // Update icon rotation
        driverMarker.setIcon(L.divIcon({ html, className: '', iconAnchor: [24, 24] }));
    } else {
        driverMarker = L.marker([lat, lng], {
            icon: L.divIcon({ html, className: '', iconAnchor: [24, 24] }),
            zIndexOffset: 1000
        }).addTo(driverMap).bindPopup('<strong>Mening joylashuvim</strong>');
    }
}

function addOrderMarkerToMap(order) {
    if (orderMarkers[order.id]) return;
    if (order.status !== 'pending') return;

    const html = `
    <div style="
      width:48px; height:48px;
      background: linear-gradient(135deg, #0ea5e9, #0284c7);
      border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      font-size: 1.5rem;
      border: 3px solid white;
      box-shadow: 0 4px 18px rgba(14,165,233,0.9);
      animation: mapMarkerPulse 1.2s ease-in-out infinite;
    ">💧</div>
  `;

    const marker = L.marker([order.lat, order.lng], {
        icon: L.divIcon({ html, className: '', iconAnchor: [24, 24] })
    }).addTo(driverMap);

    marker.bindPopup(`
    <div style="color:#f0f9ff; padding:6px; min-width:160px;">
      <strong style="font-size:1rem;">👤 ${order.userName}</strong><br/>
      <span style="color:#94a3b8; font-size:0.85rem;">📱 ${order.userPhone}</span><br/>
      <span style="color:#94a3b8; font-size:0.82rem;">🕐 ${formatTimeAgo(order.createdAt)}</span><br/>
      <button onclick="document.getElementById('acceptBtn').click()"
        style="margin-top:8px;padding:6px 12px;background:#22c55e;border:none;border-radius:6px;color:white;font-weight:700;cursor:pointer;width:100%;">
        ✅ Qabul qilish
      </button>
    </div>
  `);

    marker.on('click', () => {
        if (isOnline) handleOrdersUpdate(DB.getOrders());
    });

    orderMarkers[order.id] = marker;

    const dLat = driverLocation ? driverLocation.lat : DEFAULT_LAT;
    const dLng = driverLocation ? driverLocation.lng : DEFAULT_LNG;
    const bounds = L.latLngBounds([dLat, dLng], [order.lat, order.lng]);
    driverMap.fitBounds(bounds, { padding: [80, 80] });
}

function removeOrderMarker(orderId) {
    if (orderMarkers[orderId]) {
        driverMap.removeLayer(orderMarkers[orderId]);
        delete orderMarkers[orderId];
    }
}

function showExistingOrdersOnMap() {
    const pending = DB.getPendingOrders();
    pending.forEach(o => addOrderMarkerToMap(o));
}

// ============================================================
// GPS – Continuous tracking (watchPosition)
// ============================================================
function startGPSWatch() {
    if (!navigator.geolocation) {
        driverLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG };
        return;
    }

    // Get initial position quickly
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            driverLocation = { lat, lng };
            updateDriverMarker(lat, lng, lastHeading);
            driverMap.setView([lat, lng], 15);
        },
        () => { driverLocation = { lat: DEFAULT_LAT, lng: DEFAULT_LNG }; },
        { timeout: 8000, enableHighAccuracy: true }
    );

    // Continuous watch
    navWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude: lat, longitude: lng, heading, accuracy } = pos.coords;
            const prevLat = driverLocation ? driverLocation.lat : lat;
            const prevLng = driverLocation ? driverLocation.lng : lng;

            driverLocation = { lat, lng, accuracy };

            // Calculate heading from movement if device doesn't provide it
            const computedHeading = (heading != null && !isNaN(heading))
                ? heading
                : calcBearing(prevLat, prevLng, lat, lng);

            updateDriverMarker(lat, lng, computedHeading);

            // 📡 Broadcast location to server → user sees driver moving
            broadcastDriverLocation(lat, lng, computedHeading);

            // If navigation is active – update route & panel
            if (navActive && navDestination) {
                updateNavigation(lat, lng);
                driverMap.setView([lat, lng], driverMap.getZoom(), { animate: true, duration: 0.5 });
            }
        },
        (err) => { console.warn('GPS error:', err.message); },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

}

function stopGPSWatch() {
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }
}

// ============================================================
// NAVIGATION – Start
// ============================================================
function startNavigation(order) {
    if (!order) return;
    navDestination = { lat: order.lat, lng: order.lng };
    navActive = true;

    // Draw initial route
    drawRoute();

    // Show navigation HUD panel
    showNavPanel(order);

    showToast('🧭 Navigatsiya boshlandi!', 'success', 3000);
}

function stopNavigation() {
    navActive = false;
    navDestination = null;

    // Remove route line
    if (navRouteLine) {
        driverMap.removeLayer(navRouteLine);
        navRouteLine = null;
    }

    // Hide nav panel
    hideNavPanel();

    clearInterval(navUpdateTimer);
    showToast('🛑 Navigatsiya to\'xtatildi', 'info', 2000);
}

// ============================================================
// NAVIGATION – Route drawing via OSRM
// ============================================================
async function drawRoute() {
    if (!navDestination || !driverLocation) return;

    const { lat: dLat, lng: dLng } = driverLocation;
    const { lat: oLat, lng: oLng } = navDestination;

    // OSRM public routing API (free, no key needed)
    const url = `https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${oLng},${oLat}?overview=full&geometries=geojson`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.code === 'Ok' && data.routes.length > 0) {
            const route = data.routes[0];
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            const distanceM = route.distance;   // meters
            const durationS = route.duration;   // seconds

            // Remove old route
            if (navRouteLine) driverMap.removeLayer(navRouteLine);

            // Animated dashed route line
            navRouteLine = L.polyline(coords, {
                color: '#0ea5e9',
                weight: 5,
                opacity: 0.9,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(driverMap);

            // Second layer — animated dashes
            L.polyline(coords, {
                color: '#38bdf8',
                weight: 5,
                opacity: 0.6,
                dashArray: '12, 16',
                dashOffset: '0',
            }).addTo(driverMap);

            updateNavHUD(distanceM, durationS);
            return { distanceM, durationS };
        }
    } catch (e) {
        // Fallback: straight line
        drawFallbackRoute();
    }
}

function drawFallbackRoute() {
    if (!driverLocation || !navDestination) return;
    if (navRouteLine) driverMap.removeLayer(navRouteLine);
    navRouteLine = L.polyline(
        [[driverLocation.lat, driverLocation.lng], [navDestination.lat, navDestination.lng]],
        { color: '#0ea5e9', weight: 4, opacity: 0.85, dashArray: '10, 8' }
    ).addTo(driverMap);

    const dist = haversine(driverLocation.lat, driverLocation.lng, navDestination.lat, navDestination.lng);
    const eta = dist / 0.4; // ~40 km/h average
    updateNavHUD(dist * 1000, eta * 3600);
}

// Called on every GPS update during navigation
function updateNavigation(lat, lng) {
    if (!navDestination) return;
    const distM = haversine(lat, lng, navDestination.lat, navDestination.lng) * 1000;

    // Arrived? (within 30 meters)
    if (distM < 30) {
        showToast('🎉 Manzilga yetib keldingiz!', 'success', 6000);
        stopNavigation();
        return;
    }

    // Redraw route every ~50 meters of movement
    if (distM % 50 < 10) drawRoute();

    // Update HUD with straight-line distance while route loads
    const etaSec = (distM / 1000) / 0.4 * 3600;
    updateNavHUD(distM, etaSec);
}

// ============================================================
// NAVIGATION HUD Panel (overlay on map)
// ============================================================
function showNavPanel(order) {
    // Remove existing
    const existing = document.getElementById('navPanel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'navPanel';
    panel.innerHTML = `
      <div class="nav-hud">
        <div class="nav-hud-header">
          <div class="nav-hud-icon">🧭</div>
          <div class="nav-hud-title">Navigatsiya</div>
          <button class="nav-hud-close" onclick="stopNavigation()">✕</button>
        </div>
        <div class="nav-hud-body">
          <div class="nav-dist-row">
            <div class="nav-dist-block">
              <span class="nav-dist-value" id="navDistVal">—</span>
              <span class="nav-dist-label">Qoldi</span>
            </div>
            <div class="nav-arrow" id="navArrow">⬆️</div>
            <div class="nav-dist-block">
              <span class="nav-dist-value" id="navEtaVal">—</span>
              <span class="nav-dist-label">Taxminiy vaqt</span>
            </div>
          </div>
          <div class="nav-dest-label">📍 ${order.userName} manzili</div>
          <button class="nav-open-gmaps" onclick="openGoogleMaps()">
            🗺️ Google Maps da ochish
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
}

function hideNavPanel() {
    const p = document.getElementById('navPanel');
    if (p) p.remove();
}

function updateNavHUD(distanceM, durationSec) {
    const distEl = document.getElementById('navDistVal');
    const etaEl = document.getElementById('navEtaVal');
    const arrowEl = document.getElementById('navArrow');

    if (!distEl) return;

    // Format distance
    if (distanceM < 1000) {
        distEl.textContent = `${Math.round(distanceM)} m`;
    } else {
        distEl.textContent = `${(distanceM / 1000).toFixed(1)} km`;
    }

    // Format ETA
    const mins = Math.round(durationSec / 60);
    if (mins < 1) {
        etaEl.textContent = '< 1 min';
    } else if (mins < 60) {
        etaEl.textContent = `${mins} min`;
    } else {
        etaEl.textContent = `${Math.floor(mins / 60)}s ${mins % 60}m`;
    }

    // Direction arrow based on bearing to destination
    if (driverLocation && navDestination) {
        const bearing = calcBearing(
            driverLocation.lat, driverLocation.lng,
            navDestination.lat, navDestination.lng
        );
        if (arrowEl) arrowEl.style.transform = `rotate(${bearing}deg)`;
    }
}

// ============================================================
// GEOLOCATION (one-time)
// ============================================================
function centerOnMyLocation() {
    const lat = driverLocation ? driverLocation.lat : DEFAULT_LAT;
    const lng = driverLocation ? driverLocation.lng : DEFAULT_LNG;
    driverMap.setView([lat, lng], 16, { animate: true });
    if (navActive) driverMap.setView([lat, lng], driverMap.getZoom());
}

// ============================================================
// ONLINE STATUS
// ============================================================
function toggleOnlineStatus(checked) {
    isOnline = checked;
    const label = document.getElementById('onlineLabel');
    label.textContent = isOnline ? 'Onlayn' : 'Oflayn';
    label.classList.toggle('online', isOnline);

    const overlay = document.getElementById('offlineOverlay');
    overlay.style.display = isOnline ? 'none' : 'flex';

    if (isOnline) {
        showToast('🟢 Siz onlayn bo\'ldingiz!', 'success');
        checkForNewOrders();
    } else {
        showToast('⭕ Oflayn bo\'ldingiz', 'warning');
        clearAlertPopup();
    }
}

function goOnline() {
    const toggle = document.getElementById('onlineToggle');
    toggle.checked = true;
    toggleOnlineStatus(true);
}

// ============================================================
// ORDER POLLING
// ============================================================
function checkForNewOrders() {
    const pending = DB.getPendingOrders();
    pending.forEach(o => addOrderMarkerToMap(o));

    Object.keys(orderMarkers).forEach(id => {
        const order = DB.getOrderById(id);
        if (!order || order.status !== 'pending') removeOrderMarker(id);
    });

    refreshDriverStats();

    if (!isOnline) return;
    if (activeOrderId) return;
    if (pending.length === 0) {
        if (pendingAlertId && !DB.getOrderById(pendingAlertId)) {
            clearAlertPopup();
            pendingAlertId = null;
        }
        return;
    }

    const firstOrder = pending[0];
    if (pendingAlertId === firstOrder.id) return;
    pendingAlertId = firstOrder.id;
    showNewOrderAlert(firstOrder);
}

function handleOrdersUpdate(orders) {
    const pending = orders.filter(o => o.status === 'pending');
    pending.forEach(o => addOrderMarkerToMap(o));
    if (!isOnline || activeOrderId) {
        // Check if active order got paid
        if (activeOrderId) {
            const active = orders.find(o => o.id === activeOrderId);
            if (active && active.status === 'paid') {
                // Mijoz to'lov qildi!
                showToast('💰 PUL TUSHDI! Mijoz to\'lov qildi!', 'success', 8000);
                showNotifPopup('💰 Pul tushdi!', 'Mijoz to\'lovni tasdiqladi');
                _finishDeliveryAfterPayment(activeOrderId);
            }
        }
        return;
    }
    if (pending.length === 0) return;
    const firstOrder = pending[0];
    if (pendingAlertId === firstOrder.id) return;
    pendingAlertId = firstOrder.id;
    showNewOrderAlert(firstOrder);
}

// ============================================================
// ALERT UI
// ============================================================
function showNewOrderAlert(order) {
    document.getElementById('alertUserName').textContent = order.userName;
    document.getElementById('alertUserDist').textContent = calcDist(order);
    document.getElementById('alertAddress').textContent = order.address || '📍 Joylashuv aniqlangan';
    document.getElementById('newOrderAlert').classList.remove('hidden');
    document.getElementById('ordersEmpty').classList.add('hidden');
    document.getElementById('newOrderBadge').classList.remove('hidden');

    showNotifPopup('🔔 Yangi buyurtma keldi!', `${order.userName} suv buyurdi`);
    playBeep();

    let timerPct = 100;
    const timerBar = document.getElementById('alertTimerBar');
    timerBar.style.width = '100%';
    clearInterval(alertTimer);

    alertTimer = setInterval(() => {
        timerPct -= (100 / 60);
        timerBar.style.width = Math.max(0, timerPct) + '%';
        if (timerPct <= 0) {
            clearInterval(alertTimer);
            rejectOrder();
        }
    }, 1000);
}

function clearAlertPopup() {
    document.getElementById('newOrderAlert').classList.add('hidden');
    document.getElementById('newOrderBadge').classList.add('hidden');
    clearInterval(alertTimer);
    if (!activeOrderId) {
        document.getElementById('ordersEmpty').classList.remove('hidden');
    }
}

// ============================================================
// ACCEPT ORDER
// ============================================================
function acceptOrder() {
    if (!pendingAlertId) return;

    clearInterval(alertTimer);
    document.getElementById('newOrderAlert').classList.add('hidden');
    document.getElementById('newOrderBadge').classList.add('hidden');
    closeNotif();

    const updated = DB.updateOrder(pendingAlertId, {
        status: 'accepted',
        driverId: currentDriver.id,
        driverName: currentDriver.name,
        acceptedAt: Date.now()
    });

    if (!updated) {
        showToast('❌ Buyurtma topilmadi', 'error');
        pendingAlertId = null;
        return;
    }

    activeOrderId = pendingAlertId;
    pendingAlertId = null;

    const order = DB.getOrderById(activeOrderId);

    document.getElementById('activeUserName').textContent = order.userName;
    document.getElementById('activeUserPhone').textContent = order.userPhone || '—';
    document.getElementById('activeOrderCard').classList.remove('hidden');
    document.getElementById('ordersEmpty').classList.add('hidden');

    activeOrderSecs = 0;
    clearInterval(activeOrderTimer);
    activeOrderTimer = setInterval(() => {
        activeOrderSecs++;
        document.getElementById('activeOrderTime').textContent = formatTime(activeOrderSecs);
    }, 1000);

    refreshDriverStats();

    // 🧭 Auto-start navigation
    startNavigation(order);

    showToast(`✅ Qabul qilindi! Navigatsiya boshlandi 🧭`, 'success', 5000);
}

// ============================================================
// REJECT ORDER
// ============================================================
function rejectOrder() {
    const orderId = pendingAlertId;
    clearAlertPopup();
    pendingAlertId = null;
    if (orderId) removeOrderMarker(orderId);
    showToast('❌ Buyurtma rad etildi', 'warning');
}

// ============================================================
// COMPLETE DELIVERY
// ============================================================
function completeDelivery() {
    if (!activeOrderId) return;

    // Stop navigation first
    if (navActive) stopNavigation();

    // 'delivered' holatiga o'tkazish — mijoz to'lovini kutish
    DB.updateOrder(activeOrderId, { status: 'delivered', deliveredAt: Date.now() });

    // Serverga yuborish
    const base = window._aquagoServer;
    if (base) {
        fetch(`${base}/api/orders/${activeOrderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'delivered', deliveredAt: Date.now() })
        }).catch(() => { });
    }

    showToast('💧 Suv yetkazildi! Mijoz to\'lov qilishini kuting...', 'info', 6000);

    // Tugma o'chir
    const completeBtn = document.querySelector('.complete-delivery-btn[onclick="completeDelivery()"]');
    if (completeBtn) {
        completeBtn.textContent = '⏳ To\'lov kutilmoqda...';
        completeBtn.disabled = true;
        completeBtn.style.opacity = '0.6';
    }
}

function _finishDeliveryAfterPayment(ordId) {
    const users = DB.getUsers();
    const idx = users.findIndex(u => u.id === currentDriver.id);
    if (idx !== -1) {
        users[idx].completedCount = (users[idx].completedCount || 0) + 1;
        users[idx].todayEarnings = (users[idx].todayEarnings || 0) + 15000;
        DB.saveUsers(users);
        currentDriver = users[idx];
        DB.setCurrentUser(currentDriver);
    }

    currentWaterStock--;
    if (currentWaterStock <= 0) {
        currentWaterStock = 0;
        toggleOnlineStatus(false);
        document.getElementById('onlineToggle').checked = false;
        showToast('⚠️ Suv tugadi! Onlayn rejimdan chiqdingiz.', 'warning', 6000);
    }

    removeOrderMarker(ordId);
    activeOrderId = null;
    clearInterval(activeOrderTimer);

    document.getElementById('activeOrderCard').classList.add('hidden');
    document.getElementById('ordersEmpty').classList.remove('hidden');

    refreshDriverStats();
    showToast('🎉 Bajarildi! Pul tushdi! +15,000 so\'m qo\'shildi 💰', 'success', 6000);
}

// ============================================================
// STATS
// ============================================================
function refreshDriverStats() {
    const myOrders = DB.getOrders().filter(o => o.driverId === currentDriver.id);
    const today = new Date().toDateString();
    const todayDone = myOrders.filter(o =>
        (o.status === 'done' || o.status === 'paid') && new Date(o.completedAt || o.createdAt).toDateString() === today
    );
    const pending = DB.getPendingOrders();

    document.getElementById('dCompleted').textContent = todayDone.length;
    document.getElementById('dPending').textContent = pending.length;
    document.getElementById('dTodayEarnings').textContent = (todayDone.length * 15000).toLocaleString();

    const waterStockEl = document.getElementById('dWaterStock');
    if (waterStockEl) waterStockEl.textContent = currentWaterStock;

    // Update new widgets
    updateWaterGauge();
    renderWeeklyChart();
    renderDriverRating();
    renderInsights(myOrders);
}

// ============================================================
// NEW WIDGETS
// ============================================================
function initDriverWidgets() {
    renderWeeklyChart();
    renderDriverRating();
    updateWaterGauge();
    renderInsights(DB.getOrders().filter(o => o.driverId === currentDriver.id));
}

function renderInsights(myOrders) {
    const done = myOrders.filter(o => o.status === 'done' || o.status === 'paid');
    // Average delivery time in minutes
    const withTime = done.filter(o => o.acceptedAt && o.completedAt);
    const avgMin = withTime.length
        ? Math.round(withTime.reduce((s, o) => s + (o.completedAt - o.acceptedAt), 0) / withTime.length / 60000)
        : null;
    const avgEl = document.getElementById('dAvgTime');
    if (avgEl) avgEl.textContent = avgMin !== null ? avgMin : '—';

    // Average star rating
    const rated = myOrders.filter(o => o.rating && o.rating.stars);
    const avgRating = rated.length
        ? (rated.reduce((s, o) => s + o.rating.stars, 0) / rated.length).toFixed(1)
        : null;
    const ratEl = document.getElementById('dAvgRating');
    if (ratEl) ratEl.textContent = avgRating !== null ? avgRating : '—';
}

function renderWeeklyChart() {
    const barsEl = document.getElementById('wcBars');
    const totalEl = document.getElementById('wcWeekTotal');
    if (!barsEl) return;

    const days = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sha', 'Ya'];
    const today = new Date();
    const todayIdx = (today.getDay() + 6) % 7; // Monday=0
    const allOrders = DB.getOrders().filter(o => o.driverId === currentDriver.id && (o.status === 'done' || o.status === 'paid'));

    // Build earnings per day for this week (Mon–Sun)
    const weekData = days.map((_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - todayIdx + i);
        const dayStr = d.toDateString();
        const dayOrders = allOrders.filter(o => new Date(o.completedAt || o.createdAt).toDateString() === dayStr);
        return dayOrders.length * 15000;
    });

    const max = Math.max(...weekData, 15000);
    const weekTotal = weekData.reduce((a, b) => a + b, 0);
    if (totalEl) totalEl.textContent = weekTotal.toLocaleString() + ' so\'m';

    barsEl.innerHTML = weekData.map((val, i) => {
        const pct = Math.max(4, Math.round((val / max) * 100));
        const isToday = i === todayIdx;
        const label = val > 0 ? (val >= 1000 ? Math.round(val/1000) + 'k' : val) : '';
        return `<div class="wc-bar-wrap">
            <span class="wc-bar-val">${label}</span>
            <div class="wc-bar${isToday ? ' today' : ''}" style="height:${pct}%;" title="${val.toLocaleString()} so'm"></div>
            <span class="wc-day${isToday ? ' today-label' : ''}">${days[i]}</span>
        </div>`;
    }).join('');
}

function renderDriverRating() {
    const scoreEl = document.getElementById('drScoreNum');
    const starsEl = document.getElementById('drStars');
    const countEl = document.getElementById('drCount');
    const barsEl  = document.getElementById('drBarsEl');
    if (!scoreEl) return;

    const myOrders = DB.getOrders().filter(o => o.driverId === currentDriver.id);
    const rated = myOrders.filter(o => o.rating && o.rating.stars);
    if (!rated.length) {
        scoreEl.textContent = '—'; starsEl.textContent = '☆☆☆☆☆';
        countEl.textContent = 'Baholashlar yo\'q'; barsEl.innerHTML = '';
        return;
    }
    const avg = rated.reduce((s, o) => s + o.rating.stars, 0) / rated.length;
    scoreEl.textContent = avg.toFixed(1);
    // Stars rendering
    const full = Math.round(avg);
    starsEl.innerHTML = [1,2,3,4,5].map(n => `<span class="dr-star">${n <= full ? '⭐' : '☆'}</span>`).join('');
    countEl.textContent = `${rated.length} ta baholash`;

    // Rating distribution bars
    const dist = [5,4,3,2,1].map(star => ({
        star, count: rated.filter(o => o.rating.stars === star).length
    }));
    barsEl.innerHTML = dist.map(d => {
        const pct = rated.length ? Math.round((d.count / rated.length) * 100) : 0;
        return `<div class="dr-bar-row">
            <span class="dr-bar-label">${d.star}</span>
            <div class="dr-bar-track"><div class="dr-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
}

function updateWaterGauge() {
    const fill = document.getElementById('wgFill');
    const val  = document.getElementById('wgVal');
    const pct  = document.getElementById('wgPct');
    const MAX  = 40;
    const percent = Math.round((currentWaterStock / MAX) * 100);
    if (fill) {
        fill.style.width = percent + '%';
        fill.classList.toggle('low', percent < 25);
    }
    if (val) val.textContent = `${currentWaterStock} / ${MAX}`;
    if (pct) pct.textContent = percent + '%';
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function showNotifPopup(title, msg) {
    document.getElementById('notifTitle').textContent = title;
    document.getElementById('notifMsg').textContent = msg;
    const popup = document.getElementById('notifPopup');
    popup.classList.remove('hidden', 'removing');
    setTimeout(() => closeNotif(), 10000);
}

function closeNotif() {
    const popup = document.getElementById('notifPopup');
    popup.classList.add('removing');
    setTimeout(() => popup.classList.add('hidden'), 300);
}

// ============================================================
// LOGOUT
// ============================================================
function logout() {
    stopNavigation();
    stopGPSWatch();
    clearInterval(pollInterval);
    clearInterval(activeOrderTimer);
    clearInterval(alertTimer);
    DB.clearCurrentUser();
    window.location.href = 'index.html';
}

// ============================================================
// TOAST (ULTRA PREMIUM)
// ============================================================
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Haptic feedback (vibro) if supported on mobile
    if (navigator.vibrate) {
        navigator.vibrate(type === 'success' ? [30, 50, 30] : type === 'error' ? [50, 100, 50] : 40);
    }

    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Injecting dynamic styles to make it ultra-premium
    toast.style.cssText = `
        position: relative;
        overflow: hidden;
        background: rgba(15, 23, 42, 0.75);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-left: 4px solid ${colors[type] || colors.info};
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5), 0 0 20px ${colors[type]}30;
        padding: 16px 20px;
        margin-bottom: 15px;
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 320px;
        max-width: 400px;
        transform: translateX(120%) scale(0.9);
        opacity: 0;
        transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        cursor: pointer;
    `;

    toast.innerHTML = `
        <div style="font-size: 1.6rem; filter: drop-shadow(0 0 10px ${colors[type]}80); animation: toastIconBounce 0.5s ease-out;">${icons[type] || 'ℹ️'}</div>
        <div style="flex: 1; min-width: 0;">
            <div style="color: #f8fafc; font-weight: 600; font-size: 0.95rem; font-family: 'Outfit', sans-serif; line-height: 1.4; word-wrap: break-word;">${message}</div>
        </div>
        <button class="toast-close" style="
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; 
            border-radius: 50%; width: 32px; height: 32px; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.25s; flex-shrink: 0;
        " onmouseover="this.style.background='rgba(239,68,68,0.2)'; this.style.color='#f8fafc'; this.style.transform='rotate(90deg) scale(1.1)'" 
           onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='#cbd5e1'; this.style.transform='rotate(0deg) scale(1)'"
           onclick="event.stopPropagation(); this.closest('.toast').removeToast()">✕</button>
        <div style="
            position: absolute; bottom: 0; left: 0; height: 4px; 
            background: linear-gradient(90deg, transparent, ${colors[type]}, ${colors[type]}, transparent); width: 100%;
            box-shadow: 0 0 12px ${colors[type]};
            animation: toastProgressAnim ${duration}ms linear forwards;
        "></div>
    `;

    // Ensure CSS animations exist globally
    if (!document.getElementById('toastMegaAnim')) {
        const style = document.createElement('style');
        style.id = 'toastMegaAnim';
        style.textContent = `
            @keyframes toastProgressAnim { from { width: 100%; } to { width: 0%; } }
            @keyframes toastIconBounce { 0% { transform: scale(0) rotate(-15deg); } 60% { transform: scale(1.2) rotate(10deg); } 100% { transform: scale(1) rotate(0); } }
        `;
        document.head.appendChild(style);
    }

    container.appendChild(toast);
    
    // Entry animation next frame
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0) scale(1)';
        toast.style.opacity = '1';
    });

    let timeoutId;
    
    // Custom remove function attached to element
    toast.removeToast = () => {
        toast.style.transform = 'translateX(100px) scale(0.9) translateY(-10px)';
        toast.style.opacity = '0';
        toast.style.pointerEvents = 'none';
        clearTimeout(timeoutId);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
    };

    // Tap anywhere on toast to swipe away / close
    toast.onclick = () => toast.removeToast();

    // Auto removal
    timeoutId = setTimeout(() => {
        toast.removeToast();
    }, duration);
}

// ============================================================
// HELPERS
// ============================================================
function formatTime(s) {
    return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function formatTimeAgo(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'Hozirgina';
    if (m < 60) return `${m} daqiqa oldin`;
    return `${Math.floor(m / 60)} soat oldin`;
}

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bearing from point A to point B (degrees)
function calcBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const rlat1 = lat1 * Math.PI / 180;
    const rlat2 = lat2 * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(rlat2);
    const x = Math.cos(rlat1) * Math.sin(rlat2) - Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLng);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

function calcDist(order) {
    const lat1 = driverLocation ? driverLocation.lat : DEFAULT_LAT;
    const lng1 = driverLocation ? driverLocation.lng : DEFAULT_LNG;
    const dist = haversine(lat1, lng1, order.lat, order.lng);
    return dist < 1
        ? `~${Math.round(dist * 1000)} m uzoqlikda`
        : `~${dist.toFixed(1)} km uzoqlikda`;
}

// ============================================================
// OPEN IN EXTERNAL MAP
// ============================================================
function openNavigator() {
    if (!activeOrderId) return;
    const order = DB.getOrderById(activeOrderId);
    if (order) openGoogleMaps(order.lat, order.lng);
}

function openGoogleMaps(lat, lng) {
    const order = activeOrderId ? DB.getOrderById(activeOrderId) : null;
    const oLat = lat || (order ? order.lat : DEFAULT_LAT);
    const oLng = lng || (order ? order.lng : DEFAULT_LNG);
    const dLat = driverLocation ? driverLocation.lat : DEFAULT_LAT;
    const dLng = driverLocation ? driverLocation.lng : DEFAULT_LNG;
    // Google Maps directions
    window.open(
        `https://www.google.com/maps/dir/${dLat},${dLng}/${oLat},${oLng}`,
        '_blank'
    );
}

function refillWater() {
    currentWaterStock = 40;
    refreshDriverStats();
    showToast('💧 Mashinangiz 40 ta idish suvga to\'ldirildi!', 'success');
}

// ============================================================
// DYNAMIC STYLES – animations & nav HUD
// ============================================================
const _ds = document.createElement('style');
_ds.textContent = `
  @keyframes mapMarkerPulse {
    0%,100% { transform: scale(1);    box-shadow: 0 4px 18px rgba(14,165,233,0.8); }
    50%      { transform: scale(1.15); box-shadow: 0 6px 28px rgba(14,165,233,1.0); }
  }

  /* ---- Navigation HUD ---- */
  #navPanel {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    width: calc(100% - 32px);
    max-width: 420px;
    pointer-events: auto;
    animation: navSlideUp 0.4s cubic-bezier(0.4,0,0.2,1);
  }

  @keyframes navSlideUp {
    from { opacity:0; transform: translateX(-50%) translateY(30px); }
    to   { opacity:1; transform: translateX(-50%) translateY(0); }
  }

  .nav-hud {
    background: rgba(10, 15, 30, 0.97);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(14,165,233,0.4);
    border-top: 3px solid #0ea5e9;
    border-radius: 20px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5), 0 0 30px rgba(14,165,233,0.15);
    overflow: hidden;
  }

  .nav-hud-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }

  .nav-hud-icon {
    font-size: 1.3rem;
  }

  .nav-hud-title {
    flex: 1;
    font-size: 0.95rem;
    font-weight: 700;
    color: #38bdf8;
    letter-spacing: 0.5px;
  }

  .nav-hud-close {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: none;
    background: rgba(239,68,68,0.15);
    color: #ef4444;
    cursor: pointer;
    font-size: 0.8rem;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.2s;
  }
  .nav-hud-close:hover { background: rgba(239,68,68,0.3); }

  .nav-hud-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .nav-dist-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .nav-dist-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    flex: 1;
  }

  .nav-dist-value {
    font-size: 1.8rem;
    font-weight: 800;
    color: #f0f9ff;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .nav-dist-label {
    font-size: 0.72rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .nav-arrow {
    font-size: 2.2rem;
    transition: transform 0.5s ease;
    filter: drop-shadow(0 0 8px rgba(14,165,233,0.8));
  }

  .nav-dest-label {
    font-size: 0.85rem;
    color: #94a3b8;
    text-align: center;
    padding: 8px 12px;
    background: rgba(255,255,255,0.04);
    border-radius: 10px;
    border-left: 3px solid #0ea5e9;
    text-align: left;
  }

  .nav-open-gmaps {
    padding: 10px;
    width: 100%;
    background: rgba(14,165,233,0.12);
    border: 1px solid rgba(14,165,233,0.3);
    border-radius: 12px;
    color: #38bdf8;
    font-family: 'Outfit', sans-serif;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .nav-open-gmaps:hover {
    background: rgba(14,165,233,0.22);
    transform: translateY(-1px);
  }

  /* Mobile nav panel adjustments */
  @media (max-width: 600px) {
    #navPanel {
      bottom: 12px;
      width: calc(100% - 20px);
    }
    .nav-dist-value { font-size: 1.5rem; }
    .nav-arrow { font-size: 1.8rem; }
    .nav-hud-body { padding: 12px; gap: 8px; }
  }
`;
document.head.appendChild(_ds);

// ============================================================
// SOUND
// ============================================================
function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        setTimeout(() => oscillator.stop(), 400);
    } catch (e) { console.log(e); }
}


// ============================================================
// 📡 DRIVER LOCATION BROADCAST → Server → User map
// ============================================================
let _lastBroadcastLat = null;
let _lastBroadcastLng = null;

function broadcastDriverLocation(lat, lng, heading) {
    const base = window._aquagoServer;
    if (!base || !activeOrderId) return;

    // Only broadcast if moved > 5m to avoid spam
    if (_lastBroadcastLat !== null) {
        const dx = (lat - _lastBroadcastLat) * 111000;
        const dy = (lng - _lastBroadcastLng) * 111000;
        if (Math.sqrt(dx * dx + dy * dy) < 5) return;
    }
    _lastBroadcastLat = lat;
    _lastBroadcastLng = lng;

    fetch(base + '/api/driver-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            driverId: currentDriver.id,
            orderId: activeOrderId,
            lat, lng, heading,
            ts: Date.now()
        })
    }).catch(() => { });
}

// ============================================================
// 💬 DRIVER CHAT
// ============================================================
let _driverChatPolling = null;

function toggleDriverChat() {
    const panel = document.getElementById('driverChatPanel');
    if (!panel) {
        createDriverChatPanel();
        return;
    }
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        startDriverChat();
    } else {
        panel.classList.add('hidden');
        clearInterval(_driverChatPolling);
    }
}

function createDriverChatPanel() {
    const panel = document.createElement('div');
    panel.id = 'driverChatPanel';
    panel.className = 'chat-panel';
    panel.innerHTML = `
        <div class="chat-header">
            <span>💬 Mijoz bilan chat</span>
            <button class="chat-close-btn" onclick="toggleDriverChat()">✕</button>
        </div>
        <div class="chat-messages" id="driverChatMessages">
            <div class="chat-empty">Xabar yo'q</div>
        </div>
        <div class="chat-input-row">
            <input id="driverChatInput" class="chat-input" type="text"
                placeholder="Xabar yozing..." onkeydown="driverChatKey(event)" />
            <button class="chat-send-btn" onclick="sendDriverMessage()">➤</button>
        </div>`;
    document.body.appendChild(panel);
    startDriverChat();
}

function startDriverChat() {
    if (!activeOrderId) return;
    loadDriverMessages(activeOrderId);
    clearInterval(_driverChatPolling);
    _driverChatPolling = setInterval(() => loadDriverMessages(activeOrderId), 2000);
}

async function loadDriverMessages(orderId) {
    const base = window._aquagoServer;
    if (!base) return;
    try {
        const r = await fetch(`${base}/api/messages?orderId=${orderId}`);
        const msgs = await r.json();
        const container = document.getElementById('driverChatMessages');
        if (!container) return;
        container.innerHTML = msgs.map(m => {
            const isMine = m.senderId === currentDriver.id;
            return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}">
              <div class="chat-bubble">
                ${!isMine ? `<span class="chat-sender">${m.senderName}</span>` : ''}
                <p>${m.text}</p>
                <span class="chat-time">${new Date(m.ts).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>`;
        }).join('') || '<div class="chat-empty">Xabar yo\'q</div>';
        container.scrollTop = container.scrollHeight;
    } catch { }
}

async function sendDriverMessage() {
    const input = document.getElementById('driverChatInput');
    const text = input?.value.trim();
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
            senderId: currentDriver.id,
            senderName: currentDriver.name,
            senderRole: 'driver',
            receiverId: order ? order.userId : null,
            text
        })
    }).catch(() => { });
}

function driverChatKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDriverMessage(); }
}

// SSE: new message → notify driver
window.addEventListener('aquago_message', e => {
    const msg = e.detail;
    if (!activeOrderId || msg.orderId !== activeOrderId) return;
    if (msg.senderId === currentDriver.id) return;
    showToast(`💬 Mijoz: ${msg.text.slice(0, 40)}`, 'info', 4000);
    loadDriverMessages(activeOrderId);
});
