const swpath = self.location.pathname;
const basepath = swpath.substring(0, swpath.lastIndexOf('/') + 1);
self.basepath = basepath;
const rootpath = basepath.replace(/mizu\/$/, '');

self.$mizu = {
   files: {
       wasm: rootpath + "storage/browser/mizu.wasm.wasm",
       sync: rootpath + "storage/browser/mizu.sync.js",
   }
};

importScripts(rootpath + "storage/browser/mizu.all.js");

const { MizuServiceWorker } = $mizuLoadWorker();
const scramjet = new MizuServiceWorker({
    prefix: basepath
});

var abDomains = [];

function adblocked(url) {
   return abDomains.some(domain => decodeURIComponent(url.toString()).includes(domain));
}

async function loadAb() {
    try {
        var res = await fetch(rootpath + 'storage/js/filters/adblock.txt');
        var text = await res.text();
        abDomains = [];
        var lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (line && !line.startsWith('##')) abDomains.push(line);
        }
    } catch (e) {}
}

self.addEventListener('install', (event) => {
    event.waitUntil(loadAb());
    self.skipWaiting();
});

self.addEventListener('activate', async function(e) {
    await loadAb();
    e.waitUntil(self.clients.claim());
});

let wisp = { url: null, servers: [], autoswitch: true };

function ping(target) {
   return new Promise(resolve => {
       const start = Date.now();
       try {
           const ws = new WebSocket(target);
           const kill = setTimeout(() => { try { ws.close(); } catch {} resolve({ target, ok: false, ms: null }); }, 3000);
           ws.onopen = () => { clearTimeout(kill); try { ws.close(); } catch {} resolve({ target, ok: true, ms: Date.now() - start }); };
           ws.onerror = () => { clearTimeout(kill); resolve({ target, ok: false, ms: null }); };
       } catch { resolve({ target, ok: false, ms: null }); }
   });
}

function broadcast(msg) {
   self.clients.matchAll().then(clients => clients.forEach(c => c.postMessage(msg)));
}

async function check() {
   if (!wisp.autoswitch || !wisp.servers?.length) return;
   const results = await Promise.all(wisp.servers.map(s => ping(s.url)));
   const currentalive = results.find(r => r.target === wisp.url)?.ok;
   if (!currentalive) {
       const best = results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)[0];
       if (best) {
           wisp.url = best.target;
           broadcast({ 
               type: 'wisp', 
               url: best.target, 
               name: wisp.servers.find(s => s.url === best.target)?.name || 'Server', 
               ms: best.ms 
           });
       }
   }
}

self.addEventListener("message", ({ data }) => {
   if (data.type === "config") {
       if (data.wispurl) wisp.url = data.wispurl;
       if (data.servers?.length) { wisp.servers = data.servers; if (wisp.autoswitch) setTimeout(check, 500); }
       if (typeof data.autoswitch !== 'undefined') wisp.autoswitch = data.autoswitch;
   } else if (data.type === "ping") {
       ping(wisp.url).then(result => broadcast({ type: 'pong', ...result }));
   }
});

self.addEventListener("fetch", event => {
   if (event.request.destination !== 'document' && !event.request.url.includes('favicon') && adblocked(event.request.url)) {
       event.respondWith(new Response(null, { status: 204 }));
       return;
   }
   event.respondWith((async () => {
       await scramjet.loadConfig();
       if (scramjet.route(event)) return scramjet.fetch(event);
       return fetch(event.request);
   })());
});

setInterval(loadAb, 300000);