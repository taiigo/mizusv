var sjv2ready = false;
var sjtransport = null;
var sjcontroller = null;
var sjinit = null;

async function regsw(path) {
    var reg = await navigator.serviceWorker.getRegistration("/~/");
    if (!reg) {
        reg = await navigator.serviceWorker.register(path, { scope: "/~/" });
    }
    if (!reg.active) {
        await new Promise(function(resolve) {
            if (reg.active) return resolve();
            var done = false;
            var onactive = function() {
                if (done) return;
                done = true;
                resolve();
            };
            reg.addEventListener('updatefound', function() {
                var w = reg.installing;
                if (!w) return;
                w.addEventListener('statechange', function() {
                    if (w.state === 'activated') onactive();
                });
            });
            var w = reg.installing || reg.waiting;
            if (w) w.addEventListener('statechange', function() {
                if (w.state === 'activated') onactive();
            });
        });
    }
    var sw = reg.active;
    if (!sw) throw new Error("no active sjv2 service worker");
    return sw;
}

function frameplugin(tab) {
    var onchange = function(url, title) {
        try {
            if (url) {
                tab._realUrl = url;
                if (typeof updatetab === "function") updatetab(tab, url);
            }
            if (typeof title === "string" && title && title !== tab.pageTitle) {
                tab.pageTitle = title;
                if (typeof rendertabs === "function") rendertabs();
            }
        } catch (e) {}
    };

    var watcher = new $mizuController.ManagedPlugin("sjv2-url-watcher", []);
    watcher.install = function(frame) {
        $mizuController.ManagedPlugin.prototype.install.call(this, frame);
        var self = this;

        this.tap(frame.hooks.init.post, function(s) {
            if (!s.isTopLevel) return;

            var report = function() {
                var url = null, title = null;
                try { url = s.client.url.href; } catch (e) {}
                try { title = s.window.document.title; } catch (e) {}
                onchange(url, title);
            };
            report();

            try {
                self.tap(s.client.hooks.lifecycle.navigate, function(c, b) {
                    var u = b && b.url ? (b.url.href || b.url) : null;
                    var t = null;
                    try { t = s.window.document.title; } catch (e) {}
                    onchange(u, t);
                });
            } catch (e) {}

            try {
                s.window.addEventListener("hashchange", report, { capture: true });
            } catch (e) {}

            try {
                var last = "";
                setInterval(function() {
                    var url = null, title = null;
                    try { url = s.client.url.href; } catch (e) {}
                    try { title = s.window.document.title; } catch (e) {}
                    var sig = (url || "") + "|" + (title || "");
                    if (sig !== last) { last = sig; onchange(url, title); }
                }, 1500);
            } catch (e) {}
        });
    };
    return watcher;
}

function guardplugin() {
    var plugin = new $mizuController.ManagedPlugin("frame-guards", []);
    plugin.install = function(frame) {
        $mizuController.ManagedPlugin.prototype.install.call(this, frame);
        this.tap(frame.hooks.fetch.intercept, function(context, props) {
            try {
                var u = context.parsed.url;
                if (u.pathname === "/undefined" || u.pathname.endsWith("/undefined")) {
                    props.response = {
                        body: "",
                        status: 302,
                        statusText: "Found",
                        headers: $mizu.MizuHeaders.fromRawHeaders([["Location", u.origin + "/"]])
                    };
                    return;
                }
                if (context.parsed.destination !== "document") return;
                var target = new URL("/?goto=" + encodeURIComponent(u.href), location.origin);
                props.response = {
                    body: "",
                    status: 302,
                    statusText: "Found",
                    headers: $mizu.MizuHeaders.fromRawHeaders([["Location", String(target)]])
                };
            } catch (e) {}
        });
    };
    return plugin;
}

function sjctx() {
    return {
        config: sjcontroller.mizuConfig,
        prefix: new URL(sjcontroller.prefix, location.href),
        cookieJar: sjcontroller.cookieJar,
        interface: {
            codecEncode: sjcontroller.config.codec.encode,
            codecDecode: sjcontroller.config.codec.decode
        }
    };
}

async function doinit() {
    if (typeof $mizu === "undefined" || typeof $mizuController === "undefined")
        throw new Error("scramjet libs not loaded");
    if (typeof self.EpoxyTransport === "undefined" || !self.EpoxyTransport.default)
        throw new Error("epoxy transport not loaded");

    var sw = await regsw("/~/sw.js");

    var wispUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host +
        (localStorage.getItem("warp") === "tor" ? "/tor/" :
         localStorage.getItem("warp") === "true" ? "/warp/" : "/wisp/");

    sjtransport = new (self.EpoxyTransport.default)({ wisp: wispUrl, basePath: "/" });
    await sjtransport.init();

    sjcontroller = new $mizuController.Controller({
        serviceworker: sw,
        transport: sjtransport
    });
    await sjcontroller.wait();

    sjcontroller.encodeUrl = function(url) {
        try {
            return $mizu.rewriteUrl(url, sjctx(), {
                origin: new URL(location.href),
                base: new URL(location.href)
            });
        } catch (e) { return url; }
    };
    sjcontroller.decodeUrl = function(url) {
        try {
            var result = $mizu.unrewriteUrl(url, sjctx());
            if (result && result.startsWith('http')) return result;
        } catch (e) {}
        return url;
    };

    setInterval(function() {
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'keepalive' });
        }
        if (scramjet && typeof scramjet.encodeUrl === 'function') {
            fetch(scramjet.encodeUrl('https://www.google.com/favicon.ico'), { mode: 'same-origin' }).catch(function() {});
        }
    }, 20000);

    scramjet = sjcontroller;
    sjv2ready = true;
}

async function initsjv2() {
    if (sjv2ready) return;
    if (sjinit) return sjinit;
    sjinit = Promise.race([
        doinit(),
        new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error("sjv2 init timeout (12s)")); }, 12000);
        })
    ]).catch(function(e) {
        console.error("scramjet v2 init failed:", e);
        scramjet = null;
        sjinit = null;
    });
    return sjinit;
}

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/~/sw.js", { scope: "/~/" }).catch(function(err) {
        console.error("sw registration failed:", err);
    });
}

window.initsjv2 = initsjv2;
window.frameplugin = frameplugin;
window.guardplugin = guardplugin;
