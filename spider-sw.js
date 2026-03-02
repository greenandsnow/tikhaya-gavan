const CACHE = 'spider-v1';
const FILES = [
  '/spider',
  '/spider.html',
  '/spider-icon-192.png',
  '/spider-icon-512.png',
  'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
