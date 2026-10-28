// --- Supabase (Settings > API no painel do Supabase). Deixe SB_URL vazio para ver o modo demonstração.
const SB_URL = 'https://bgffdyrpavhmbsvpyitn.supabase.co';
const SB_KEY = 'sb_publishable_UjZa7ykJtFkpmXsyirHrgw_pHlNVszx'; // chave pública: pode ficar no site
const DEMO = !SB_URL;

// --- Passageiro
const POLL = 30000; // de quanto em quanto tempo o passageiro atualiza o mapa (ms)
const STALE = 60000; // sem sinal do ônibus por mais que isso => "Sem sinal" (ms)
const LIM_CHEGANDO = 150; // metros: abaixo disso aparece "Chegando"
const LIM_PERTO = 1000; // metros: abaixo disso aparece "Perto" (acima: "Longe")

// --- Mapa de fundo. Para trocar de provedor (se um dia o atual cair ou bloquear), mude só estas duas linhas.
// Endereço pedido pela política do OpenStreetMap: https://tile.openstreetmap.org/{z}/{x}/{y}.png (sem {s}).
// Exemplo CARTO escuro: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' (e acrescente subdomains: 'abcd' em L.tileLayer)
const MAPA_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPA_CREDITO = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'; // o crédito precisa ficar visível

// --- Paradas novas aparecem para quem já está com o site aberto (sem recarregar a página)
const ATUALIZAR_PARADAS = 5 * 60000; // de quanto em quanto tempo o site relê rotas e paradas (ms)

// --- Tela de carregamento (a logo fica no index.html, procure por "TROQUE A LOGO AQUI")
const SPLASH_MIN = 2500; // tempo mínimo da logo na tela (ms)
const SPLASH_MAX = 10000; // limite: some mesmo que os dados não cheguem (ms)

// --- Aviso "Instalar o app?" (PWA)
const INSTALAR_ATRASO = 3000;        // espera isso (ms) depois de abrir o site antes de perguntar
const INSTALAR_VOLTAR_EM_DIAS = 7;   // se a pessoa tocar em "Agora não", só pergunta de novo depois desses dias

// --- Motorista: detecção automática das paradas
const SEND = 10000; // de quanto em quanto tempo envia a posição (ms)
const T_LOCAL = 2 * 60000; // parado no ponto por 2 min  => aparece "No local"
const T_SAIU = 3 * 60000; // mais 3 min no local        => "Já passou" e segue para o próximo ponto
const T_SAIU_LONGA = 20 * 60000; // o mesmo, mas nas paradas longas (almoço: Iguatemi e Centro de Eventos)
const PARADAS_LONGAS = ['Iguatemi', 'Centro de Eventos do Ceará']; // nomes iguais aos da tabela "paradas"
const RAIO_PONTO = 60,
  RAIO_SAIDA = 150; // metros: "está no ponto" / "saiu do ponto" (hotéis)
const RAIO_LONGA = 250,
  RAIO_SAIDA_LONGA = 400; // idem para Iguatemi e Centro de Eventos (áreas grandes)

/* ===================================================================== */

const $ = id => document.getElementById(id);
const esc = s =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
/* ===== TELA DE CARREGAMENTO (logo) =====
   Some quando os primeiros dados chegam, mas fica pelo menos SPLASH_MIN ms e no máximo SPLASH_MAX ms.
   A logo está no HTML, dentro de <div id="splash"> (procure por "TROQUE A LOGO AQUI"). */
const t0 = Date.now();
function hideSplash() {
  const el = $('splash');
  if (!el || el.dataset.go) return;
  el.dataset.go = 1;
  setTimeout(
    () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    },
    Math.max(0, SPLASH_MIN - (Date.now() - t0)),
  );
}
setTimeout(hideSplash, SPLASH_MAX);

const rad = Math.PI / 180;
const dist = (a, b, c, d) => {
  const x =
    Math.sin(((c - a) * rad) / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
};
const fmt = m => (m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km');
const LBL = { chegando: 'Chegando', perto: 'Perto', longe: 'Longe', passou: 'Já passou' };

let routes = [],
  stopsBy = {},
  buses = [],
  offset = 0,
  mine = null;
try {
  mine = JSON.parse(localStorage.getItem('bl_stop'));
} catch (e) {}

/* ---------- dados ---------- */
const IG = ['Iguatemi', -3.755291, -38.488623],
  CE = ['Centro de Eventos do Ceará', -3.764587, -38.481188];
const HT = [
  ['Sonata de Iracema', -3.720558, -38.512348],
  ['Afago Mareiro', -3.724006, -38.509204],
  ['Holiday Inn Fortaleza', -3.722254, -38.508853],
  ['Bourbon Hotel Fortaleza', -3.725275, -38.499821],
  ['Hotel Luzeiros Fortaleza', -3.725708, -38.4976],
  ['Oásis Atlântico Imperial & Fortaleza', -3.726026, -38.496595],
  ['Praiano Hotel', -3.72621, -38.495563],
  ['Comfort Hotel Fortaleza', -3.726065, -38.489479],
  ['Gran Marquise', -3.72339, -38.48538],
];
const D_ROUTES = [
  { id: '1', nome: 'Hotéis → Centro de Eventos', cor: '#ea580c', seguinte: '2' },
  { id: '2', nome: 'Centro de Eventos → Iguatemi', cor: '#2563eb', seguinte: '3' },
  { id: '3', nome: 'Iguatemi → Centro de Eventos', cor: '#16a34a', seguinte: '4' },
  { id: '4', nome: 'Centro de Eventos → Hotéis', cor: '#9333ea', seguinte: '1' },
];
const D_STOPS = { 1: [...HT, CE], 2: [CE, IG], 3: [IG, CE], 4: [CE, ...[...HT].reverse()] };

const H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };
const sb = async (p, o = {}) => {
  const c = new AbortController(),
    t = setTimeout(() => c.abort(), 10000);
  try {
    const r = await fetch(SB_URL + '/rest/v1/' + p, { ...o, headers: H, signal: c.signal });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
};
async function load() {
  const novas = {}; // monta tudo em separado e só troca no fim: se a internet cair no meio, a tela não perde as paradas
  if (DEMO) {
    routes = D_ROUTES;
    routes.forEach(r => (novas[r.id] = D_STOPS[r.id].map((p, i) => ({ nome: p[0], lat: p[1], lng: p[2], ordem: i + 1 }))));
    stopsBy = novas;
    return;
  }
  const rs = (await sb('rotas?select=*'))
    .map(r => ({ ...r, id: String(r.id) }))
    .sort((a, b) => a.id.localeCompare(b.id, 'pt', { numeric: true }));
  (await sb('paradas?select=*&order=rota,ordem')).forEach(p =>
    (novas[String(p.rota)] = novas[String(p.rota)] || []).push({ nome: p.nome, lat: +p.lat, lng: +p.lng, ordem: +p.ordem }),
  );
  routes = rs;
  stopsBy = novas;
}

/* simulação para a demonstração */
const sim = [];
function initSim() {
  routes.forEach(r => {
    if ((stopsBy[r.id] || []).length < 2) return; // rota nova ainda sem paradas
    const s = stopsBy[r.id],
      cum = [0];
    for (let i = 1; i < s.length; i++) cum.push(cum[i - 1] + dist(s[i - 1].lat, s[i - 1].lng, s[i].lat, s[i].lng));
    (r.id === '1' ? [0, 3500] : [0]).forEach((d, k) =>
      sim.push({ id: 'Ônibus ' + r.id + String.fromCharCode(65 + k), r, s, cum, d }),
    );
  });
}
function step() {
  buses = sim.map(o => {
    o.d = (o.d + 25) % o.cum[o.cum.length - 1];
    let i = o.cum.findIndex(c => c > o.d);
    if (i < 1) i = 1;
    const f = (o.d - o.cum[i - 1]) / (o.cum[i] - o.cum[i - 1]),
      a = o.s[i - 1],
      b = o.s[i];
    return {
      motorista: o.id,
      rota: o.r.id,
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      vel: 25,
      proxima: i,
      ativo: true,
      ts: Date.now(),
    };
  });
}
async function poll() {
  if (document.hidden) return;
  try {
    const d = await rpc('buses'); // confere o status HTTP e tem limite de tempo (10 s)
    buses = (d.buses || []).map(b => ({ ...b, rota: String(b.rota), lat: +b.lat, lng: +b.lng, ts: +b.ts }));
    if (d.now) offset = Number(d.now) - Date.now(); // sem "now" o relógio viraria NaN e todos os ônibus ficariam "fora de operação"
    $('err').hidden = true;
  } catch (e) {
    $('err').hidden = false;
  }
}

/* ---------- mapa e lista de rotas ---------- */
const map = L.map('map').setView([-3.7319, -38.5267], 12);
L.tileLayer(MAPA_URL, {
  maxZoom: 19,
  attribution: MAPA_CREDITO,
}).addTo(map);
const R = {},
  mk = {};
let selRoute = '1',
  lastList = '';
/* ÍCONES DO MAPA
   - Parada: placa grande com o número da parada na cor da rota (com nenhuma rota selecionada, vira um pontinho colorido).
   - Ônibus: círculo grande com o desenho de um ônibus na cor da rota, número da rota no canto, nome do motorista embaixo
     e um brilho pulsante (para o ônibus se destacar no mapa). */
const BUS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/>' +
  '<path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/>' +
  '<circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/></svg>';
const firstName = n => String(n || '').trim().split(/\s+/)[0];
const stopIcon = (r, i, st, mini) =>
  L.divIcon({
    className: '',
    html: mini
      ? '<div class="sp mini" style="--c:' + esc(r.cor) + '"></div>'
      : '<div class="sp' +
        (st === 'passou' ? ' done' : st === 'chegando' || st === 'local' ? ' on' : '') +
        '" style="--c:' +
        esc(r.cor) +
        '">' +
        (st === 'passou' ? '✓' : BUS_SVG) + // placa de ponto de ônibus (sem número; a ordem das paradas está na lista ao lado)
        '</div>',
    iconSize: mini ? [14, 14] : [36, 50],
    iconAnchor: mini ? [7, 7] : [18, 49], // o pé da placa fica exatamente sobre a parada
  });
const pinIcon = (r, b, warn) =>
  L.divIcon({
    className: '',
    html:
      '<div class="bus-mk' + (warn ? ' sem' : '') + '" style="--c:' + esc(r.cor) + '"><span class="halo"></span>' +
      '<div class="bus-body">' + BUS_SVG + '</div><span class="bus-rt">' + esc(r.id) + '</span>' +
      '<span class="bus-nm">' + esc(firstName(b.motorista)) + '</span></div>',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });

/* Só as paradas ficam no mapa (sem a linha entre elas). Com uma rota selecionada aparecem as paradas dela;
   sem seleção, as paradas de todas as rotas aparecem como pontinhos. Com bastante zoom, o nome aparece ao lado. */
function build(refit = true) {
  routes.forEach(r => {
    const s = stopsBy[r.id] || [];
    if (!s.length) return; // (antes exigia 2 paradas: uma rota nova com 1 parada só não aparecia)
    const dots = s.map((p, i) => {
      const m = L.marker([p.lat, p.lng], { icon: stopIcon(r, i, 'sem', false), zIndexOffset: 200 });
      m._k = 'sem';
      return m;
    });
    R[r.id] = { dots, r };
  });
  paint();
  stopLabels();
  if (refit) focusRoute();
}
function paint() {
  Object.entries(R).forEach(([id, o]) => {
    const show = !selRoute || selRoute === id;
    o.dots.forEach(d => (show ? d.addTo(map) : map.removeLayer(d)));
  });
}
function stopLabels() {
  const on = map.getZoom() >= 15; // zoom de rua: mostra o nome de cada parada ao lado do ícone
  Object.values(R).forEach(o =>
    o.dots.forEach((d, i) => {
      if (d._lab === on) return;
      d._lab = on;
      d.unbindTooltip();
      d.bindTooltip(esc(stopsBy[o.r.id][i].nome), on ? { permanent: true, direction: 'right', offset: [18, -20], className: 'stop-tip' } : { direction: 'top', offset: [0, -42] });
    }),
  );
}
map.on('zoomend', stopLabels);
function focusRoute() {
  const ids = selRoute && R[selRoute] ? [selRoute] : Object.keys(R),
    pts = [];
  ids.forEach(id => (stopsBy[id] || []).forEach(p => pts.push([p.lat, p.lng])));
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.15));
}
function pick(id) { // seleciona uma rota (toque no cartão ou no ônibus)
  selRoute = id;
  paint();
  lastList = '';
  render();
  focusRoute();
}

