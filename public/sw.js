// public/sw.js
self.addEventListener('install', (e) => {
  console.log('[ServiceWorker] Installed');
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // キャッシュはせず、常に最新のネットワークデータを取得する最小構成
});