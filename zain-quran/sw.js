const VERSION="zain-quran-v1";
const STATIC=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION&&k!=="zain-quran-audio"&&k!=="zain-quran-text").map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=="GET")return;
 if(u.hostname==="everyayah.com"){
   e.respondWith(caches.open("zain-quran-audio").then(async c=>(await c.match(e.request))||fetch(e.request)));return;
 }
 if(u.hostname==="api.alquran.cloud"){
   e.respondWith(caches.open("zain-quran-text").then(async c=>{
     try{const r=await fetch(e.request);if(r.ok)c.put(e.request,r.clone());return r;}
     catch(err){const hit=await c.match(e.request);if(hit)return hit;throw err;}
   }));return;
 }
 if(u.origin===location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