/* ---------- proximidade ---------- */
function info(b, s, idx) {
  const p = b.proxima == null || b.proxima === '' ? NaN : Number(b.proxima); // Number(null) daria 0
  if (p > idx) return { st: 'passou', m: 0, min: 0 }; // o ônibus já passou por esta parada
  if (b.estado === 'local' && p === idx) return { st: 'local', m: 0, min: 0 }; // motorista parado nesta parada
  const k = isNaN(p) ? idx : p;
  let m = dist(b.lat, b.lng, s[k].lat, s[k].lng);
  if (!isNaN(p)) for (let i = p; i < idx; i++) m += dist(s[i].lat, s[i].lng, s[i + 1].lat, s[i + 1].lng); // distância ao longo da rota
  const v = b.vel > 2 ? b.vel : 6;
  return { st: m < LIM_CHEGANDO ? 'chegando' : m < LIM_PERTO ? 'perto' : 'longe', m, min: Math.round(m / v / 60) };
}
function stopStates(r, bs) {
  // para cada parada: o próximo ônibus a chegar, ou "já passou" se todos já passaram
  const s = stopsBy[r.id] || [];
  return s.map((p, i) => {
    if (!bs.length) return { st: 'sem' };
    let best = null;
    bs.forEach(b => {
      const x = info(b, s, i);
      if (x.st !== 'passou' && (!best || x.m < best.m)) best = x;
    });
    return best || { st: 'passou' };
  });
}
// Texto que aparece à direita de cada parada para o passageiro (sem distância e sem tempo).
// Para voltar a mostrar km e minutos, use x.m (metros) e x.min (minutos) aqui.
const TXT = {passou: 'Já passou', local: 'No local', chegando: 'Chegando', perto: 'Perto'};
const tx = x => TXT[x.st] || '';
function proximaParada(r, b) { // a próxima parada que o motorista vai fazer (ou onde ele está parado)
  if (b.proxima == null || b.proxima === '') return null;
  return (stopsBy[r.id] || [])[Number(b.proxima)] || null;
}
function state(b) {
  if (!b || !(b.ativo === true || b.ativo === 'TRUE')) return 'off';
  const age = Date.now() + offset - Number(b.ts);
  return age < STALE ? 'ok' : age < 600000 ? 'warn' : 'off';
}

