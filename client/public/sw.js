/*
 * Service worker KOFI — mode hors-ligne léger, pensé pour les petits forfaits data.
 *
 * - Fichiers de l’application (/assets/*, empreinte dans le nom) : servis depuis le cache, jamais retéléchargés.
 * - Pages : réseau d’abord, coquille en cache si le réseau manque (l’application s’ouvre hors connexion).
 * - Catalogue public (catalog.search, catalog.professional, catalog.categories) : réseau d’abord,
 *   dernière version consultée si le réseau manque.
 * - Tout le reste de l’API (créneaux, réservations, compte, espaces pro et admin) : réseau uniquement.
 *   Des créneaux ou des données personnelles périmés seraient trompeurs, et rien de personnel
 *   n’est stocké sur un téléphone éventuellement partagé.
 */
const VERSION = "kofi-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const CATALOG = `${VERSION}-catalog`;
const CATALOG_PROCEDURES = new Set(["catalog.search", "catalog.professional", "catalog.categories"]);
const MAX_CATALOG_ENTRIES = 60;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isCatalogRequest(url) {
  if (!url.pathname.startsWith("/api/trpc/")) return false;
  const procedures = decodeURIComponent(url.pathname.slice("/api/trpc/".length)).split(",");
  return procedures.length > 0 && procedures.every((name) => CATALOG_PROCEDURES.has(name));
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)));
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(fallbackUrl ?? request, response.clone());
      if (cacheName === CATALOG) trimCache(CATALOG, MAX_CATALOG_ENTRIES);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackUrl ?? request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Toutes les routes de l’application partagent la même coquille HTML.
    event.respondWith(networkFirst(request, SHELL, "/"));
  } else if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  } else if (isCatalogRequest(url)) {
    event.respondWith(networkFirst(request, CATALOG));
  }
  // Sinon : comportement réseau normal, sans cache.
});
