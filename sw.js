'use strict';
/* Texel 웹 버전 서비스 워커: <img src="/mc/..."> 같은 주소를 가로채서
   열려 있는 Texel 페이지(web-api.js)에게 파일 내용을 물어보고 돌려준다. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('message', e => { if (e.data === 'claim') self.clients.claim(); });

const BASE = new URL('mc/', self.registration.scope).pathname;

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || !u.pathname.startsWith(BASE)) return;
  e.respondWith(serve(e, u));
});

async function pageFor(e) {
  const c = e.clientId && await self.clients.get(e.clientId);
  if (c) return c;
  const all = await self.clients.matchAll({ type: 'window' });
  return all[0] || null;
}

async function serve(e, u) {
  const page = await pageFor(e);
  if (!page) return new Response('no page', { status: 503 });
  const parts = u.pathname.slice(BASE.length).split('/').filter(Boolean).map(decodeURIComponent);
  const kind = parts.shift();
  const r = await new Promise(res => {
    const ch = new MessageChannel();
    const t = setTimeout(() => res(null), 120000);
    ch.port1.onmessage = m => { clearTimeout(t); res(m.data); };
    page.postMessage({ type: 'mc', kind, parts }, [ch.port2]);
  });
  if (!r || !r.ok) return new Response(r && r.error || 'not found', { status: 404 });
  return new Response(r.data, { headers: { 'content-type': r.type, 'cache-control': 'no-store' } });
}