function render() {
  const live = {},
    ok = {};
  buses.forEach(b => {
    const st = state(b);
    if (st === 'off') return;
    const k = String(b.rota);
    (live[k] = live[k] || []).push(b);
    if (st === 'ok') (ok[k] = ok[k] || []).push(b);
  });
  const SS = {};
  routes.forEach(r => (SS[r.id] = stopStates(r, ok[r.id] || [])));
  const html = routes
    .map(r => {
      const bs = live[r.id] || [],
        n = bs.length; // o aviso "Sem sinal" aparece só na linha de cada motorista, não no topo do cartão
      const [st, cl] = n ? [n + ' em operação', 'ok'] : ['Fora de operação', 'off'];
      const lines = bs
        .map(b => {
          return (
            '<div class="bus" role="button" tabindex="0" title="Ver no mapa" data-bus="' +
            esc(b.motorista) +
            '" style="--c:' +
            esc(r.cor) +
            '"><div class="top peq"><span class="bico">' +
            BUS_SVG +
            '</span><div class="bnome"><b>' +
            esc(b.motorista) +
            '</b>' +
            '</div>' +
            // "Sem sinal" aparece só no cartão do motorista que perdeu o sinal
            (state(b) === 'warn' ? '<span class="pill warn">Sem sinal</span>' : '') +
            '</div></div>'
          );
        })
        .join('');
      const tl =
        selRoute === r.id
          ? '<div class="tl" style="--c:' +
            esc(r.cor) +
            '">' +
            (stopsBy[r.id] || [])
              .map((p, i) => {
                const x = SS[r.id][i];
                return (
                  '<div class="st' +
                  (x.st === 'passou' ? ' done' : '') +
                  '" role="button" tabindex="0" title="Ver no mapa" data-r="' +
                  esc(r.id) +
                  '" data-i="' +
                  i +
                  '"><b>' +
                  esc(p.nome) +
                  '</b><span class="tx s-' +
                  x.st +
                  '">' +
                  tx(x) +
                  '</span></div>'
                );
              })
              .join('') +
            '</div>'
          : '';
      return (
        '<div class="rt' +
        (selRoute === r.id ? ' sel' : '') +
        '" data-id="' +
        esc(r.id) +
        '"><div class="top"><span class="dot" style="background:' +
        esc(r.cor) +
        '"></span>' +
        esc(r.id) +
        ' · ' +
        esc(r.nome) +
        '<span class="pill ' +
        cl +
        '">' +
        st +
        '</span></div>' +
        (lines || '<div class="mut mt6">Aguardando um motorista iniciar o percurso</div>') +
        tl +
        '</div>'
      );
    })
    .join('');
  if (html !== lastList) {
    $('list').innerHTML = html;
    lastList = html;
  }
  $('stA').textContent = buses.filter(b => state(b) !== 'off').length;
  $('stR').textContent = routes.length || '—';

  Object.entries(R).forEach(([id, o]) =>
    o.dots.forEach((d, i) => {
      const st = SS[id][i].st,
        mini = !selRoute,
        key = st + (mini ? 'm' : '');
      if (d._k !== key) {
        d.setIcon(stopIcon(o.r, i, st, mini));
        d._k = key;
      }
    }),
  );
  const seen = new Set();
  buses.forEach(b => {
    const st = state(b),
      id = String(b.motorista),
      r = routes.find(x => x.id === String(b.rota));
    if (st === 'off' || !r) return;
    seen.add(id);
    const ll = [Number(b.lat), Number(b.lng)];
    if (mk[id] && mk[id]._r !== r.id) {
      map.removeLayer(mk[id]);
      delete mk[id];
    }
    const warn = st === 'warn';
    if (!mk[id]) {
      mk[id] = L.marker(ll, { icon: pinIcon(r, b, warn), zIndexOffset: 1000 }) // acima das paradas
        .bindTooltip(esc(b.motorista) + ' · rota ' + esc(r.id), { direction: 'top', offset: [0, -26] })
        .addTo(map);
      mk[id]._r = r.id;
      mk[id]._w = warn;
      mk[id].on('click', () => {
        if (selRoute !== r.id) pick(r.id);
      });
    } else {
      mk[id].setLatLng(ll);
      if (mk[id]._w !== warn) {
        mk[id].setIcon(pinIcon(r, b, warn));
        mk[id]._w = warn;
      }
    }
    mk[id].setOpacity(warn ? 0.5 : selRoute && selRoute !== r.id ? 0.4 : 1);
  });
  Object.keys(mk).forEach(k => {
    if (!seen.has(k)) {
      map.removeLayer(mk[k]);
      delete mk[k];
    }
  });
}
/* Toque no nome do motorista ou de uma parada (na lista de rotas): o mapa vai até lá */
function mostrarNoMapa(lat, lng, zoom) {
  $('map').scrollIntoView({ behavior: 'smooth', block: 'center' }); // no celular, sobe até o mapa
  map.flyTo([lat, lng], Math.max(map.getZoom(), zoom), { duration: 0.8 }); // zoom de rua: motorista 16, parada 17 (mude aqui)
}
function irParaMotorista(nome) {
  const b = buses.find(x => String(x.motorista) === nome && state(x) !== 'off');
  if (!b) return;
  const rid = String(b.rota);
  if (selRoute !== rid) {
    selRoute = rid; // mostra as paradas da rota dele
    paint();
    lastList = '';
    render();
  }
  mostrarNoMapa(Number(b.lat), Number(b.lng), 16);
  setTimeout(() => mk[nome] && mk[nome].openTooltip(), 900);
}
function irParaParada(rid, i) { // hotel, Iguatemi, Centro de Eventos...
  const p = (stopsBy[rid] || [])[i],
    o = R[rid];
  if (!p || !o) return;
  if (selRoute !== rid) {
    selRoute = rid;
    paint();
    lastList = '';
    render();
  }
  mostrarNoMapa(p.lat, p.lng, 17);
  setTimeout(() => o.dots[i] && o.dots[i].openTooltip(), 900);
}
$('list').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.classList.contains('bus')) {
    e.preventDefault();
    irParaMotorista(e.target.dataset.bus);
  } else if (e.target.classList.contains('st')) {
    e.preventDefault();
    irParaParada(e.target.dataset.r, +e.target.dataset.i);
  }
});
$('list').addEventListener('click', e => {
  const bus = e.target.closest('.bus');
  if (bus) return irParaMotorista(bus.dataset.bus); // não fecha/abre a rota
  const st = e.target.closest('.st');
  if (st) return irParaParada(st.dataset.r, +st.dataset.i);
  const c = e.target.closest('.rt');
  if (!c) return;
  selRoute = selRoute === c.dataset.id ? null : c.dataset.id;
  paint();
  lastList = '';
  render();
  focusRoute();
});

/* ---------- motorista ---------- */
const longa = p => PARADAS_LONGAS.includes(p.nome);

let sess = null,
  run = null;
try {
  sess = JSON.parse(localStorage.getItem('bl_sess'));
} catch (e) {}
const rpc = async (fn, b) =>
  DEMO && (fn === 'admin_rota_salvar' || fn === 'admin_rota_excluir')
    ? demoRota(b, fn)
    : DEMO && (fn.startsWith('admin_parada') || fn === 'admin_lista' || fn === 'admin_salvar_pin')
    ? demoParada(fn, b)
    : DEMO
    ? {
        lista_motoristas: ['João Silva', 'Maria Souza'],
        login: b && b.p_pin === '1234' ? { nome: b.p_nome, token: 'demo' } : { error: 'login' },
        pos: { ok: true },
        stop: { ok: true },
        admin_login: b && b.p_senha === 'admin' ? { token: 'demo' } : { error: 'login' },
        admin_motoristas: ['João Silva', 'Maria Souza'],
        admin_salvar: { ok: true },
        admin_excluir: { ok: true },
        admin_lista: [{ nome: 'João Silva', pin: '1234' }, { nome: 'Maria Souza', pin: null }],
        admin_salvar_pin: { ok: true },
        admin_finalizar: { ok: true },
        finalizado_em: 0,
      }[fn]
    : sb('rpc/' + fn, { method: 'POST', body: JSON.stringify(b || {}) });
