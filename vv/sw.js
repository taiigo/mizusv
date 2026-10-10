/*global MizuServiceWorker,__mizu$config*/
const swpath = self.location.pathname;
const basepath = swpath.substring(0, swpath.lastIndexOf('/') + 1);
const rootpath = basepath.replace(/vv\/$/, '');
importScripts(rootpath + 'vv/mizu.bundle.js');
importScripts(rootpath + 'vv/mizu.config.js');
importScripts(__mizu$config.sw || (rootpath + 'vv/mizu.sw.js'));

const uv = new MizuServiceWorker();
var abDomains = [];

function abDecode(url) {
    try {
        if (typeof __mizu$config !== 'undefined' && typeof __mizu$config.decodeUrl === 'function') {
            var prefix = __mizu$config.prefix;
            var path = url;
            try { path = new URL(url).pathname; } catch (e) {}
            if (path.startsWith(prefix)) {
                var encoded = path.slice(prefix.length);
                var decoded = __mizu$config.decodeUrl(encoded);
                if (decoded) return decoded;
            }
        }
    } catch (e) {}
    return url;
}

function abMatch(url) {
    var check = abDecode(url);
    for (var i = 0; i < abDomains.length; i++) {
        if (check.includes(abDomains[i])) return true;
    }
    return false;
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

async function handleRequest(event) {
    var url = event.request.url;
    if (!url.includes('favicon') && abMatch(url)) {
        return new Response(null, { status: 204 });
    }
    if (uv.route(event)) {
        return await uv.fetch(event);
    }
    return await fetch(event.request);
}

self.addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event));
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'keepalive') return;
});

setInterval(loadAb, 300000);
setInterval(function() {
    self.clients.matchAll({ includeUncontrolled: true }).catch(function() {});
}, 20000);