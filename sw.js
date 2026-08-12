/* ============================================================
   sw.js — offline shell.

   Two strategies, deliberately:

   · Navigations go network-first, so a deploy is picked up the next
     time the app is opened with a signal, and falls back to the cached
     shell when there is none. Nothing here can strand the athlete on
     a stale version in February.

   · Everything else same-origin goes stale-while-revalidate: instant
     from cache, refreshed in the background for the next load.

   api.github.com is never touched. Sync decides for itself what to do
   when the network is missing, and a cached API response would be a
   lie about what is in the repo.
   ============================================================ */
"use strict";

/* Bump on deploy. Old caches are deleted on activate. */
const CACHE = "hm2027-shell-v4";

const SHELL = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/dom.js",
  "js/plan.js",
  "js/store.js",
  "js/paces.js",
  "js/views/week.js",
  "js/views/season.js",
  "js/views/paces.js",
  "js/views/playbook.js",
  "data/plan.json",
  "data/playbook.md",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* cache:"reload" so installing a new worker cannot pick the old
       files back out of the HTTP cache. */
    await cache.addAll(SHELL.map(path => new Request(path, { cache:"reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if(request.method !== "GET") return;

  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;   // GitHub API and anything else: straight through

  if(request.mode === "navigate"){
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

async function networkFirst(request){
  const cache = await caches.open(CACHE);
  try{
    const response = await fetch(request);
    if(response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err){
    return (await cache.match(request)) ||
           (await cache.match("./")) ||
           (await cache.match("index.html")) ||
           offline();
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if(response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if(cached){
    /* Do not let the page wait on the refresh, but do not drop it either. */
    return cached;
  }
  return (await network) || offline();
}

function offline(){
  return new Response("Offline and not cached.", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type":"text/plain" }
  });
}
