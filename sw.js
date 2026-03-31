// AquaGo Service Worker v2 - Offline ishlash + Landing sahifa
const CACHE_NAME = 'aquago-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/landing.html',
    '/user.html',
    '/driver.html',
    '/css/style.css',
    '/css/user.css',
    '/css/driver.css',
    '/css/landing.css',
    '/css/titlebar.css',
    '/js/auth.js',
    '/js/user.js',
    '/js/driver.js',
    '/js/storage.js',
    '/js/titlebar.js',
    '/assets/icon.png',
    '/manifest.json',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS.filter(a => !a.startsWith('http')));
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    // Network-first for API, cache-first for static
    if (e.request.url.includes('/api/')) {
        e.respondWith(fetch(e.request).catch(() => new Response('{"error":"offline"}', {
            headers: { 'Content-Type': 'application/json' }
        })));
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request).catch(() => caches.match('/index.html'));
        })
    );
});