const rname = id => {
  const r = routes.find(x => x.id === String(id));
  return r ? r.id + ' · ' + r.nome : String(id);
};
const readSaved = () => {
  try {
    const v = JSON.parse(localStorage.getItem('bl_run'));
    return v && Date.now() - v.t < 12 * 3600000 ? v : null;
  } catch (e) {
    return null;
  }
};
const save = c => {
  try {
    localStorage.setItem('bl_run', JSON.stringify({ rota: c.rota, prox: c.prox, t: Date.now() }));
  } catch (e) {}
};
const clearSaved = () => {
  try {
    localStorage.removeItem('bl_run');
  } catch (e) {}
};
function dinfo(msg) {
  $('dInfo').textContent = msg;
  clearTimeout(dinfo.t);
  dinfo.t = setTimeout(() => {
    $('dInfo').textContent = '';
  }, 20000);
}
function gpsWarn(on) {
  if (on) $('eco').hidden = true;
  $('gpsWarn').hidden = !on;
}
function dui() {
  $('login').hidden = !!sess;
  $('panel').hidden = !sess;
  if (sess) $('hello').textContent = 'Olá, ' + sess.nome;
  const sv = sess && !run ? readSaved() : null;
  $('resume').hidden = !sv;
  if (sv) $('resumeTxt').textContent = 'Rota ' + rname(sv.rota) + '.';
  $('btnGo').textContent = run ? 'Finalizar percurso' : 'Iniciar percurso';
  $('btnGo').classList.toggle('red', !!run);
  $('btnEco').hidden = !run;
  $('rsel').disabled = !!run; // com o percurso ativo, a rota só muda sozinha (fim da rota) ou ao finalizar
  $('nxt').hidden = !run || !(stopsBy[run.rota] || []).length;
  if (run) {
    $('rsel').value = run.rota;
    nextUI(run);
  }
  $('dst').textContent = run ? 'Transmitindo a posição · rota ' + rname(run.rota) + '…' : '';
}
async function loadDrivers() {
  try {
    const nomes = (await rpc('lista_motoristas')).slice().sort((a, b) => String(a).localeCompare(String(b), 'pt', { sensitivity: 'base' })); // ordem alfabética
    $('drv').innerHTML = nomes.map(n => '<option>' + esc(n) + '</option>').join('');
  } catch (e) {}
}
function fillRsel() { // lista de rotas do motorista (mantém a escolhida)
  const v = $('rsel').value;
  $('rsel').innerHTML = routes
    .map(r => '<option value="' + esc(r.id) + '">' + esc(r.id + ' · ' + r.nome) + '</option>')
    .join('');
  if (v && routes.some(r => r.id === v)) $('rsel').value = v;
}
async function initDriver() {
  await loadDrivers();
  fillRsel();
  dui();
}
$('btnIn').onclick = async () => {
  $('lErr').textContent = '';
  try {
    const r = await rpc('login', { p_nome: $('drv').value, p_pin: $('pin').value.trim() });
    if (r.error) {
      $('lErr').textContent =
        r.error === 'bloqueado' ? 'Muitas tentativas. Aguarde 5 minutos.' : 'Motorista ou PIN incorreto.';
      return;
    }
    sess = r;
    try {
      localStorage.setItem('bl_sess', JSON.stringify(r));
    } catch (e) {}
    $('pin').value = '';
    dui();
  } catch (e) {
    $('lErr').textContent = 'Sem conexão com o servidor.';
  }
};
async function stop(msg) {
  if (!run) return;
  const cur = run;
  run = null;
  gpsWarn(false);
  $('eco').hidden = true;
  $('wlWarn').hidden = true;
  if (!msg) clearSaved(); // finalizou de propósito: não oferece "retomar"
  navigator.geolocation.clearWatch(cur.watch);
  clearInterval(cur.timer);
  try {
    cur.wake && cur.wake.release();
  } catch (e) {}
  try {
    await rpc('stop', { p_token: sess.token });
  } catch (e) {}
  $('dErr').textContent = msg || '';
  dui();
}
$('btnOut').onclick = async () => {
  await stop();
  clearSaved();
  sess = null;
  try {
    localStorage.removeItem('bl_sess');
  } catch (e) {}
  dui();
};
$('btnGo').onclick = () => (run ? stop() : startRun($('rsel').value, null));
$('btnResume').onclick = () => {
  const v = readSaved();
  if (v) {
    $('rsel').value = v.rota;
    startRun(v.rota, v.prox);
  }
};
$('btnEnd').onclick = () => stop();

/* ===== MODO ECONOMIA: tela preta (poupa bateria em telas OLED) mantendo a página ativa =====
   Abre sozinha quando o motorista inicia o percurso. Toque na tela para voltar. */
$('btnEco').onclick = () => {
  if (run) $('eco').hidden = false;
};
$('eco').onclick = () => {
  $('eco').hidden = true;
};
setInterval(() => {
  if (!run) return;
  stopLogic(run);
  nextUI(run);
  if (!$('eco').hidden)
    $('ecoSt').textContent = 'Último envio há ' + Math.round((Date.now() - run.lastOk) / 1000) + ' s';
}, 1000);

function gpsMsg(e) {
  return e.code === 1
    ? 'Permissão de localização negada. Libere a localização para este site nas configurações do navegador.'
    : e.code === 2
      ? 'GPS desligado ou sem sinal. Ligue a localização do aparelho e tente de novo.'
      : 'Não consegui obter sua posição. Vá para um local aberto, confirme que o GPS está ligado e tente de novo.';
}
async function keepAwake(cur) {
  if (!navigator.wakeLock) {
    $('wlWarn').hidden = false;
    return;
  }
  try {
    cur.wake = await navigator.wakeLock.request('screen');
    $('wlWarn').hidden = true;
  } catch (e) {
    $('wlWarn').hidden = false;
  }
}
async function startRun(rota, prox0) {
  if (run) return;
  $('dErr').textContent = '';
  if (!navigator.geolocation) {
    $('dErr').textContent = 'Este aparelho não oferece GPS.';
    return;
  }
  $('btnGo').disabled = true;
  $('dst').textContent = 'Verificando o GPS…';
  const fix = await new Promise(res =>
    navigator.geolocation.getCurrentPosition(
      p => res({ p }),
      e => res({ e }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    ),
  );
  $('btnGo').disabled = false;
  $('dst').textContent = '';
  if (fix.e) {
    $('dErr').textContent = gpsMsg(fix.e);
    return;
  }
  rota = String(rota);
  const last = { lat: fix.p.coords.latitude, lng: fix.p.coords.longitude, vel: fix.p.coords.speed };
  let prox = prox0;
  if (prox == null) {
    // começa na parada 1, ou na parada que estiver a menos de 300 m
    prox = 0;
    let bd = 300;
    (stopsBy[rota] || []).forEach((x, i) => {
      const d = dist(last.lat, last.lng, x.lat, x.lng);
      if (d < bd) {
        bd = d;
        prox = i;
      }
    });
  }
  const cur = (run = {
    rota,
    last,
    busy: false,
    prox,
    est: 'caminho',
    since: null,
    fixAt: Date.now(),
    lastOk: Date.now(),
    ini: Date.now() + offset, // hora (do servidor) em que este percurso começou
    chk: 0,
  });
  cur.watch = navigator.geolocation.watchPosition(
    p => {
      cur.last = { lat: p.coords.latitude, lng: p.coords.longitude, vel: p.coords.speed };
      cur.fixAt = Date.now();
      gpsWarn(false);
      stopLogic(cur);
      if (!cur.sent) send(cur);
    },
    e => {
      if (e.code === 1) stop(gpsMsg(e));
      else gpsWarn(true);
    },
    { enableHighAccuracy: true, maximumAge: 2000 },
  );
  cur.timer = setInterval(() => {
    if (Date.now() - cur.fixAt > 15000) gpsWarn(true);
    send(cur);
  }, SEND);
  save(cur);
  keepAwake(cur);
  dui();
  $('eco').hidden = false; // já abre a tela escura para o app continuar enviando a posição sem erro
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !run) return;
  keepAwake(run); // a tela ligada é liberada quando a página sai da frente; pede de novo
  const gap = Date.now() - run.lastOk;
  if (gap > 60000)
    dinfo(
      'O envio ficou parado por cerca de ' +
        Math.max(1, Math.round(gap / 60000)) +
        ' min (tela apagada ou app em segundo plano). Já retomou.',
    );
  send(run);
});

/* ===== PARADAS AUTOMÁTICAS (sem o motorista apertar nada) =====
   no ponto por T_LOCAL            -> estado "local"  (passageiro vê "No local")
   mais T_SAIU (ou T_SAIU_LONGA)   -> avança: "Já passou" e segue para o próximo ponto
   saiu do ponto antes disso       -> também avança (já passou) */
