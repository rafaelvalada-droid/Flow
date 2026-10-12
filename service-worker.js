/* Only the public offline page is cached; account data and API requests stay online. */
const OFFLINE_CACHE='flow-offline-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(OFFLINE_CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('flow-offline-')&&key!==OFFLINE_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&new URL(event.request.url).origin===self.location.origin){event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));}});
