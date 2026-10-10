const swpath = self.location.pathname;
const basepath = swpath.substring(0, swpath.lastIndexOf('/') + 1);
const rootpath = basepath.replace(/~\/$/, '');

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

// ---- RPC client to the controller ----
var channelId = null;
var port = null;
var counter = 0;
var pending = new Map();

function recieve(e) {
    var msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    var t = msg[channelId];
    if (!t || typeof t !== 'object') return;
    if (t.$type === 'response') {
        var p = pending.get(t.$token);
        if (!p) return;
        pending.delete(t.$token);
        if (t.$error !== undefined) p.reject(new Error(t.$error));
        else p.resolve(t.$data);
    }
}

function call(method, args, transfer) {
    var token = counter++;
    return new Promise(function (resolve, reject) {
        pending.set(token, { resolve: resolve, reject: reject });
        port.postMessage({ [channelId]: { $type: 'request', $method: method, $args: args, $token: token } }, transfer);
    });
}

self.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || typeof data !== 'object') return;

    if (data.$controller$init) {
        channelId = 'tabchannel-' + data.$controller$init.id;
        port = e.ports[0];
        port.addEventListener('message', recieve);
        port.start();
        call('ready', []).catch(function () {});
        return;
    }

    if (data.$sw$initRemoteTransport) {
        var tp = data.$sw$initRemoteTransport;
        call('initRemoteTransport', [tp.port], [tp.port]).catch(function () {});
        return;
    }
});

// ---- Fetch routing ----
addEventListener("fetch", (e) => {
    try {
        if (e.request.destination !== 'document' && !e.request.url.includes('favicon') && adblocked(e.request.url)) {
            e.respondWith(new Response(null, { status: 204 }));
            return;
        }
    } catch (err) {}

    var url = new URL(e.request.url);
    if (url.origin === self.location.origin && localpages.has(url.pathname)) return;

    if (port && channelId && url.origin === self.location.origin && url.pathname.startsWith('/~/mizu/')) {
        e.respondWith((async () => {
            try {
                var req = e.request;
                var body = null;
                if (req.method !== 'GET' && req.method !== 'HEAD') {
                    body = await req.arrayBuffer();
                }
                var result = await call('request', [{
                    rawUrl: req.url,
                    initialHeaders: Array.from(req.headers.entries()),
                    rawClientUrl: req.referrer || undefined,
                    rawReferrer: req.referrer || undefined,
                    rawDestination: req.destination,
                    method: req.method,
                    mode: req.mode,
                    referrer: req.referrer,
                    body: body,
                    cache: req.cache,
                    clientId: e.clientId
                }], body ? [body] : []);
                if (!result) return new Response(null, { status: 500 });
                var r = result[0];
                return new Response(r.body, {
                    status: r.status,
                    statusText: r.statusText,
                    headers: new Headers(r.headers)
                });
            } catch (err) {
                return new Response(null, { status: 500 });
            }
        })());
        return;
    }
});

setInterval(loadAb, 300000);