function seguinte(id) {
  // próxima rota do ciclo (coluna "seguinte" da tabela rotas); vazio = rota circular
  const r = routes.find(x => x.id === String(id)),
    n = r && r.seguinte != null ? String(r.seguinte).trim() : '';
  return n && n !== String(id) && routes.some(x => x.id === n) ? n : null;
}
function switchRoute(cur, id) {
  cur.rota = String(id);
  cur.prox = 0;
  cur.est = 'caminho';
  cur.since = null;
  save(cur);
  dui();
  send(cur);
}
function advance(cur) {
  const s = stopsBy[cur.rota] || [];
  if (!s.length) return;
  cur.since = null;
  cur.est = 'caminho';
  if (cur.prox >= s.length - 1) {
    // última parada: vai para a próxima rota do ciclo, se houver
    const nx = seguinte(cur.rota);
    if (nx) {
      dinfo('Rota alterada automaticamente para ' + rname(nx) + '.');
      return switchRoute(cur, nx);
    }
  }
  cur.prox = (cur.prox + 1) % s.length;
  save(cur);
  send(cur);
  nextUI(cur);
}
// Já está mais perto da parada seguinte do que desta? Serve para paradas coladas (Luzeiros → Oásis → Praiano ficam a ~115 m
// uma da outra, menos que RAIO_SAIDA): sem isto o app só percebia que o ônibus saiu depois de passar da parada seguinte.
function pertoDaProxima(cur, s, d) {
  const nx = s[cur.prox + 1];
  return !!nx && dist(cur.last.lat, cur.last.lng, nx.lat, nx.lng) < d;
}
function stopLogic(cur) {
  const s = stopsBy[cur.rota] || [],
    p = s[cur.prox];
  if (!p || !cur.last) return;
  const now = Date.now(),
    lg = longa(p),
    d = dist(cur.last.lat, cur.last.lng, p.lat, p.lng);
  if (d <= (lg ? RAIO_LONGA : RAIO_PONTO)) {
    if (!cur.since) cur.since = now;
    const t = now - cur.since;
    if (cur.est !== 'local' && t >= T_LOCAL) {
      cur.est = 'local';
      send(cur);
    }
    if (t >= T_LOCAL + (lg ? T_SAIU_LONGA : T_SAIU)) return advance(cur);
  } else if (cur.since && (d > (lg ? RAIO_SAIDA_LONGA : RAIO_SAIDA) || pertoDaProxima(cur, s, d))) {
    return advance(cur); // chegou ao ponto e já saiu
  } else if (!cur.since) {
    // passou direto por uma parada à frente (até 2 à frente)
    for (let j = cur.prox + 1; j <= Math.min(s.length - 1, cur.prox + 2); j++)
      if (dist(cur.last.lat, cur.last.lng, s[j].lat, s[j].lng) <= (longa(s[j]) ? RAIO_LONGA : RAIO_PONTO)) {
        cur.prox = j;
        cur.est = 'caminho';
        cur.since = now;
        save(cur);
        send(cur);
        break;
      }
  }
}
function nextUI(cur) {
  const s = stopsBy[cur.rota] || [],
    p = s[cur.prox];
  if (!p) return;
  const local = cur.est === 'local';
  const falta = cur.since
    ? Math.max(1, Math.ceil((T_LOCAL + (longa(p) ? T_SAIU_LONGA : T_SAIU) - (Date.now() - cur.since)) / 60000))
    : 0;
  $('nxtLbl').textContent = local ? 'No local' : 'Próxima parada';
  $('nxtName').textContent = p.nome;
  $('nxtDist').textContent = local
    ? '· segue em até ' + falta + ' min'
    : cur.last
      ? '· a ' + fmt(dist(cur.last.lat, cur.last.lng, p.lat, p.lng))
      : '';
  $('ecoTxt').textContent = 'Rota ' + rname(cur.rota) + ' · ' + (local ? 'no local: ' : 'próxima: ') + p.nome;
}
// A cada envio (10 s) confere se o administrador finalizou este percurso (função "finalizado_em", veja admin_extras.sql).
// Se sim, o app para de enviar a posição, senão o ônibus voltaria ao mapa na próxima leitura.
async function verificaFim(cur) {
  if (cur.noChk || Date.now() - cur.chk < 9000) return;
  cur.chk = Date.now();
  try {
    const t = Number(await rpc('finalizado_em', { p_nome: sess.nome }));
    if (t && t > cur.ini && run === cur) {
      stop('O administrador finalizou o seu percurso. Toque em “Iniciar percurso” se ainda estiver rodando.');
      clearSaved(); // sem botão "Retomar"
    }
  } catch (e) {
    if (String(e.message) === '404') cur.noChk = true; // função não instalada: não tenta de novo
  }
}
async function send(cur) {
  if (run !== cur || !cur.last || cur.busy || Date.now() - cur.fixAt > 15000) return;
  cur.busy = true;
  cur.sent = true;
  try {
    const r = await rpc('pos', {
      p_token: sess.token,
      p_rota: cur.rota,
      p_lat: cur.last.lat,
      p_lng: cur.last.lng,
      p_vel: cur.last.vel || 0,
      p_prox: cur.prox,
      p_est: cur.est,
    });
    if (r.error === 'token') {
      sess = null;
      try {
        localStorage.removeItem('bl_sess');
      } catch (e) {}
      stop('Sessão expirada. Entre novamente.');
    } else if (r.error === 'finalizado') {
      stop('O administrador finalizou o seu percurso. Toque em “Iniciar percurso” se ainda estiver rodando.');
      clearSaved(); // sem botão "Retomar"
    } else if (r.error) $('dErr').textContent = 'Erro ao enviar (' + r.error + ').';
    else {
      cur.lastOk = Date.now();
      $('dErr').textContent = '';
      verificaFim(cur);
    }
  } catch (e) {
    $('dErr').textContent = 'Falha ao enviar a posição; tentando de novo.';
  }
  cur.busy = false;
}

