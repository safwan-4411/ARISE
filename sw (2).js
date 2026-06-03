const VERSION = "arise-v3";
const SHELL = ["./","./index.html","./styles.css","./app.js","./supabase-config.js","./manifest.json","./icon.svg"];
self.addEventListener("install",(e)=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate",(e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch",(e)=>{
  const{request:r}=e;
  if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.hostname.includes("supabase.co")||u.hostname.includes("googleapis")||u.hostname.includes("gstatic")||u.hostname.includes("jsdelivr"))return;
  if(u.origin===location.origin){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{
      if(res.ok){const c=res.clone();caches.open(VERSION).then(ca=>ca.put(r,c));}
      return res;
    }).catch(()=>caches.match("./index.html"))));
  }
});
