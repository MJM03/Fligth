'use strict';

const CONFIG = {
  version: '2.0.0',
  center: [-12.0464, -77.0428],
  zoom: 7,
  refreshMs: 15000,
  maxRadiusNm: 250,
  requestTimeoutMs: 11000,
  providers: [
    {
      id: 'adsbfi',
      name: 'adsb.fi',
      buildUrl: p => `https://opendata.adsb.fi/api/v3/lat/${p.lat}/lon/${p.lon}/dist/${p.dist}`
    },
    {
      id: 'adsblol',
      name: 'ADSB.lol',
      buildUrl: p => `https://api.adsb.lol/v2/lat/${p.lat}/lon/${p.lon}/dist/${p.dist}`
    },
    {
      id: 'airplaneslive',
      name: 'Airplanes.live',
      buildUrl: p => `https://api.airplanes.live/v2/point/${p.lat}/${p.lon}/${p.dist}`
    }
  ]
};

const $ = id => document.getElementById(id);

const state = {
  aircraft: [],
  filtered: [],
  markers: new Map(),
  trails: new Map(),
  selected: null,
  follow: false,
  timer: null,
  mapStyle: 0,
  source: 'connecting',
  providerIndex: 0,
  loading: false,
  lastSuccess: null
};

const map = L.map('map', {
  zoomControl: false,
  preferCanvas: true,
  minZoom: 3,
  worldCopyJump: true
}).setView(CONFIG.center, CONFIG.zoom);

const tiles = [
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '© OpenStreetMap © CARTO'
  }),
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  })
];

tiles[0].addTo(map);