/* ---------- ÁREA DO ADMIN (abra o site com #admin no final: index.html#admin) ---------- */
// Token do admin: fica guardado só nesta aba (sessionStorage). Recarregar a página mantém você logado;
// fechar a aba ou tocar em "Sair" encerra. No servidor a sessão vale 2 horas.
let adm = (() => {
  try {
    return sessionStorage.getItem('bl_adm');
  } catch (e) {
    return null;
  }
})();
function admSet(t) {
  adm = t;
  try {
    if (t) sessionStorage.setItem('bl_adm', t);
    else sessionStorage.removeItem('bl_adm');
  } catch (e) {}
}
const amsg = (t, ok) => {
  $('aMsg').textContent = t;
  $('aMsg').classList.toggle('ok-msg', !!ok); // a cor está no style.css (.err.ok-msg)
};
function aui() {
  $('aLogin').hidden = !!adm;
  $('aPanel').hidden = !adm;
  $('aRotas').hidden = !adm;
  $('aParadas').hidden = !adm;
  if (adm) pInit();
}
const onlineDe = n => {
  const b = buses.find(x => String(x.motorista) === n && state(x) !== 'off');
  return b ? { b, warn: state(b) === 'warn' } : null;
};
async function aList() {
  if (!DEMO) await poll(); // atualiza quem está online agora
  let r = null;
  try {
    r = await rpc('admin_lista', { p_token: adm }); // nomes + PIN (função nova: veja admin_extras.sql)
  } catch (e) {}
  if (r && r.error) {
    admSet(null);
    aui();
    $('aErr').textContent = 'Sessão expirada. Entre novamente.';
    return;
  }
  const completo = Array.isArray(r);
  if (!completo) {
    // função nova ainda não instalada no banco: mostra só os nomes
    r = await rpc('admin_motoristas', { p_token: adm });
    if (r && r.error) {
      admSet(null);
      aui();
      $('aErr').textContent = 'Sessão expirada. Entre novamente.';
      return;
    }
    r = r.map(n => ({ nome: n, pin: null }));
  }
  $('aHint').textContent = completo ? '“Indisponível”: o PIN está salvo no Supabase só embaralhado (serve para conferir o login, mas não dá para mostrar). Toque em “Gerar novo PIN” ou “Editar PIN” e ele passa a aparecer aqui.' : 'Para ver os PINs e finalizar percursos, rode o arquivo admin_extras.sql no Supabase.';
  r.sort((x, y) => String(x.nome).localeCompare(String(y.nome), 'pt', { sensitivity: 'base' }));
  $('aList').innerHTML =
    r
      .map(d => {
        const on = onlineDe(String(d.nome));
        return (
          '<div class="adm-item"><div class="row"><b>' +
          esc(d.nome) +
          '</b>' +
          (on
            ? '<span class="pill ' + (on.warn ? 'warn' : 'ok') + '">' + (on.warn ? 'Sem sinal' : 'Online') + ' · rota ' + esc(on.b.rota) + '</span>'
            : '<span class="mut">Offline</span>') +
          '</div><div class="row mt6"><span class="mut">PIN: <code class="pinv" data-pin="' +
          esc(d.pin || '') +
          '">' +
          (d.pin ? '••••' : 'indisponível') +
          '</code></span>' +
          (d.pin ? '<button class="btn ghost sm" data-eye="1">👁 Ver</button>' : '') +
          '</div><div class="acts"><button class="btn ghost sm" data-edit="' +
          esc(d.nome) +
          '">Editar PIN</button><button class="btn ghost sm" data-gen="' +
          esc(d.nome) +
          '">Gerar novo PIN</button>' +
          (on ? '<button class="btn ghost sm" data-fim="' + esc(d.nome) + '">Finalizar percurso</button>' : '') +
          '<button class="btn ghost sm" data-del="' +
          esc(d.nome) +
          '">Excluir</button></div></div>'
        );
      })
      .join('') || '<p class="mut">Nenhum motorista cadastrado.</p>';
}
$('aIn').onclick = async () => {
  $('aErr').textContent = '';
  try {
    const r = await rpc('admin_login', { p_senha: $('aPass').value });
    if (r.error) {
      $('aErr').textContent = r.error === 'bloqueado' ? 'Muitas tentativas. Aguarde 15 minutos.' : 'Senha incorreta.';
      return;
    }
    admSet(r.token);
    $('aPass').value = '';
    aui();
    await aList();
  } catch (e) {
    $('aErr').textContent = 'Sem conexão com o servidor.';
  }
};
$('aOut').onclick = () => {
  admSet(null);
  aui();
};
$('aSave').onclick = async () => {
  amsg('');
  const nome = $('aNome').value.trim(),
    pin = $('aPin').value.trim();
  if (!nome) return amsg('Digite o nome do motorista.');
  if (!/^[0-9]{4,8}$/.test(pin)) return amsg('O PIN deve ter de 4 a 8 números.');
  try {
    let r,
      semPin = false;
    try {
      r = await rpc('admin_salvar_pin', { p_token: adm, p_nome: nome, p_pin: pin }); // salva e guarda o PIN para o admin poder ver
    } catch (e) {
      semPin = true;
      r = await rpc('admin_salvar', { p_token: adm, p_nome: nome, p_pin: pin }); // função nova não instalada: salva sem guardar o PIN para visualização
    }
    if (r.error === 'token') {
      admSet(null);
      aui();
      return;
    }
    if (r.error) return amsg('Erro: ' + r.error);
    $('aNome').value = '';
    $('aPin').value = '';
    if (semPin) amsg('Motorista salvo, mas o PIN não ficou visível aqui: rode o admin_extras.sql no Supabase.');
    else amsg('Motorista salvo.', true);
    await aList();
    loadDrivers();
  } catch (e) {
    amsg('Falha ao salvar. Tente de novo.');
  }
};
$('aList').addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.eye) {
    // mostra/oculta o PIN
    const c = t.parentNode.querySelector('.pinv'),
      vis = c.dataset.vis === '1';
    c.textContent = vis ? '••••' : c.dataset.pin;
    c.dataset.vis = vis ? '0' : '1';
    t.textContent = vis ? '👁 Ver' : '🙈 Ocultar';
    return;
  }
  if (t.dataset.gen) {
    // gera um PIN novo de 6 números, salva guardando o PIN para o admin ver, e já mostra na linha do motorista
    const n = t.dataset.gen;
    if (!confirm('Gerar um novo PIN para ' + n + '? O PIN antigo deixa de valer e ele precisa entrar de novo.')) return;
    const pin = String((crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000);
    try {
      const r = await rpc('admin_salvar_pin', { p_token: adm, p_nome: n, p_pin: pin });
      if (r.error === 'token') {
        admSet(null);
        return aui();
      }
      if (r.error) return amsg('Erro: ' + r.error);
      await aList();
      const item = [...$('aList').querySelectorAll('.adm-item')].find(x => x.querySelector('b').textContent === n);
      const c = item && item.querySelector('.pinv');
      if (c && c.dataset.pin) {
        c.textContent = c.dataset.pin;
        c.dataset.vis = '1';
        const eye = item.querySelector('[data-eye]');
        if (eye) eye.textContent = '🙈 Ocultar';
        item.scrollIntoView({ block: 'center', behavior: 'smooth' });
        amsg('Novo PIN de ' + n + ': ' + pin, true);
      } else amsg('PIN trocado, mas não consegui guardá-lo para mostrar. Rode o admin_extras.sql no Supabase.');
    } catch (err) {
      amsg('Não foi possível gerar o PIN. Rode o admin_extras.sql no Supabase.');
    }
    return;
  }
  if (t.dataset.edit) {
    // leva o nome para o formulário: é só digitar o novo PIN e salvar
    $('aNome').value = t.dataset.edit;
    $('aPin').value = '';
    amsg('Digite o novo PIN de ' + t.dataset.edit + ' e toque em Salvar.', true);
    $('aPin').scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('aPin').focus();
    return;
  }
  if (t.dataset.fim) {
    // finaliza o percurso de um motorista que esqueceu de finalizar
    const n = t.dataset.fim;
    if (!confirm('Finalizar o percurso de ' + n + '? O ônibus some do mapa dos passageiros.')) return;
    try {
      const r = await rpc('admin_finalizar', { p_token: adm, p_nome: n });
      if (r.error === 'token') {
        admSet(null);
        aui();
        return;
      }
      if (r.error) return amsg('Erro: ' + r.error);
      if (!DEMO) await poll();
      render();
      amsg('Percurso de ' + n + ' finalizado.', true);
      await aList();
    } catch (err) {
      amsg('Não foi possível finalizar. Rode o arquivo admin_extras.sql no Supabase.');
    }
    return;
  }
  const n = t.dataset.del;
  if (!n || !confirm('Excluir o motorista ' + n + '?')) return;
  try {
    await rpc('admin_excluir', { p_token: adm, p_nome: n });
    await aList();
    loadDrivers();
  } catch (err) {
    amsg('Falha ao excluir.');
  }
});

