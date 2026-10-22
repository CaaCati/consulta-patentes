// Service worker de la app.
// VERSION la reemplaza GitHub Actions por el commit en cada publicación: al cambiar este archivo,
// el celular detecta la versión nueva, la instala y la app se recarga sola.
const VERSION = "__VERSION__";
const CACHE = `transito-${VERSION}`;
const ARCHIVOS = [
  "./",
  `config.js?v=${VERSION}`,
  `lector.js?v=${VERSION}`,
  `app.js?v=${VERSION}`,
  "logo.png",
  "logo-blanco.png",
  "icono-192.png",
  "icono-512.png",
  "manifest.webmanifest",
];
// Librerías y fuentes externas: tienen versión fija, se pueden guardar
const EXTERNOS = ["cdn.jsdelivr.net", "cdn.sheetjs.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith("transito-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // La página: siempre primero de la red (así trae la versión nueva); sin señal, la guardada
  if (req.mode === "navigate") {
    ev.respondWith(
      fetch(req, { cache: "no-cache" })
        .then((r) => { const copia = r.clone(); caches.open(CACHE).then((c) => c.put("./", copia)); return r; })
        .catch(() => caches.match("./")),
    );
    return;
  }

  // Archivos propios: de la caché de esta versión
  if (url.origin === self.location.origin) {
    ev.respondWith(caches.match(req).then((r) => r || fetch(req)));
    return;
  }

  // CDN y fuentes: caché y se refresca en segundo plano
  if (EXTERNOS.includes(url.hostname)) {
    ev.respondWith(
      caches.open(CACHE).then((c) => c.match(req).then((guardada) => {
        const red = fetch(req).then((r) => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => guardada);
        return guardada || red;
      })),
    );
  }
  // Supabase (datos y login): nunca se guarda, siempre va a la red
});
