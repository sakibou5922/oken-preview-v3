// Serves the decrypted site (stored in Cache Storage by the lock page) under <scope>/app/.
// On every page load it checks version.json; if a newer version was published, the old copy is dropped
// and the visitor is sent back to the password screen to open the new one.
// must match the lock page: an unlock that is not remembered stays open while in use and closes after this much idle time
const META = "lock.json";
const IDLE_MS = 30 * 60 * 1000;
const PREFIX = "oken-v3-";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  // Next 16 checks links with HEAD before prefetching them, so answer HEAD as well as GET
  if (!["GET", "HEAD"].includes(e.request.method) || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname + "app/")) return;
  e.respondWith(serve(url, e.request, scope));
});

async function latestVersion(scope) {
  try {
    const r = await fetch(new URL("version.json", scope), { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()).id || null;
  } catch {
    return null; // offline: keep using what this device has
  }
}

// Is this decrypted copy still allowed to open? A not-remembered one gets 30 more minutes on each page load.
async function stillOpen(name, scope, extend) {
  const cache = await caches.open(name);
  const key = new URL(META, scope).href;
  let meta = null;
  try {
    const res = await cache.match(key);
    meta = res ? await res.json() : null;
  } catch {
    meta = null;
  }
  if (!meta) return false;
  if (meta.keep === true) return true;
  if (!(Date.now() < meta.until)) return false;
  if (extend) {
    await cache.put(key, new Response(JSON.stringify({ keep: false, until: Date.now() + IDLE_MS }), { headers: { "content-type": "application/json" } }));
  }
  return true;
}

async function serve(url, req, scope) {
  let names = (await caches.keys()).filter((k) => k.startsWith(PREFIX));
  if (req.mode === "navigate") {
    const latest = await latestVersion(scope);
    if (latest) {
      const stale = names.filter((k) => k !== PREFIX + latest);
      await Promise.all(stale.map((k) => caches.delete(k)));
      names = names.filter((k) => k === PREFIX + latest);
    }
  }
  const open = [];
  for (const name of names) {
    if (await stillOpen(name, scope, req.mode === "navigate")) open.push(name);
    else await caches.delete(name);
  }
  names = open;
  const candidates = [url.pathname];
  if (url.pathname.endsWith("/")) candidates.push(url.pathname + "index.html");
  else if (!/\.[a-z0-9]+$/i.test(url.pathname)) candidates.push(url.pathname + "/index.html");
  for (const name of names) {
    const cache = await caches.open(name);
    for (const p of candidates) {
      const hit = await cache.match(url.origin + p, { ignoreSearch: true });
      if (hit) return req.method === "HEAD" ? new Response(null, { status: hit.status, headers: hit.headers }) : hit;
    }
  }
  // not unlocked on this device, timed out, or an older version: back to the password screen
  if (req.mode === "navigate") return Response.redirect(scope.href, 302);
  return new Response("", { status: 404 });
}
