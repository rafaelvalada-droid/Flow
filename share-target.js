/* Shared text stays on this device until the user confirms a demand. */
(() => {
 const NAME='flow-shares-v1',STORE='pending',KEY='flow.pending-share-id.v1';
 const database=()=>new Promise((resolve,reject)=>{const request=indexedDB.open(NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 async function initialize(){
  const params=new URLSearchParams(location.search),id=params.get('shared')||sessionStorage.getItem(KEY);
  if(!id||!/^[a-f0-9-]{36}$/i.test(id))return null;
  sessionStorage.setItem(KEY,id);
  if(params.has('shared')){params.delete('shared');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
  const db=await database();
  try{const record=await new Promise((resolve,reject)=>{const request=db.transaction(STORE).objectStore(STORE).get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});if(record&&Date.now()-record.createdAt<1800000)return record;if(record)await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});sessionStorage.removeItem(KEY);return null;}finally{db.close();}
 }
 async function discard(id){const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});if(sessionStorage.getItem(KEY)===id)sessionStorage.removeItem(KEY);}finally{db.close();}}
 globalThis.FlowShareTarget={initialize,discard};
})();
