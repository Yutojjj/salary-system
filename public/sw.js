self.addEventListener('install', (e) => {
  console.log('[ServiceWorker] Installed');
  self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  // ネットワークを優先し、繋がらない時は簡易的なオフライン応答を返す
  e.respondWith(
    fetch(e.request).catch(() => new Response('アプリは現在オフラインですが起動可能です。'))
  );
});