/* ---------- ADMIN: ROTAS (criar uma rota nova e editar nome, cor e próxima rota do ciclo) ---------- */
let rEdit = null; // número da rota que está sendo editada (null = criando uma nova)
const rmsg = (t, ok) => {
  $('rMsg').textContent = t;
  $('rMsg').classList.toggle('ok-msg', !!ok);
};
function rLimpar() {
  rEdit = null;
  const nums = routes.map(r => parseInt(r.id, 10)).filter(n => !isNaN(n));
  $('rId').value = String(nums.length ? Math.max(...nums) + 1 : 1); // sugere o próximo número
  $('rId').disabled = false;
  $('rNome').value = '';
  $('rCor').value = '#2563eb';
  $('rTit').textContent = 'Adicionar rota';
  $('rSave').textContent = 'Adicionar rota';
  $('rCancel').hidden = true;
  rSeg('');
}
function rSeg(sel) { // "quando terminar, passa para": as outras rotas
  $('rSeg').innerHTML =
    '<option value="">Nenhuma (volta para a 1ª parada da mesma rota)</option>' +
    routes.filter(r => r.id !== $('rId').value).map(r => '<option value="' + esc(r.id) + '">Rota ' + esc(r.id + ' · ' + r.nome) + '</option>').join('');
  $('rSeg').value = sel || '';
}
function rRender() {
  $('rLista').innerHTML =
    routes
      .map(
        r =>
          '<div class="row item"><span><span class="dot" style="background:' + esc(r.cor) + '"></span> <b>' + esc(r.id) + '</b> · ' + esc(r.nome) +
          '</span><span class="p-acts"><button class="btn ghost sm" data-rid="' + esc(r.id) + '">Editar</button>' +
          '<button class="btn ghost sm" data-rdel="' + esc(r.id) + '">Excluir</button></span></div>',
      )
      .join('') || '<p class="mut">Nenhuma rota cadastrada.</p>';
  if (rEdit === null && !$('rNome').value) rLimpar();
}
$('rId').addEventListener('input', () => rSeg($('rSeg').value));
$('rCancel').onclick = () => {
  rLimpar();
  rmsg('');
};
async function rExcluir(id) {
  const r = routes.find(x => x.id === id);
  if (!r) return;
  const n = (stopsBy[id] || []).length,
    ref = routes.filter(x => x.seguinte === id).map(x => x.id);
  if (
    !confirm(
      'Excluir a rota ' + id + ' · ' + r.nome + '?\n\nIsso apaga também as ' + n + ' parada(s) dela e não dá para desfazer.' +
        (ref.length ? '\nA(s) rota(s) ' + ref.join(', ') + ' ficam sem “próxima rota”.' : ''),
    )
  )
    return;
  rmsg('');
  try {
    const x = await rpc('admin_rota_excluir', { p_token: adm, p_id: id });
    if (x.error === 'token') return pExpirou();
    if (x.error === 'em_uso') return rmsg('Há motorista rodando nesta rota. Finalize o percurso dele antes de excluir.');
    if (x.error) return rmsg('Erro: ' + x.error);
    if (rEdit === id) rLimpar();
    if (selRoute === id) selRoute = (routes.find(y => y.id !== id) || {}).id || null; // o mapa passa para outra rota
    await recarregarParadas();
    rmsg('Rota ' + id + ' excluída.', true);
  } catch (e) {
    rmsg('Não foi possível excluir. Rode o admin_rotas.sql no Supabase.');
  }
}
$('rLista').addEventListener('click', e => {
  const t = e.target.closest('button');
  if (t && t.dataset.rdel) return rExcluir(t.dataset.rdel);
  const r = t && routes.find(x => x.id === t.dataset.rid);
  if (!r) return;
  rEdit = r.id; // leva os dados para o formulário
  $('rId').value = r.id;
  $('rId').disabled = true; // o número não muda; só nome, cor e próxima rota
  $('rNome').value = r.nome;
  $('rCor').value = /^#[0-9a-f]{6}$/i.test(r.cor) ? r.cor : '#2563eb';
  $('rTit').textContent = 'Editar rota ' + r.id;
  $('rSave').textContent = 'Salvar alterações';
  $('rCancel').hidden = false;
  rSeg(r.seguinte || '');
  rmsg('');
  $('rNome').scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('rNome').focus();
});
$('rSave').onclick = async () => {
  const id = $('rId').value.trim(),
    nome = $('rNome').value.trim();
  if (!/^[A-Za-z0-9_-]{1,10}$/.test(id)) return rmsg('O número da rota deve ter até 10 letras ou números, sem espaços.');
  if (!nome) return rmsg('Digite o nome da rota.');
  if (!rEdit && routes.some(r => r.id === id)) return rmsg('Já existe a rota ' + id + '. Escolha outro número.');
  rmsg('');
  try {
    const r = await rpc('admin_rota_salvar', { p_token: adm, p_id: id, p_nome: nome, p_cor: $('rCor').value, p_seguinte: $('rSeg').value || null, p_novo: !rEdit });
    if (r.error === 'token') return pExpirou();
    if (r.error)
      return rmsg(
        { existe: 'Já existe uma rota com esse número.', dados: 'Confira o número, o nome e a cor.', seguinte: 'A próxima rota escolhida é inválida.' }[r.error] || 'Erro: ' + r.error,
      );
    const nova = !rEdit;
    await recarregarParadas(); // atualiza o mapa, a lista de rotas e o seletor do motorista
    rLimpar();
    if (nova) {
      $('pRota').value = id; // já deixa a rota nova escolhida para você adicionar as paradas
      pLimpar();
      pRender();
    }
    rmsg(nova ? 'Rota ' + id + ' criada. Agora adicione as paradas dela mais abaixo, em “Paradas das rotas”.' : 'Rota atualizada.', true);
  } catch (e) {
    rmsg(e && /Failed to fetch|NetworkError/i.test(String(e.message)) ? 'Falha de conexão. Tente de novo.' : 'Não foi possível salvar. Rode o admin_rotas.sql no Supabase.');
  }
};
function demoRota(b, fn) { // só para a demonstração: altera as rotas na memória
  if (fn === 'admin_rota_excluir') {
    const i = D_ROUTES.findIndex(x => x.id === b.p_id);
    if (i >= 0) D_ROUTES.splice(i, 1);
    delete D_STOPS[b.p_id];
    D_ROUTES.forEach(x => {
      if (x.seguinte === b.p_id) x.seguinte = '';
    });
    return { ok: true };
  }
  const r = D_ROUTES.find(x => x.id === b.p_id);
  if (b.p_novo) {
    D_ROUTES.push({ id: b.p_id, nome: b.p_nome, cor: b.p_cor, seguinte: b.p_seguinte || '' });
    D_STOPS[b.p_id] = [];
  } else if (r) Object.assign(r, { nome: b.p_nome, cor: b.p_cor, seguinte: b.p_seguinte || '' });
  return { ok: true };
}

/* ---------- ADMIN: PARADAS DAS ROTAS (adicionar, editar, mover e excluir) ---------- */
let pEdit = null; // ordem da parada que está sendo editada (null = adicionando uma nova)
const pmsg = (t, ok) => {
  $('pMsg').textContent = t;
  $('pMsg').classList.toggle('ok-msg', !!ok);
};
function pLimpar() {
  pEdit = null;
  $('pNome').value = '';
  $('pCoord').value = '';
  $('pPos').disabled = false;
  $('pTit').textContent = 'Adicionar parada';
  $('pSave').textContent = 'Adicionar parada';
  $('pCancel').hidden = true;
}
function pInit() {
  const v = $('pRota').value;
  $('pRota').innerHTML = routes.map(r => '<option value="' + esc(r.id) + '">' + esc(r.id + ' · ' + r.nome) + '</option>').join('');
  if (v && routes.some(r => r.id === v)) $('pRota').value = v;
  pRender();
  rRender();
}
function pRender() {
  const rid = $('pRota').value,
    s = stopsBy[rid] || [];
  $('pLista').innerHTML =
    s
      .map(
        (p, i) =>
          '<div class="row item"><span><b>' + (i + 1) + '.</b> ' + esc(p.nome) + '</span><span class="p-acts">' +
          '<button class="btn ghost sm" data-act="up" data-o="' + p.ordem + '" title="Subir"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="btn ghost sm" data-act="down" data-o="' + p.ordem + '" title="Descer"' + (i === s.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="btn ghost sm" data-act="edit" data-o="' + p.ordem + '">Editar</button>' +
          '<button class="btn ghost sm" data-act="del" data-o="' + p.ordem + '">Excluir</button></span></div>',
      )
      .join('') || '<p class="mut">Nenhuma parada nesta rota.</p>';
  $('pPos').innerHTML =
    '<option value="">No fim da rota</option>' +
    s.map((p, i) => '<option value="' + p.ordem + '">Antes de: ' + (i + 1) + '. ' + esc(p.nome) + '</option>').join('');
}
/* Releitura automática das rotas e paradas: quem já está com o site aberto passa a ver paradas novas sem recarregar */
let ultimaParadas = Date.now();
const paradasAssinatura = () => JSON.stringify([routes, stopsBy]);
async function atualizarParadas() {
  if (run) return; // motorista em percurso: não troca a lista no meio do caminho (a ordem das paradas é usada nele)
  const antes = paradasAssinatura();
  try {
    await load();
  } catch (e) {
    return; // sem internet agora: tenta de novo na próxima
  }
  ultimaParadas = Date.now();
  if (paradasAssinatura() === antes) return; // nada mudou
  Object.values(R).forEach(o => o.dots.forEach(d => map.removeLayer(d)));
  Object.keys(R).forEach(k => delete R[k]);
  build(false); // refaz os pontos sem mexer no zoom de quem está olhando o mapa
  lastList = '';
  render();
  fillRsel();
  if (adm) pInit();
}
async function recarregarParadas() { // lê as paradas de novo e refaz os pontos do mapa
  await load();
  Object.values(R).forEach(o => o.dots.forEach(d => map.removeLayer(d)));
  Object.keys(R).forEach(k => delete R[k]);
  build();
  lastList = '';
  render();
  pInit();
  fillRsel();
}
function pExpirou() {
  admSet(null);
  aui();
  $('aErr').textContent = 'Sessão expirada. Entre novamente.';
}
async function pChamar(fn, args, okMsg) { // chama o servidor e mostra o resultado
  pmsg('');
  try {
    const r = await rpc(fn, { p_token: adm, p_rota: $('pRota').value, ...args });
    if (r.error === 'token') return pExpirou();
    if (r.error) return pmsg(r.error === 'dados' ? 'Confira o nome e as coordenadas.' : 'Erro: ' + r.error);
    await recarregarParadas();
    pmsg(okMsg, true);
    return true;
  } catch (e) {
    pmsg('Falha de conexão. Tente de novo.');
  }
}
$('pRota').onchange = () => {
  pLimpar();
  pmsg('');
  pRender();
};
$('pCancel').onclick = () => {
  pLimpar();
  pmsg('');
};
$('pSave').onclick = async () => {
  const nome = $('pNome').value.trim(),
    m = $('pCoord').value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/); // "-3.7230, -38.4920" (como o Google Maps copia)
  if (!nome) return pmsg('Digite o nome da parada.');
  if (!m) return pmsg('Cole as coordenadas do Google Maps, por exemplo: -3.7230, -38.4920');
  const lat = Number(m[1]),
    lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return pmsg('Coordenadas inválidas.');
  const ok = pEdit
    ? await pChamar('admin_parada_editar', { p_ordem: pEdit, p_nome: nome, p_lat: lat, p_lng: lng }, 'Parada atualizada.')
    : await pChamar('admin_parada_inserir', { p_pos: $('pPos').value ? Number($('pPos').value) : null, p_nome: nome, p_lat: lat, p_lng: lng }, 'Parada adicionada.');
  if (ok) pLimpar();
};
$('pLista').addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  const o = Number(t.dataset.o),
    p = (stopsBy[$('pRota').value] || []).find(x => x.ordem === o);
  if (!p) return;
  if (t.dataset.act === 'up' || t.dataset.act === 'down')
    return pChamar('admin_parada_mover', { p_ordem: o, p_dir: t.dataset.act === 'up' ? -1 : 1 }, 'Ordem atualizada.');
  if (t.dataset.act === 'del') {
    if (!confirm('Excluir a parada "' + p.nome + '" da rota ' + $('pRota').value + '?')) return;
    return pChamar('admin_parada_excluir', { p_ordem: o }, 'Parada excluída.');
  }
  if (t.dataset.act === 'edit') { // leva os dados para o formulário
    pEdit = o;
    $('pNome').value = p.nome;
    $('pCoord').value = p.lat + ', ' + p.lng;
    $('pPos').disabled = true;
    $('pTit').textContent = 'Editar parada';
    $('pSave').textContent = 'Salvar alterações';
    $('pCancel').hidden = false;
    pmsg('');
    $('pNome').scrollIntoView({ block: 'center', behavior: 'smooth' });
    $('pNome').focus();
  }
});
const demoPins = { 'João Silva': '1234', 'Maria Souza': null };
function demoParada(fn, b) { // só para a demonstração (sem Supabase): altera dados na memória
  if (fn === 'admin_lista') return Object.keys(demoPins).map(n => ({ nome: n, pin: demoPins[n] }));
  if (fn === 'admin_salvar_pin') {
    demoPins[b.p_nome] = b.p_pin;
    return { ok: true };
  }
  const a = D_STOPS[b.p_rota],
    i = (b.p_ordem || 0) - 1;
  if (fn === 'admin_parada_inserir') a.splice(b.p_pos ? Math.min(b.p_pos - 1, a.length) : a.length, 0, [b.p_nome, b.p_lat, b.p_lng]);
  if (fn === 'admin_parada_editar') a[i] = [b.p_nome, b.p_lat, b.p_lng];
  if (fn === 'admin_parada_excluir') a.splice(i, 1);
  if (fn === 'admin_parada_mover') {
    const j = i + b.p_dir;
    if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]];
  }
  return { ok: true };
}

