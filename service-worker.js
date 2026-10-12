/* Only the public offline page is cached; account data and API requests stay online. */
const OFFLINE_CACHE='flow-offline-v6';
self.addEventListener('install',event=>{event.waitUntil(caches.open(OFFLINE_CACHE).then(cache=>cache.add('/offline.html')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('flow-offline-')&&key!==OFFLINE_CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
async function receiveShare(request){
 const form=await request.formData(),read=(name,limit)=>typeof form.get(name)==='string'?form.get(name).slice(0,limit):'';
 const title=read('title',180),text=read('text',7500),rawUrl=read('url',1500);let url='';try{const parsed=new URL(rawUrl);if(['https:','http:'].includes(parsed.protocol))url=parsed.href;}catch{}
 if(!text.trim()&&!title.trim()&&!url)return Response.redirect(self.location.origin+'/',303);
 const id=crypto.randomUUID(),db=await new Promise((resolve,reject)=>{const r=indexedDB.open('flow-shares-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('pending',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending');store.put({id,title,text,url,createdAt:Date.now()});const cursor=store.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){if(Date.now()-row.value.createdAt>1800000)row.delete();row.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}
 return Response.redirect(self.location.origin+'/?shared='+id,303);
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
 if(url.pathname==='/share-target'&&event.request.method==='POST'){event.respondWith(receiveShare(event.request));return;}
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));
});
