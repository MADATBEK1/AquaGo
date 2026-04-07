// AquaGo Service Worker v10 - Har doim yangi versiya yuklanadi
const CACHE_NAME = 'aquago-v10';
const STATIC_ASSETS = [
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
    '/manifest.json'
];

// O'rnatish - faqat static fayllarni keshla
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Darhol yangi versiyani ishga tushir
    self.skipWaiting();
});

// Faollashtirish - eski keshlarni o'chir
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch - HTML va API uchun NETWORK FIRST, static uchun cache
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);

    // API so'rovlari - faqat network
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/.netlify/')) {
        e.respondWith(
            fetch(e.request).catch(() => new Response('{"error":"offline"}', {
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }

    // HTML sahifalar - NETWORK FIRST (har doim yangi versiya)
    if (e.request.destination === 'document' || 
        url.pathname.endsWith('.html') || 
        url.pathname === '/') {
        e.respondWith(
            fetch(e.request, { cache: 'no-cache' })
                .then(response => response)
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // JS va CSS fayllar - NETWORK FIRST (yangi deploy keyin yangilansin)
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        e.respondWith(
            fetch(e.request, { cache: 'no-cache' })
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Boshqa static fayllar - cache first
    e.respondWith(
        caches.match(e.request).then(cached => {
            return cached || fetch(e.request);
        })
    );
});
