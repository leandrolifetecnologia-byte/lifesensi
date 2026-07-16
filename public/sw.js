// Service worker do supervisório LifeSense.
// - App shell: cache-first (abre instantâneo, funciona offline)
// - /api/metam: network-first com fallback para o cache (offline mostra a
//   última leitura conhecida em vez de tela de erro)

const VERSION = "v3";
const SHELL_CACHE = `lifesense-shell-${VERSION}`;
const DATA_CACHE = `lifesense-data-${VERSION}`;

const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/faturas.js",
  "/manifest.webmanifest",
  "/brand/icon-dark-bg.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll falha inteiro se um item falhar; tolera ausências
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Dados da API: sempre tenta a rede primeiro, cai no cache se offline.
  if (url.pathname.startsWith("/api/metam")) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Navegação: rede primeiro, fallback para o shell em cache.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match("/index.html") || caches.match("/"))
    );
    return;
  }

  // Estáticos (inclui Chart.js do CDN): cache-first, revalidando em segundo plano.
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
