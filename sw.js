/* Service worker do site de transporte.
   Serve só para o navegador reconhecer o site como instalável.
   Não guarda nada em cache de propósito: a posição dos ônibus precisa ser sempre ao vivo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {}); // tudo vai direto para a internet
