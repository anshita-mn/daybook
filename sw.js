// Daybook offline shell: cache the app files; data always comes live from Supabase.
const CACHE="daybook-v8";
const SHELL=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","icon-180.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.hostname.endsWith("supabase.co"))return; // never cache your data
  if(e.request.mode==="navigate"){ // fresh page when online, cached when offline
    e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put("index.html",c));return r}).catch(()=>caches.match("index.html")));return;
  }
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{
    if(r.ok&&(u.origin===location.origin||/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(u.hostname))){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}
    return r;})));
});