/* ---------- abas ---------- */
function tab(n) {
  ['P', 'D', 'A'].forEach(k => {
    $('v' + k).hidden = k !== n;
    $('t' + k).classList.toggle('on', k === n);
  });
  if (n === 'P') setTimeout(() => map.invalidateSize(), 50);
}
const navClose = () => {
  $('nav').classList.remove('open');
  $('navBtn').setAttribute('aria-expanded', 'false');
};
$('navBtn').onclick = () => {
  const o = $('nav').classList.toggle('open');
  $('navBtn').setAttribute('aria-expanded', o);
};
$('tP').onclick = () => {
  tab('P');
  navClose();
};
$('tD').onclick = () => {
  tab('D');
  navClose();
};
$('tA').onclick = () => {
  tab('A');
  navClose();
};
document.addEventListener('click', e => {
  if (!$('nav').contains(e.target)) navClose();
});
const chkAdm = () => {
  const on = location.hash === '#admin';
  $('tA').hidden = !on;
  if (on) tab('A');
}; // a aba Admin só aparece com #admin
addEventListener('hashchange', chkAdm);
chkAdm();

/* ===== INSTALAR O APP (PWA) =====
   Computador (Chrome/Edge): aviso + botão "Instalar app" no menu. O app abre em janela própria e aparece na
     barra de tarefas (botão direito no ícone > "Fixar na barra de tarefas" para deixá-lo sempre lá).
   Android (Chrome/Edge): aviso + botão "Adicionar à tela inicial" no menu (abre a janela oficial de instalação).
   iPhone (Safari): não existe janela automática; o aviso explica "Compartilhar > Adicionar à Tela de Início".
   Não aparece se o app já estiver instalado, nem durante um percurso do motorista.
   Firefox no computador não instala sites como app (o navegador não oferece). */
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
const jaInstalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ehIphone = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios|edgios/i.test(navigator.userAgent);
const ehCelular = matchMedia('(pointer: coarse)').matches || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
let instEvt = null;
const instAdiado = () => { try { return Date.now() < Number(localStorage.getItem('bl_inst')); } catch (e) { return false; } };
function instFechar(lembrar) {
  $('instalar').hidden = true;
  if (lembrar) try { localStorage.setItem('bl_inst', Date.now() + INSTALAR_VOLTAR_EM_DIAS * 86400000); } catch (e) {}
}
function instBtn() { // botão fixo no menu (continua disponível depois de tocar em "Agora não")
  $('tI').hidden = jaInstalado() || !(instEvt || ehIphone);
  $('tI').textContent = ehCelular ? '📲 Adicionar à tela inicial' : '⬇ Instalar app';
}
function instMostrar(iphone, forcar) {
  if (jaInstalado() || (!forcar && instAdiado())) return;
  setTimeout(() => {
    if (run || jaInstalado()) return;
    $('instTit').textContent = iphone || ehCelular ? 'Adicionar à tela inicial?' : 'Instalar o app Transporte?';
    $('instMsg').textContent = iphone
      ? 'No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.'
      : ehCelular
        ? 'Abra o mapa com um toque, direto da tela inicial, como um app.'
        : 'Abre em janela própria e aparece na barra de tarefas. Depois de instalar, clique com o botão direito no ícone e escolha “Fixar na barra de tarefas”.';
    $('instSim').textContent = ehCelular ? 'Adicionar' : 'Instalar';
    $('instSim').hidden = iphone;
    $('instNao').textContent = iphone ? 'Entendi' : 'Agora não';
    $('instalar').hidden = false;
  }, forcar ? 0 : INSTALAR_ATRASO);
}
async function instalarAgora() {
  if (!instEvt) return;
  instEvt.prompt();
  await instEvt.userChoice;
  instEvt = null;
  instFechar(false);
  instBtn();
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); instEvt = e; instBtn(); instMostrar(false); });
addEventListener('appinstalled', () => { instFechar(false); instBtn(); });
$('instSim').onclick = instalarAgora;
$('instNao').onclick = () => instFechar(true);
$('tI').onclick = () => { navClose(); if (instEvt) instalarAgora(); else instMostrar(true, true); };
if (ehIphone) { instBtn(); instMostrar(true); }

/* ---------- início ---------- */
(async function () {
  // tenta carregar rotas e paradas até conseguir (antes, uma falha de rede deixava o site parado em "Tentando novamente…")
  for (;;) {
    try {
      await load();
      $('err').hidden = true;
      break;
    } catch (e) {
      $('err').hidden = false;
      hideSplash();
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  build();
  initDriver();
  if (adm) {
    aui(); // voltou com a sessão do admin aberta: mostra o painel e confere no servidor se ainda vale
    aList();
  }
  if (DEMO) {
    $('demo').hidden = false;
    initSim();
    step();
    render();
    hideSplash();
    setInterval(() => {
      step();
      render();
    }, 1000);
  } else {
    await poll();
    render();
    hideSplash(); // a logo some quando os primeiros dados chegam
    (function loop() {
      setTimeout(
        async () => {
          await poll();
          loop();
        },
        POLL + Math.random() * 3000,
      );
    })();
    setInterval(render, 1000);
    (function loopParadas() {
      setTimeout(
        async () => {
          await atualizarParadas();
          loopParadas();
        },
        ATUALIZAR_PARADAS + Math.random() * 30000,
      );
    })();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      poll();
      if (Date.now() - ultimaParadas > 120000) atualizarParadas(); // voltou para a aba: confere se há paradas novas
    });
  }
})();
