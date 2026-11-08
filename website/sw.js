// MC Combat Tiers app: lets the site open offline with the last tiers it loaded.
// Always tries the network first, so updates show up straight away.

const CACHE = "mct-v1";
const LIVE_API = "https://mc-combat-tiers-bot.alongthechaos19.workers.dev/api/players";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html", "/style.css", "/script.js", "/players.js", "/logo.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  const ours = new URL(url).origin === self.location.origin;
  if (e.request.method !== "GET" || !(ours || url.startsWith(LIVE_API))) return; // skins etc. load normally

  // Network first; keep a copy; fall back to the copy when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("/index.html"))),
  );
});
