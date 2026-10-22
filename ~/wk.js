const swpath = self.location.pathname;
const basepath = swpath.substring(0, swpath.lastIndexOf('/') + 1);
const rootpath = basepath.replace(/~\/$/, '');

importScripts(rootpath + 'sjv2/controller/controller.sw.js');

setTimeout(async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) client.postMessage({ $controller$swrevive: {} });
}, 100);

var abDomains = [];

function adblocked(url) {
   try {
      var u = decodeURIComponent(url.toString());
      return abDomains.some(domain => u.includes(domain));
   } catch (e) {
      return false;
   }
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

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await loadAb();
        await self.clients.claim();
    })());
});

var localpages = new Set(["/chat.html","/study.html","/settings.html","/apps.html","/bookmarks.html","/newtab.html","/music.html","/watch.html","/account.html"]);

async function reviveclients() {
    var clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < clients.length; i++) clients[i].postMessage({ $controller$swrevive: {} });
}

function waitroute(e) {
    return new Promise(function(resolve) {
        var start = Date.now();
        (function loop() {
            if ($mizuController.shouldRoute(e)) return resolve(true);
            if (Date.now() - start > 2000) return resolve(false);
            setTimeout(loop, 50);
        })();
    });
}

addEventListener("fetch", (e) => {
    try {
        if (e.request.destination !== 'document' && !e.request.url.includes('favicon') && adblocked(e.request.url)) {
            e.respondWith(new Response(null, { status: 204 }));
            return;
        }
    } catch (err) {}

    var url = new URL(e.request.url);
    if (url.origin === self.location.origin && localpages.has(url.pathname)) return;

    if ($mizuController.shouldRoute(e)) {
        e.respondWith($mizuController.route(e));
        return;
    }

    if (url.origin === self.location.origin && url.pathname.startsWith(basepath + 'mizu/')) {
        e.respondWith((async () => {
            await reviveclients();
            if (await waitroute(e)) return $mizuController.route(e);
            return fetch(e.request);
        })());
    }
});

setInterval(loadAb, 300000);