function planeIcon(a, selected = false) {
  const rotation = Number(a.track || a.true_heading || 0);
  const ground = a.alt_baro === 'ground' || Number(a.alt_geom) === 0;
  const emergency = ['7500', '7600', '7700'].includes(String(a.squawk || ''));

  return L.divIcon({
    className: `aircraft-marker ${selected ? 'selected' : ''} ${ground ? 'ground' : ''} ${emergency ? 'emergency' : ''}`,
    html: `<div class="plane-icon" style="transform:rotate(${rotation}deg)">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21.5 16.1 13.8 12V5.5c0-1-.8-3-1.8-3s-1.8 2-1.8 3V12l-7.7 4.1v1.6l7.7-2.1V20l-2 1.3V22l3.8-.8 3.8.8v-.7l-2-1.3v-4.4l7.7 2.1z"/>
      </svg>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function normalize(a, i) {
  const hex = String(a.hex || a.icao24 || a.icao || `demo${i}`).replace('~', '').toLowerCase();
  const lat = Number(a.lat ?? a.latitude);
  const lon = Number(a.lon ?? a.longitude);

  return {
    hex,
    flight: String(a.flight || a.callsign || a.r || a.registration || hex || 'SIN ID').trim(),
    r: a.r || a.registration || 'Matrícula no disponible',
    t: a.t || a.aircraft_type || a.type || 'Tipo no disponible',
    desc: a.desc || a.typeDescription || '',
    lat,
    lon,
    alt_baro: a.alt_baro ?? a.altitude ?? a.baro_altitude,
    alt_geom: a.alt_geom ?? a.geo_altitude,
    gs: Number(a.gs ?? a.velocity ?? a.ground_speed ?? 0),
    track: Number(a.track ?? a.true_heading ?? a.heading ?? 0),
    baro_rate: Number(a.baro_rate ?? a.vertical_rate ?? 0),
    seen: Number(a.seen ?? a.seen_pos ?? 0),
    category: a.category || '',
    squawk: a.squawk || '',
    dbFlags: a.dbFlags || 0,
    origin: a.origin || '—',
    destination: a.destination || '—'
  };
}

function demoData() {
  const now = Date.now() / 45000;
  const drift = Math.sin(now) * 0.035;
  const base = [
    ['LPE2157','OB-2215','A320',-11.80 + drift,-77.31,32000,446,152,-64],
    ['LAT2410','CC-BHB','A320',-12.45,-76.88 + drift,14800,312,337,-1280],
    ['SKX603','N889SK','E75L',-11.62,-76.72 - drift,36000,421,175,0],
    ['JAT782','OB-2190','B38M',-13.18 + drift,-76.24,28100,405,318,1152],
    ['LPE2024','OB-2172','A319',-12.06,-77.11 + drift,4200,190,170,-960],
    ['AMP155','N780AV','B763',-10.73 - drift,-78.01,37000,478,145,0],
    ['LPE2265','OB-2218','A320',-13.53,-77.29 - drift,19500,361,350,1408],
    ['AAL918','N839NN','B738',-9.98 + drift,-76.92,35000,455,169,0]
  ];

  return base.map((x, i) => normalize({
    hex: `D3${(1000 + i).toString(16)}`,
    flight: x[0], r: x[1], t: x[2],
    lat: x[3], lon: x[4], alt_baro: x[5],
    gs: x[6], track: x[7], baro_rate: x[8], seen: i * 0.3
  }, i));
}

function visibleCenterAndRadius() {
  const c = map.getCenter();
  const b = map.getBounds();
  const edge = b.getNorthEast();
  const km = map.distance(c, edge) / 1000;
  const nm = Math.min(CONFIG.maxRadiusNm, Math.max(25, km / 1.852));

  return {
    lat: c.lat.toFixed(4),
    lon: c.lng.toFixed(4),
    dist: Math.round(nm)
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractAircraft(data) {
  if (Array.isArray(data?.ac)) return data.ac;
  if (Array.isArray(data?.aircraft)) return data.aircraft;
  if (Array.isArray(data?.states)) {
    return data.states.map(s => ({
      hex: s[0], callsign: s[1], registration: '',
      lon: s[5], lat: s[6], altitude: s[7],
      velocity: s[9] ? s[9] * 1.94384 : 0,
      heading: s[10],
      vertical_rate: s[11] ? s[11] * 196.85 : 0,
      seen: 0
    }));
  }
  return [];
}

async function tryProviders(point) {
  const errors = [];

  for (let offset = 0; offset < CONFIG.providers.length; offset++) {
    const index = (state.providerIndex + offset) % CONFIG.providers.length;
    const provider = CONFIG.providers[index];

    try {
      $('sourceText').textContent = `Conectando a ${provider.name}`;
      const data = await fetchJson(provider.buildUrl(point));
      const raw = extractAircraft(data);
      const aircraft = raw
        .map(normalize)
        .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon));

      if (!aircraft.length) throw new Error('Respuesta sin posiciones');

      state.providerIndex = index;
      return { aircraft, provider };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }

  throw new Error(errors.join(' · '));
}

async function loadAircraft(manual = false) {
  if (state.loading) return;
  state.loading = true;
  $('refreshBtn').classList.add('spinning');

  if (manual) showNotice('Actualizando tráfico aéreo…', 1400);

  try {
    const point = visibleCenterAndRadius();
    const result = await tryProviders(point);

    state.aircraft = result.aircraft;
    state.source = 'live';
    state.lastSuccess = new Date();
    $('sourceText').textContent = `${result.provider.name} · EN VIVO`;
    document.body.classList.remove('demo-mode');

    applyFilter();
    renderAll();

    if (manual) {
      showNotice(`${result.aircraft.length} aeronaves recibidas desde ${result.provider.name}.`, 2200);
    }
  } catch (error) {
    state.aircraft = demoData();
    state.source = 'demo';
    $('sourceText').textContent = 'Modo demostración';
    document.body.classList.add('demo-mode');

    applyFilter();
    renderAll();

    showNotice(
      'No fue posible conectar con las fuentes ADS-B desde el navegador. La app cambió temporalmente al modo demostración.',
      5000
    );

    console.warn('[AeroRadar] Todas las fuentes fallaron:', error);
  } finally {
    state.loading = false;
    $('refreshBtn').classList.remove('spinning');
  }
}

function applyFilter() {
  const query = $('searchInput').value.trim().toLowerCase();
  state.filtered = !query
    ? state.aircraft
    : state.aircraft.filter(a =>
        `${a.flight} ${a.r} ${a.hex} ${a.t}`.toLowerCase().includes(query)
      );

  $('clearSearch').style.display = query ? 'block' : 'none';
}

function renderAll() {
  renderMarkers();
  renderList();
  renderStats();

  if (state.selected) {
    const fresh = state.aircraft.find(a => a.hex === state.selected.hex);
    if (fresh) {
      state.selected = fresh;
      updateSheet(fresh);
      if (state.follow) map.panTo([fresh.lat, fresh.lon], { animate: true });
    }
  }
}

function renderMarkers() {
  const present = new Set();

  state.filtered.forEach(a => {
    present.add(a.hex);
    let marker = state.markers.get(a.hex);

    if (!marker) {
      marker = L.marker([a.lat, a.lon], {
        icon: planeIcon(a, state.selected?.hex === a.hex),
        zIndexOffset: state.selected?.hex === a.hex ? 1000 : 0
      }).addTo(map);

      marker.on('click', () => selectAircraft(a.hex));
      state.markers.set(a.hex, marker);
    } else {
      marker.setLatLng([a.lat, a.lon]);
      marker.setIcon(planeIcon(a, state.selected?.hex === a.hex));
      marker.setZIndexOffset(state.selected?.hex === a.hex ? 1000 : 0);
    }
  });

  for (const [hex, marker] of state.markers) {
    if (!present.has(hex)) {
      map.removeLayer(marker);
      state.markers.delete(hex);
    }
  }
}

function renderList() {
  $('aircraftList').innerHTML = state.filtered.slice(0, 150).map(a => `
    <div class="aircraft-card ${state.selected?.hex === a.hex ? 'selected' : ''}" data-hex="${a.hex}">
      <div class="list-plane" style="--rotation:${a.track}deg">✈</div>
      <div class="info">
        <h3>${escapeHtml(a.flight)}</h3>
        <p>${escapeHtml(a.r)} · ${escapeHtml(a.t)}</p>
      </div>
      <div class="metrics">
        <b>${formatAlt(a)} ft</b>
        <span>${Math.round(a.gs || 0)} kt</span>
      </div>
    </div>
  `).join('') || `
    <div class="empty-state">
      No se encontraron aeronaves con este filtro.
    </div>
  `;

  document.querySelectorAll('.aircraft-card[data-hex]').forEach(el => {
    el.onclick = () => selectAircraft(el.dataset.hex);
  });
}

function renderStats() {
  const airborne = state.filtered.filter(a =>
    a.alt_baro !== 'ground' && Number(a.alt_baro || a.alt_geom) > 500
  );

  const average = airborne.length
    ? Math.round(
        airborne.reduce((sum, a) => sum + Number(a.alt_baro || a.alt_geom || 0), 0)
        / airborne.length / 100
      ) * 100
    : 0;

  $('aircraftCount').textContent = state.filtered.length;
  $('airborneCount').textContent = airborne.length;
  $('avgAltitude').textContent = average ? `${Math.round(average / 1000)}k` : '—';
}

function selectAircraft(hex) {
  const aircraft = state.aircraft.find(a => a.hex === hex);
  if (!aircraft) return;

  state.selected = aircraft;
  updateSheet(aircraft);
  $('flightSheet').classList.add('open');
  map.panTo([aircraft.lat, aircraft.lon], { animate: true });
  renderMarkers();
  renderList();
}

function updateSheet(a) {
  $('flightCallsign').textContent = a.flight;
  $('flightReg').textContent = `${a.r} · ${a.t}`;
  $('altitude').textContent = formatAlt(a);
  $('speed').textContent = Math.round(a.gs || 0);
  $('heading').textContent = Math.round(a.track || 0).toString().padStart(3, '0');
  $('verticalRate').textContent = Math.round(a.baro_rate || 0);
  $('hex').textContent = a.hex.toUpperCase();
  $('aircraftType').textContent = a.t;
  $('position').textContent = `${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`;
  $('lastSeen').textContent = a.seen < 2 ? 'Ahora' : `Hace ${Math.round(a.seen)} s`;
  $('origin').textContent = a.origin;
  $('destination').textContent = a.destination;
}

function formatAlt(a) {
  if (a.alt_baro === 'ground') return 'GND';
  return Math.round(Number(a.alt_baro || a.alt_geom || 0)).toLocaleString('en-US');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#039;'
  }[char]));
}

function showNotice(message, duration = 1800) {
  const notice = $('notice');
  notice.textContent = message;
  notice.classList.remove('hidden');
  clearTimeout(notice._timer);
  notice._timer = setTimeout(() => notice.classList.add('hidden'), duration);
}

function openModal(title, html) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden');
}

function forceMapResize() {
  requestAnimationFrame(() => {
    map.invalidateSize({ animate: false, pan: false });
  });
}

$('searchInput').addEventListener('input', () => {
  applyFilter();
  renderAll();
});

$('clearSearch').onclick = () => {
  $('searchInput').value = '';
  applyFilter();
  renderAll();
};

$('refreshBtn').onclick = () => loadAircraft(true);
$('desktopRefresh').onclick = () => loadAircraft(true);

$('locateBtn').onclick = () => {
  if (!navigator.geolocation) {
    showNotice('La geolocalización no está disponible.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      map.flyTo(
        [position.coords.latitude, position.coords.longitude],
        9,
        { duration: 0.8 }
      );
      setTimeout(() => loadAircraft(true), 1000);
    },
    () => showNotice('No se pudo obtener tu ubicación. Revisa el permiso de Safari.')
  );
};

$('layersBtn').onclick = () => {
  map.removeLayer(tiles[state.mapStyle]);
  state.mapStyle = (state.mapStyle + 1) % tiles.length;
  tiles[state.mapStyle].addTo(map);
};

$('closeSheet').onclick = () => {
  $('flightSheet').classList.remove('open');
  state.follow = false;
  $('followBtn').classList.remove('active');
  $('followBtn').textContent = 'Seguir';
};

$('followBtn').onclick = () => {
  state.follow = !state.follow;
  $('followBtn').classList.toggle('active', state.follow);
  $('followBtn').textContent = state.follow ? 'Siguiendo' : 'Seguir';

  if (state.follow && state.selected) {
    map.panTo([state.selected.lat, state.selected.lon], { animate: true });
  }
};

$('listTab').onclick = () => openModal(
  'Vuelos visibles',
  `<div class="flight-modal-list">${$('aircraftList').innerHTML}</div>`
);

$('favoritesTab').onclick = () => openModal(
  'Favoritos',
  `<p class="modal-copy">
    Los favoritos están preparados para una siguiente iteración con almacenamiento local,
    vigilancia por matrícula y alertas cuando una aeronave aparezca en el área visible.
  </p>`
);

$('settingsTab').onclick = () => openModal(
  'Ajustes',
  `<div class="settings-group">
    <label>Fuentes ADS-B configuradas</label>
    <div class="provider-list">
      ${CONFIG.providers.map((p, i) => `<div><span>${i + 1}</span><b>${p.name}</b></div>`).join('')}
    </div>
  </div>
  <div class="settings-group">
    <label>Actualización automática</label>
    <select disabled><option>15 segundos</option></select>
  </div>
  <p class="modal-copy">
    AeroRadar intenta cada fuente en orden y cambia automáticamente a la siguiente cuando
    una está caída, limitada o bloqueada por el navegador.
  </p>`
);

$('modalClose').onclick = () => $('modal').classList.add('hidden');

$('modal').onclick = event => {
  if (event.target === $('modal')) $('modal').classList.add('hidden');
};

map.on('moveend', () => {
  clearTimeout(map._reloadTimer);
  map._reloadTimer = setTimeout(() => loadAircraft(false), 900);
});

document.addEventListener('click', event => {
  const card = event.target.closest('.flight-modal-list .aircraft-card[data-hex]');
  if (card) {
    $('modal').classList.add('hidden');
    selectAircraft(card.dataset.hex);
  }
});

window.addEventListener('resize', forceMapResize);
window.addEventListener('orientationchange', () => setTimeout(forceMapResize, 350));
window.addEventListener('pageshow', () => setTimeout(forceMapResize, 150));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    forceMapResize();
    loadAircraft(false);
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js?v=2.0.0');
      registration.update();
    } catch (error) {
      console.warn('[AeroRadar] No se pudo registrar el service worker:', error);
    }
  });
}

forceMapResize();
loadAircraft();
state.timer = setInterval(() => loadAircraft(false), CONFIG.refreshMs);
