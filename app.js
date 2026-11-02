/* Cresta 3D — clone di FATMAP per Android (PWA), con mappe offline.
 * MapLibre GL JS 4.x · terreno Mapterhorn · immagini Esri / Wayback / Sentinel-2 / swisstopo / IGN
 */
'use strict';

/* =====================================================================
 * Utility
 * ===================================================================== */
const $ = id => document.getElementById(id);
const D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH_C = 40075016.686;
const HAS_CACHE = typeof caches !== 'undefined' && self.isSecureContext;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function fmtMB(b) { return b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + ' MB'; }

/* =====================================================================
 * Impostazioni
 * ===================================================================== */
const _now = new Date();
const WY = _now.getMonth() >= 4 ? _now.getFullYear() : _now.getFullYear() - 1; // ultimo inverno concluso
const DEFAULTS = {
  base: 'esri', ortoCH: true, ortoFR: true,
  extras: { labels: true, skiCH: false, skiFR: false, pistes: false, hiking: false },
  terrain3d: true, exag: 1.3, hill: false, overlay: 'slope', ovOpacity: 0.5,
  wayback: null, // {num, tpl, title}
  s2: { instance: '', layer: 'TRUE_COLOR', from: `${WY}-01-15`, to: `${WY}-03-31`, maxcc: 20 },
  imgMax: 17, demMax: 15, bufM: 1000,
  view: { center: [6.865, 45.86], zoom: 12.6, pitch: 62, bearing: -25 },
};
const settings = (() => {
  const s = LS.get('fm.settings', {});
  return { ...DEFAULTS, ...s, extras: { ...DEFAULTS.extras, ...(s.extras || {}) }, s2: { ...DEFAULTS.s2, ...(s.s2 || {}) } };
})();
let saveT; function saveSettings() { clearTimeout(saveT); saveT = setTimeout(() => LS.set('fm.settings', settings), 300); }

/* =====================================================================
 * Fonti di tile
 * ===================================================================== */
const B_CH = [5.9, 45.8, 10.6, 47.9], B_FR = [-5.3, 41.3, 9.7, 51.2];
const geopf = (layer, fmt, z, x, y) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=normal&FORMAT=${fmt}&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}`;
const SRC = {
  esri: { ts: 256, max: 19, attr: 'Esri, Maxar, Earthstar Geographics',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
  wayback: { ts: 256, max: 19, attr: 'Esri World Imagery Wayback',
    url: (z, x, y) => settings.wayback ? settings.wayback.tpl.replace('{level}', z).replace('{row}', y).replace('{col}', x) : null },
  s2: { ts: 512, max: 13, attr: 'Copernicus Sentinel-2 / Sentinel Hub',
    url: (z, x, y) => {
      const s = settings.s2; if (!s.instance) return null;
      // PopularWebMercator512: il livello N ha 2^(N-1) colonne → TILEMATRIX = z+1
      return `https://sh.dataspace.copernicus.eu/ogc/wmts/${encodeURIComponent(s.instance)}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(s.layer || 'TRUE_COLOR')}&STYLE=default&TILEMATRIXSET=PopularWebMercator512&TILEMATRIX=${z + 1}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg&TIME=${s.from}/${s.to}&MAXCC=${s.maxcc}&SHOWLOGO=false`;
    } },
  topo: { ts: 256, max: 17, attr: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)',
    url: (z, x, y) => `https://a.tile.opentopomap.org/${z}/${x}/${y}.png` },
  ch: { ts: 256, max: 20, bounds: B_CH, attr: '© swisstopo',
    url: (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${z}/${x}/${y}.jpeg` },
  fr: { ts: 256, max: 19, bounds: B_FR, attr: '© IGN',
    url: (z, x, y) => geopf('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', z, x, y) },
  labels: { ts: 256, max: 19, attr: 'Esri',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}` },
  skiCH: { ts: 256, max: 17, bounds: B_CH, attr: '© swisstopo',
    url: (z, x, y) => `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo-karto.skitouren/default/current/3857/${z}/${x}/${y}.png` },
  skiFR: { ts: 256, max: 16, bounds: B_FR, attr: '© IGN',
    url: (z, x, y) => geopf('TRACES.RANDO.HIVERNALE', 'image/png', z, x, y) },
  pistes: { ts: 256, max: 18, attr: '© waymarkedtrails.org, OSM',
    url: (z, x, y) => `https://tile.waymarkedtrails.org/slopes/${z}/${x}/${y}.png` },
  hiking: { ts: 256, max: 18, attr: '© waymarkedtrails.org, OSM',
    url: (z, x, y) => `https://tile.waymarkedtrails.org/hiking/${z}/${x}/${y}.png` },
};
const BASES = ['esri', 'wayback', 's2', 'topo'];
const EXTRAS = ['skiCH', 'skiFR', 'pistes', 'hiking', 'labels'];
const srcVer = {};
const tileUrl = id => `tile://${id}/${srcVer[id] || 0}/{z}/{x}/{y}`;

/* =====================================================================
 * Rete + cache (Cache Storage): cache-first, poi rete
 * ===================================================================== */
const inflight = new Map();
let rtCachePromise = null, rtPuts = 0;
const rtCache = () => (rtCachePromise ||= caches.open('fm-rt'));

function fetchRaw(url) {
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    if (HAS_CACHE) {
      try { const hit = await caches.match(url); if (hit) return { status: 'ok', buf: await hit.arrayBuffer(), cached: true }; } catch {}
    }
    let r;
    try { r = await fetch(url, { mode: 'cors', credentials: 'omit' }); }
    catch { return { status: 'error' }; }
    if (r.status === 404 || r.status === 204 || r.status === 400) return { status: 'missing' };
    if (!r.ok) return { status: 'error' };
    const buf = await r.arrayBuffer();
    if (!buf.byteLength) return { status: 'missing' };
    if (HAS_CACHE) rtPut(url, buf, r.headers.get('content-type'));
    return { status: 'ok', buf };
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
// Copia sicura: MapLibre trasferisce i buffer al worker (detach)
async function getRaw(url) { const r = await fetchRaw(url); return r.status === 'ok' ? { ...r, buf: r.buf.slice(0) } : r; }

function rtPut(url, buf, type) {
  const copy = buf.slice(0);
  rtCache().then(c => c.put(url, new Response(copy, { headers: { 'content-type': type || 'application/octet-stream' } })))
    .then(() => { if (++rtPuts % 300 === 0) trimRt(); }).catch(() => {});
}
async function trimRt() {
  try { const c = await rtCache(), keys = await c.keys(), MAX = 6000; for (let i = 0; i < keys.length - MAX; i++) await c.delete(keys[i]); } catch {}
}

let emptyTilePromise;
function emptyTile() {
  emptyTilePromise ||= new OffscreenCanvas(256, 256).convertToBlob({ type: 'image/png' }).then(b => b.arrayBuffer());
  return emptyTilePromise.then(b => b.slice(0));
}

// Fallback offline: se manca una tile, usa un antenato in cache ingrandito
async function ancestorFallback(id, z, x, y) {
  if (!HAS_CACHE) return null;
  const s = SRC[id];
  for (let dz = 1; dz <= 7 && z - dz >= 0; dz++) {
    const az = z - dz, ax = x >> dz, ay = y >> dz, url = s.url(az, ax, ay);
    if (!url) return null;
    let hit; try { hit = await caches.match(url); } catch { return null; }
    if (!hit) continue;
    try {
      const bmp = await createImageBitmap(await hit.blob());
      const n = 1 << dz, sub = bmp.width / n, sx = (x - (ax << dz)) * sub, sy = (y - (ay << dz)) * sub;
      const cv = new OffscreenCanvas(s.ts, s.ts), g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, sx, sy, sub, sub, 0, 0, s.ts, s.ts);
      return (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer();
    } catch { return null; }
  }
  return null;
}

// Le ortofoto nazionali fuori confine possono restituire tile uniformi (bianche/nere): le scartiamo
async function isBlankTile(buf) {
  try {
    const bmp = await createImageBitmap(new Blob([buf]), { resizeWidth: 16, resizeHeight: 16 });
    const g = new OffscreenCanvas(16, 16).getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, 16, 16).data; let mn = 255, mx = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; mn = Math.min(mn, v); mx = Math.max(mx, v); a += d[i + 3]; }
    return a < 16 * 16 * 20 || (mx - mn < 4 && (mn > 245 || mx < 10));
  } catch { return false; }
}
const BLANK_CHECK = new Set(['ch', 'fr']);

maplibregl.addProtocol('tile', async (params) => {
  const [id, , z, x, y] = params.url.slice(7).split('/');
  const zi = +z, xi = +x, yi = +y, s = SRC[id];
  const url = s && s.url(zi, xi, yi);
  if (!url) return { data: await emptyTile() };
  const r = await getRaw(url);
  if (r.status === 'ok') {
    if (BLANK_CHECK.has(id) && await isBlankTile(r.buf)) return { data: await emptyTile() };
    return { data: r.buf };
  }
  if (r.status === 'error' || BASES.includes(id)) {
    const fb = await ancestorFallback(id, zi, xi, yi);
    if (fb) return { data: fb };
  }
  return { data: await emptyTile() };
});

/* =====================================================================
 * Terreno (Mapterhorn, Terrarium 512 px webp) con fallback ai livelli inferiori
 * ===================================================================== */
const DEM_TS = 512;
const DEM_URL = (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
const regionMiss = new Map(); // antenato z12 → zoom minimo risultato mancante

async function fetchDemRaw(z, x, y) {
  let rk = null;
  if (z > 12) {
    rk = (x >> (z - 12)) + '/' + (y >> (z - 12));
    const m = regionMiss.get(rk);
    if (m !== undefined && z >= m) return { status: 'missing' };
  }
  const r = await getRaw(DEM_URL(z, x, y));
  if (r.status === 'missing' && rk) regionMiss.set(rk, Math.min(regionMiss.get(rk) ?? 99, z));
  return r;
}

async function decodeTerrarium(buf) {
  const bmp = await createImageBitmap(new Blob([buf]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const w = bmp.width, c = new OffscreenCanvas(w, w), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, w);
  const d = g.getImageData(0, 0, w, w).data, n = w * w, e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return w === DEM_TS ? e : resample(e, w, 0, 0, w, DEM_TS);
}
// Ricampiona (bilineare) la finestra [ox,oy,size] di src (lato sw) a una griglia out×out
function resample(src, sw, ox, oy, size, out) {
  const r = new Float32Array(out * out), k = size / out;
  for (let j = 0; j < out; j++) {
    const fy = Math.min(Math.max(oy + (j + 0.5) * k - 0.5, 0), sw - 1), y0 = Math.floor(fy), y1 = Math.min(y0 + 1, sw - 1), ty = fy - y0;
    for (let i = 0; i < out; i++) {
      const fx = Math.min(Math.max(ox + (i + 0.5) * k - 0.5, 0), sw - 1), x0 = Math.floor(fx), x1 = Math.min(x0 + 1, sw - 1), tx = fx - x0;
      r[j * out + i] = (src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx) * (1 - ty) + (src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx) * ty;
    }
  }
  return r;
}
async function encodeTerrarium(arr) {
  const n = DEM_TS * DEM_TS, px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = arr[i] + 32768, f = Math.floor(v);
    px[i * 4] = f >> 8; px[i * 4 + 1] = f & 255; px[i * 4 + 2] = Math.floor((v - f) * 256); px[i * 4 + 3] = 255;
  }
  const cv = new OffscreenCanvas(DEM_TS, DEM_TS);
  cv.getContext('2d').putImageData(new ImageData(px, DEM_TS, DEM_TS), 0, 0);
  return (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

// Cache in memoria degli array di quota (LRU semplice)
const demMem = new Map(), demReady = new Map(), DEM_MEM_MAX = 40;
function getDemArray(z, x, y) {
  const n = 1 << z; x = ((x % n) + n) % n;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = z + '/' + x + '/' + y;
  if (demMem.has(key)) { const p = demMem.get(key); demMem.delete(key); demMem.set(key, p); return p; }
  const p = (async () => {
    const r = await fetchDemRaw(z, x, y);
    if (r.status === 'ok') { try { return await decodeTerrarium(r.buf); } catch {} }
    if (z === 0) return null;
    const parent = await getDemArray(z - 1, x >> 1, y >> 1);
    return parent ? resample(parent, DEM_TS, (x & 1) * 256, (y & 1) * 256, 256, DEM_TS) : null;
  })().then(a => { if (a) demReady.set(key, a); else demMem.delete(key); return a; });
  demMem.set(key, p);
  while (demMem.size > DEM_MEM_MAX) { const k = demMem.keys().next().value; demMem.delete(k); demReady.delete(k); }
  return p;
}

maplibregl.addProtocol('dem', async (params) => {
  const [z, x, y] = params.url.slice(6).split('/').map(Number);
  const r = await fetchDemRaw(z, x, y);
  if (r.status === 'ok') return { data: r.buf };
  const arr = await getDemArray(z, x, y);
  if (!arr) throw new Error('DEM non disponibile');
  return { data: await encodeTerrarium(arr) };
});

/* =====================================================================
 * Pendenza / esposizione (calcolate dal DEM, funzionano offline)
 * ===================================================================== */
const SLOPE_CLASSES = [
  [27, 30, [244, 224, 77], '27–30°'], [30, 35, [255, 196, 0], '30–35°'], [35, 40, [255, 128, 0], '35–40°'],
  [40, 45, [232, 34, 43], '40–45°'], [45, 50, [170, 30, 190], '45–50°'], [50, 91, [40, 20, 80], '> 50°'],
];
function slopeRGB(s) { if (!(s >= 27)) return null; for (const c of SLOPE_CLASSES) if (s < c[1]) return c[2]; return SLOPE_CLASSES[5][2]; }
const ASPECTS = [['N', [30, 90, 230]], ['NE', [0, 190, 220]], ['E', [40, 190, 70]], ['SE', [170, 220, 40]],
  ['S', [255, 220, 0]], ['SO', [255, 140, 0]], ['O', [230, 40, 40]], ['NO', [160, 50, 200]]];
const aspectIdx = a => Math.floor(((a + 22.5) % 360) / 45);

async function renderAnalysis(kind, z, x, y) {
  const dem = await getDemArray(z, x, y), T = DEM_TS, out = new Uint8ClampedArray(T * T * 4);
  if (dem) {
    const n = 1 << z;
    for (let r = 0; r < T; r++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y * T + r + 0.5) / (T * n))));
      const cell = EARTH_C * Math.cos(lat) / (T * n);
      const rm = r > 0 ? r - 1 : 0, rp = r < T - 1 ? r + 1 : T - 1, dy = (rp - rm) * cell;
      for (let c = 0; c < T; c++) {
        const cm = c > 0 ? c - 1 : 0, cp = c < T - 1 ? c + 1 : T - 1;
        const dzdx = (dem[r * T + cp] - dem[r * T + cm]) / ((cp - cm) * cell);
        const dzdy = (dem[rp * T + c] - dem[rm * T + c]) / dy;
        const s = Math.atan(Math.hypot(dzdx, dzdy)) * R2D;
        let col = null;
        if (kind === 'slope') col = slopeRGB(s);
        else if (s >= 15) { let a = Math.atan2(-dzdx, dzdy) * R2D; if (a < 0) a += 360; col = ASPECTS[aspectIdx(a)][1]; }
        if (col) { const i = (r * T + c) * 4; out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2]; out[i + 3] = 255; }
      }
    }
  }
  const cv = new OffscreenCanvas(T, T);
  cv.getContext('2d').putImageData(new ImageData(out, T, T), 0, 0);
  return (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
for (const kind of ['slope', 'aspect']) {
  maplibregl.addProtocol(kind, async (params) => {
    const [z, x, y] = params.url.split('://')[1].split('/').map(Number);
    return { data: await renderAnalysis(kind, z, x, y) };
  });
}

/* =====================================================================
 * Geometria
 * ===================================================================== */
function worldPx(lng, lat, z, ts = DEM_TS) {
  const s = ts * Math.pow(2, z), sl = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * D2R);
  return [(lng + 180) / 360 * s, (0.5 - Math.log((1 + sl) / (1 - sl)) / (4 * Math.PI)) * s];
}
const tileXY = (lng, lat, z) => worldPx(lng, lat, z, 1).map(Math.floor);
function tileBounds(z, x, y) {
  const n = Math.pow(2, z), lng = v => v / n * 360 - 180, lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * R2D;
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)];
}
function tileInBounds(z, x, y, b) { const t = tileBounds(z, x, y); return t[2] > b[0] && t[0] < b[2] && t[3] > b[1] && t[1] < b[3]; }
function haversine(a, b) {
  const dLat = (b[1] - a[1]) * D2R, dLng = (b[0] - a[0]) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}
function densify(cs, step) {
  const out = [cs[0]];
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i], n = Math.max(1, Math.ceil(haversine(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

// Lettura sincrona del DEM a zoom di analisi (dopo il precaricamento)
const AZ = 14;
function pxSync(ix, iy) {
  const n = 1 << AZ, tx = Math.floor(ix / DEM_TS), ty = Math.floor(iy / DEM_TS);
  const e = demReady.get(AZ + '/' + (((tx % n) + n) % n) + '/' + ty);
  return e ? e[(iy - ty * DEM_TS) * DEM_TS + (ix - tx * DEM_TS)] : NaN;
}
function elevSync(lng, lat) {
  const [px, py] = worldPx(lng, lat, AZ);
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5), fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  return (pxSync(x0, y0) * (1 - fx) + pxSync(x0 + 1, y0) * fx) * (1 - fy) + (pxSync(x0, y0 + 1) * (1 - fx) + pxSync(x0 + 1, y0 + 1) * fx) * fy;
}
function slopeAspectSync(lng, lat) {
  const [px, py] = worldPx(lng, lat, AZ), ix = Math.floor(px), iy = Math.floor(py);
  const cell = EARTH_C * Math.cos(lat * D2R) / (DEM_TS * (1 << AZ));
  const dzdx = (pxSync(ix + 1, iy) - pxSync(ix - 1, iy)) / (2 * cell);
  const dzdy = (pxSync(ix, iy + 1) - pxSync(ix, iy - 1)) / (2 * cell);
  let a = Math.atan2(-dzdx, dzdy) * R2D; if (a < 0) a += 360;
  return [Math.atan(Math.hypot(dzdx, dzdy)) * R2D, a];
}
function preloadDem(points) {
  const keys = new Set(), jobs = [];
  for (const [lng, lat] of points) {
    const [px, py] = worldPx(lng, lat, AZ);
    for (const dx of [-2, 2]) for (const dy of [-2, 2]) {
      const tx = Math.floor((px + dx) / DEM_TS), ty = Math.floor((py + dy) / DEM_TS), k = tx + '/' + ty;
      if (!keys.has(k)) { keys.add(k); jobs.push(getDemArray(AZ, tx, ty)); }
    }
  }
  return Promise.all(jobs);
}

/* =====================================================================
 * Mappa
 * ===================================================================== */
function rasterSource(id) {
  const s = SRC[id], o = { type: 'raster', tiles: [tileUrl(id)], tileSize: s.ts, maxzoom: s.max, attribution: s.attr };
  if (s.bounds) o.bounds = s.bounds;
  return o;
}
const demSource = () => ({ type: 'raster-dem', tiles: ['dem://{z}/{x}/{y}'], tileSize: DEM_TS, encoding: 'terrarium', maxzoom: settings.demMax,
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>' });
const sources = { dem: demSource(), demHs: demSource(),
  slope: { type: 'raster', tiles: ['slope://{z}/{x}/{y}'], tileSize: DEM_TS, maxzoom: 15 },
  aspect: { type: 'raster', tiles: ['aspect://{z}/{x}/{y}'], tileSize: DEM_TS, maxzoom: 15 } };
for (const id of Object.keys(SRC)) sources[id] = rasterSource(id);
const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b1f26' } }];
for (const id of [...BASES, 'ch', 'fr']) layers.push({ id, type: 'raster', source: id, layout: { visibility: 'none' } });
layers.push({ id: 'hill', type: 'hillshade', source: 'demHs', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': '#1a1a2a' } });
for (const id of ['slope', 'aspect']) layers.push({ id, type: 'raster', source: id, minzoom: 10, layout: { visibility: 'none' }, paint: { 'raster-resampling': 'nearest' } });
for (const id of EXTRAS) layers.push({ id, type: 'raster', source: id, layout: { visibility: 'none' } });

const map = new maplibregl.Map({
  container: 'map', ...settings.view, maxPitch: 85, attributionControl: { compact: true },
  style: Object.assign({ version: 8, sources, layers }, settings.terrain3d ? { terrain: { source: 'dem', exaggeration: settings.exag } } : {}),
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true });
map.addControl(geolocate, 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
map.on('moveend', () => {
  const c = map.getCenter();
  settings.view = { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()) };
  saveSettings();
});
map.on('error', e => { if (e && e.error && !/DEM non disponibile|AbortError/.test(e.error.message || '')) console.warn(e.error); });

const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
map.on('load', () => {
  try { map.setSky({ 'sky-color': '#7fb2e5', 'horizon-color': '#dfe9f3', 'fog-color': '#dfe9f3', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.25 }); } catch {}
  for (const s of ['packs', 'route', 'vertices', 'rec', 'hover']) map.addSource(s, { type: 'geojson', data: emptyFC() });
  map.addLayer({ id: 'packs', type: 'line', source: 'packs', paint: { 'line-color': '#ffd54f', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#071018', 'line-width': 7, 'line-opacity': 0.6 } });
  map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4fc3f7', 'line-width': 4 } });
  map.addLayer({ id: 'rec-line', type: 'line', source: 'rec', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ff5252', 'line-width': 4 } });
  map.addLayer({ id: 'route-vtx', type: 'circle', source: 'vertices', paint: { 'circle-radius': ['case', ['==', ['get', 'i'], 0], 7, 5.5], 'circle-color': ['case', ['==', ['get', 'i'], 0], '#4caf50', '#fff'], 'circle-stroke-color': '#0288d1', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'hover-pt', type: 'circle', source: 'hover', paint: { 'circle-radius': 7, 'circle-color': '#ff4081', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  applyLayers();
  renderPacks();
  if (coords.length) updateRoute();
});

/* =====================================================================
 * Gestione layer + pannello Mappe/Terreno
 * ===================================================================== */
function setVis(id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
function applyLayers() {
  for (const b of BASES) setVis(b, settings.base === b);
  setVis('ch', settings.ortoCH && settings.base === 'esri');
  setVis('fr', settings.ortoFR && settings.base === 'esri');
  setVis('hill', settings.hill);
  setVis('slope', settings.overlay === 'slope'); setVis('aspect', settings.overlay === 'aspect');
  for (const l of ['slope', 'aspect']) if (map.getLayer(l)) map.setPaintProperty(l, 'raster-opacity', settings.ovOpacity);
  for (const x of EXTRAS) setVis(x, !!settings.extras[x]);
}
function refreshSource(id) { srcVer[id] = (srcVer[id] || 0) + 1; const s = map.getSource(id); if (s) s.setTiles([tileUrl(id)]); }

function initLayerUI() {
  document.querySelectorAll('input[name=base]').forEach(r => {
    r.checked = r.value === settings.base;
    r.onchange = () => { settings.base = r.value; saveSettings(); applyLayers(); syncBaseBoxes(); updateCaptureDate(); };
  });
  $('oCH').checked = settings.ortoCH; $('oFR').checked = settings.ortoFR;
  $('oCH').onchange = e => { settings.ortoCH = e.target.checked; saveSettings(); applyLayers(); };
  $('oFR').onchange = e => { settings.ortoFR = e.target.checked; saveSettings(); applyLayers(); };
  document.querySelectorAll('[data-x]').forEach(c => {
    c.checked = !!settings.extras[c.dataset.x];
    c.onchange = () => { settings.extras[c.dataset.x] = c.checked; saveSettings(); applyLayers(); };
  });
  // Sentinel-2
  const s = settings.s2;
  $('s2Inst').value = s.instance; $('s2Layer').value = s.layer; $('s2From').value = s.from; $('s2To').value = s.to;
  $('s2cc').value = s.maxcc; $('s2ccV').textContent = s.maxcc + '%';
  $('s2cc').oninput = e => $('s2ccV').textContent = e.target.value + '%';
  $('s2Apply').onclick = () => {
    Object.assign(s, { instance: $('s2Inst').value.trim(), layer: $('s2Layer').value.trim() || 'TRUE_COLOR', from: $('s2From').value, to: $('s2To').value, maxcc: +$('s2cc').value });
    saveSettings(); refreshSource('s2'); toast(s.instance ? 'Sentinel-2 aggiornato' : 'Inserisci l\'ID istanza');
  };
  // Wayback
  $('wbSel').onchange = () => selectWayback($('wbSel').selectedIndex);
  $('wbPrev').onclick = () => selectWayback(Math.max(0, $('wbSel').selectedIndex - 1));
  $('wbNext').onclick = () => selectWayback(Math.min(wbReleases.length - 1, $('wbSel').selectedIndex + 1));
  syncBaseBoxes();

  // Terreno
  $('t3d').checked = settings.terrain3d;
  $('t3d').onchange = e => {
    settings.terrain3d = e.target.checked; saveSettings();
    if (settings.terrain3d) { map.setTerrain({ source: 'dem', exaggeration: settings.exag }); map.easeTo({ pitch: 60 }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0 }); }
  };
  $('exag').value = settings.exag; $('exagV').textContent = settings.exag.toFixed(1) + '×';
  $('exag').oninput = e => {
    settings.exag = +e.target.value; $('exagV').textContent = settings.exag.toFixed(1) + '×'; saveSettings();
    if (settings.terrain3d) map.setTerrain({ source: 'dem', exaggeration: settings.exag });
  };
  $('tHill').checked = settings.hill;
  $('tHill').onchange = e => { settings.hill = e.target.checked; saveSettings(); applyLayers(); };
  $('ovOp').value = settings.ovOpacity;
  $('ovOp').oninput = e => { settings.ovOpacity = +e.target.value; saveSettings(); applyLayers(); };
  $('ovSeg').onclick = e => { const o = e.target.dataset.o; if (!o) return; settings.overlay = o; saveSettings(); applyLayers(); renderLegend(); };
  renderLegend();
}
function syncBaseBoxes() {
  $('waybackBox').hidden = settings.base !== 'wayback';
  $('s2Box').hidden = settings.base !== 's2';
  if (settings.base === 'wayback' || settings.base === 'esri') loadWayback();
  if (settings.base === 's2' && !settings.s2.instance) toast('Configura Sentinel-2 qui sotto');
}
function renderLegend() {
  [...$('ovSeg').children].forEach(c => c.classList.toggle('on', c.dataset.o === settings.overlay));
  const rgb = c => `rgb(${c.join(',')})`; let h = '';
  if (settings.overlay === 'slope') for (const c of SLOPE_CLASSES) h += `<span class="sw" style="background:${rgb(c[2])}"></span><span>${c[3]}</span>`;
  if (settings.overlay === 'aspect') for (const a of ASPECTS) h += `<span class="sw" style="background:${rgb(a[1])}"></span><span>${a[0]}</span>`;
  $('legend').innerHTML = h;
}

// --- Esri Wayback ---
let wbReleases = [], wbLoading = null;
function loadWayback() {
  if (wbReleases.length || wbLoading) return wbLoading;
  wbLoading = (async () => {
    try {
      const url = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
      let js;
      try { // rete prima (nuove versioni), poi cache
        const net = await fetch(url, { cache: 'no-cache' }); if (!net.ok) throw 0;
        const buf = await net.arrayBuffer(); js = JSON.parse(new TextDecoder().decode(buf));
        if (HAS_CACHE) rtPut(url, buf, 'application/json');
      } catch {
        const r = await getRaw(url); if (r.status !== 'ok') throw new Error('rete');
        js = JSON.parse(new TextDecoder().decode(r.buf));
      }
      wbReleases = Object.entries(js).map(([num, v]) => ({ num: +num, title: v.itemTitle, tpl: v.itemURL, meta: v.metadataLayerUrl, date: (v.itemTitle.match(/\d{4}-\d{2}-\d{2}/) || [''])[0] }))
        .filter(v => v.tpl).sort((a, b) => b.date.localeCompare(a.date));
      $('wbSel').innerHTML = wbReleases.map(v => `<option>${esc(v.date || v.title)}</option>`).join('');
      let idx = settings.wayback ? wbReleases.findIndex(v => v.num === settings.wayback.num) : 0;
      selectWayback(idx < 0 ? 0 : idx, true);
      updateCaptureDate();
    } catch {
      $('wbSel').innerHTML = settings.wayback ? `<option>${esc(settings.wayback.date || 'versione salvata')}</option>` : '<option>Non disponibile offline</option>';
    } finally { wbLoading = null; }
  })();
  return wbLoading;
}
function selectWayback(i, silent) {
  const v = wbReleases[i]; if (!v) return;
  $('wbSel').selectedIndex = i;
  if (settings.wayback && settings.wayback.num === v.num && !silent) return;
  const changed = !settings.wayback || settings.wayback.num !== v.num;
  settings.wayback = { num: v.num, tpl: v.tpl, date: v.date, meta: v.meta }; saveSettings();
  if (changed) { refreshSource('wayback'); updateCaptureDate(); }
}

// --- Data di ripresa dell'immagine Esri al centro della vista (metadati Wayback) ---
const metaLayersCache = new Map();
async function metaLayerFor(url, zoom) {
  if (!metaLayersCache.has(url)) metaLayersCache.set(url, fetch(url + '?f=json').then(r => r.json()).then(j => j.layers || []).catch(() => { metaLayersCache.delete(url); return []; }));
  const ls = await metaLayersCache.get(url), scale = 591657527.59 / Math.pow(2, zoom);
  const l = ls.find(l => (!l.minScale || scale <= l.minScale) && (!l.maxScale || scale >= l.maxScale));
  return l ? l.id : null;
}
async function updateCaptureDate() {
  const badge = $('dateBadge');
  const metaUrl = settings.base === 'wayback' ? settings.wayback?.meta : settings.base === 'esri' ? wbReleases[0]?.meta : null;
  if (!metaUrl || !navigator.onLine || map.getZoom() < 11) { badge.hidden = true; return; }
  const v = ++updateCaptureDate.v, z = Math.min(Math.round(map.getZoom() + 1), 19), c = map.getCenter();
  try {
    const lid = await metaLayerFor(metaUrl, z); if (lid == null) throw 0;
    const q = `${metaUrl}/${lid}/query?geometry=${c.lng},${c.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const js = await (await fetch(q)).json(); if (v !== updateCaptureDate.v) return;
    const a = js.features && js.features[0] && js.features[0].attributes; if (!a) throw 0;
    let d = a.SRC_DATE2 ? new Date(a.SRC_DATE2) : null;
    if (!d && a.SRC_DATE) { const t = String(a.SRC_DATE); d = new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8) || 1); }
    if (!d || isNaN(d)) throw 0;
    const m = d.getMonth(), winter = m <= 3 || m >= 10;
    badge.innerHTML = `${winter ? '❄️' : '☀️'} Ripresa ${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}${a.SRC_RES ? ' · ' + (+a.SRC_RES).toFixed(2).replace(/\.?0+$/, '') + ' m' : ''}${a.NICE_DESC || a.SRC_DESC ? ' · ' + esc(a.NICE_DESC || a.SRC_DESC) : ''}`;
    badge.hidden = false;
  } catch { if (v === updateCaptureDate.v) badge.hidden = true; }
}
updateCaptureDate.v = 0;
map.on('moveend', () => { clearTimeout(updateCaptureDate.t); updateCaptureDate.t = setTimeout(updateCaptureDate, 600); });

/* =====================================================================
 * Pannelli (bottom sheet)
 * ===================================================================== */
let activePanel = null;
function openPanel(p) {
  if (activePanel === p) return closePanel();
  activePanel = p;
  document.querySelectorAll('.sheetBody section').forEach(s => s.classList.toggle('act', s.dataset.p === p));
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('act', b.dataset.p === p));
  $('sheetTitle').textContent = document.querySelector(`section[data-p="${p}"]`).dataset.title;
  $('sheet').hidden = false;
  if (p === 'saved') renderSaved();
  if (p === 'offline') { renderPacks(); updateStorageInfo(); }
}
function closePanel() {
  activePanel = null; $('sheet').hidden = true;
  document.querySelectorAll('#nav button').forEach(b => b.classList.remove('act'));
}
$('nav').onclick = e => { const b = e.target.closest('button'); if (b) openPanel(b.dataset.p); };
$('sheetClose').onclick = closePanel;

/* =====================================================================
 * Ricerca
 * ===================================================================== */
let searchT;
$('q').addEventListener('input', e => {
  clearTimeout(searchT);
  const q = e.target.value.trim();
  if (!q) { $('results').innerHTML = ''; return; }
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*$/);
  if (m) { $('results').innerHTML = `<div data-lng="${m[2]}" data-lat="${m[1]}">📍 Vai a ${m[1]}, ${m[2]}</div>`; return; }
  searchT = setTimeout(async () => {
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=it&q=' + encodeURIComponent(q));
      const js = await r.json();
      $('results').innerHTML = js.map(p => `<div data-lng="${p.lon}" data-lat="${p.lat}">${esc(p.display_name)}</div>`).join('') || '<div>Nessun risultato</div>';
    } catch { $('results').innerHTML = '<div>Ricerca non disponibile offline</div>'; }
  }, 450);
});
$('results').onclick = e => {
  const d = e.target.closest('[data-lng]'); if (!d) return;
  map.flyTo({ center: [+d.dataset.lng, +d.dataset.lat], zoom: 13.5, pitch: settings.terrain3d ? 60 : 0, essential: true });
  $('results').innerHTML = ''; $('q').blur();
};

/* =====================================================================
 * Percorso: disegno, trascinamento, analisi, profilo
 * ===================================================================== */
let coords = LS.get('fm.draft', []), drawing = false, profile = [], analyzeV = 0, dragIdx = -1, justDragged = false;
let infoPopup = null;

function setDrawing(on) {
  drawing = on;
  $('drawbar').hidden = !on;
  $('bDraw').classList.toggle('on', on);
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  map.doubleClickZoom[on ? 'disable' : 'enable']();
  if (on) { closePanel(); toast('Tocca la mappa per aggiungere punti'); }
}
$('bDraw').onclick = () => setDrawing(!drawing);
$('dDone').onclick = () => setDrawing(false);
$('dUndo').onclick = () => { coords.pop(); updateRoute(); };
$('dClear').onclick = () => { coords = []; $('rName').value = ''; currentRouteId = null; updateRoute(); };

map.on('click', async e => {
  if (justDragged) return;
  if (drawing) { coords.push([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]); updateRoute(); return; }
  if (activePanel) { closePanel(); return; }
  // Info punto
  const { lng, lat } = e.lngLat;
  if (infoPopup) infoPopup.remove();
  infoPopup = new maplibregl.Popup({ closeButton: true, offset: 8 }).setLngLat(e.lngLat).setHTML('…').addTo(map);
  await preloadDem([[lng, lat]]);
  const ele = elevSync(lng, lat), [s, a] = slopeAspectSync(lng, lat);
  infoPopup.setHTML(isNaN(ele) ? 'Quota non disponibile' :
    `<b>${Math.round(ele)} m</b> · pendenza <b>${s.toFixed(0)}°</b>${s >= 5 ? ` · esp. <b>${ASPECTS[aspectIdx(a)][0]}</b>` : ''}<br><span class="muted">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`);
});

// Trascinamento dei vertici
function startDrag(e) {
  if (!drawing) return;
  if (e.type === 'touchstart' && e.points.length !== 1) return;
  e.preventDefault();
  dragIdx = e.features[0].properties.i;
  const move = ev => { coords[dragIdx] = [+ev.lngLat.lng.toFixed(6), +ev.lngLat.lat.toFixed(6)]; updateGeom(); };
  const end = () => {
    map.off('mousemove', move); map.off('touchmove', move);
    dragIdx = -1; justDragged = true; setTimeout(() => justDragged = false, 80); updateRoute();
  };
  map.on(e.type === 'touchstart' ? 'touchmove' : 'mousemove', move);
  map.once(e.type === 'touchstart' ? 'touchend' : 'mouseup', end);
}
map.on('mousedown', 'route-vtx', startDrag);
map.on('touchstart', 'route-vtx', startDrag);
map.on('mouseenter', 'route-vtx', () => { if (drawing) map.getCanvas().style.cursor = 'move'; });
map.on('mouseleave', 'route-vtx', () => { if (drawing) map.getCanvas().style.cursor = 'crosshair'; });

function updateGeom() {
  if (!map.getSource('route')) return;
  map.getSource('route').setData(coords.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } : emptyFC());
  const show = coords.length <= 400;
  map.getSource('vertices').setData({ type: 'FeatureCollection', features: (show ? coords : [coords[0]]).filter(Boolean).map((c, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: c } })) });
}
function updateRoute() {
  LS.set('fm.draft', coords);
  updateGeom();
  clearTimeout(updateRoute.t); updateRoute.t = setTimeout(analyze, 150);
}

async function analyze() {
  const v = ++analyzeV;
  if (coords.length < 2) { profile = []; showProfile(false); $('stats').innerHTML = ''; return; }
  const pts = densify(coords, 20);
  await preloadDem(pts);
  if (v !== analyzeV) return;
  let dist = 0;
  profile = pts.map((p, i) => {
    if (i) dist += haversine(pts[i - 1], p);
    return { d: dist, e: elevSync(p[0], p[1]), s: slopeAspectSync(p[0], p[1])[0], lng: p[0], lat: p[1] };
  }).filter(p => !isNaN(p.e));
  if (profile.length < 2) { showProfile(false); return; }
  let up = 0, down = 0, ref = profile[0].e, maxE = -1e9, minE = 1e9, maxS = 0;
  for (const p of profile) {
    const df = p.e - ref;
    if (df >= 5) { up += df; ref = p.e; } else if (df <= -5) { down -= df; ref = p.e; }
    maxE = Math.max(maxE, p.e); minE = Math.min(minE, p.e); if (!isNaN(p.s)) maxS = Math.max(maxS, p.s);
  }
  const km = dist / 1000, th = km / 4, tv = up / 300 + down / 500, t = Math.max(th, tv) + Math.min(th, tv) / 2;
  const hh = Math.floor(t), mm = Math.round((t - hh) * 60), tt = `${hh}h${String(mm).padStart(2, '0')}`;
  const st = { km, up, down, maxE, minE, maxS, tt };
  $('stats').innerHTML = [['Distanza', km.toFixed(2) + ' km'], ['D+', Math.round(up) + ' m'], ['D−', Math.round(down) + ' m'],
    ['Quota max', Math.round(maxE) + ' m'], ['Pend. max', maxS.toFixed(0) + '°'], ['Tempo', tt]]
    .map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join('');
  $('pStats').innerHTML = `<b>${km.toFixed(1)} km</b> · <b>+${Math.round(up)}</b>/−${Math.round(down)} m · max <b>${Math.round(maxE)} m</b> · <b>${maxS.toFixed(0)}°</b> · ${tt}`;
  showProfile(true); drawProfile();
  return st;
}

function showProfile(on) {
  $('profile').hidden = !on;
  document.body.classList.toggle('hasProfile', on && !$('profile').classList.contains('min'));
}
$('pToggle').onclick = () => {
  const p = $('profile'); p.classList.toggle('min');
  $('pToggle').textContent = p.classList.contains('min') ? '▴' : '▾';
  showProfile(true); drawProfile();
};

const pc = $('pc'); let hoverI = -1;
const PAD = { l: 42, r: 10, t: 8, b: 18 };
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function drawProfile() {
  if (!profile.length || $('profile').classList.contains('min') || $('profile').hidden) return;
  const dpr = devicePixelRatio || 1, W = pc.clientWidth, H = pc.clientHeight;
  if (!W || !H) return;
  pc.width = W * dpr; pc.height = H * dpr;
  const g = pc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const D = profile[profile.length - 1].d;
  let mn = Infinity, mx = -Infinity; for (const p of profile) { mn = Math.min(mn, p.e); mx = Math.max(mx, p.e); }
  const span = Math.max(50, mx - mn); mn -= span * 0.08; mx += span * 0.08;
  const X = d => PAD.l + d / D * (W - PAD.l - PAD.r), Y = e => PAD.t + (1 - (e - mn) / (mx - mn)) * (H - PAD.t - PAD.b);
  g.font = '10px system-ui'; g.fillStyle = '#8b95a5'; g.strokeStyle = '#2a313c'; g.lineWidth = 1;
  const sE = niceStep((mx - mn) / 3);
  for (let e = Math.ceil(mn / sE) * sE; e <= mx; e += sE) {
    g.beginPath(); g.moveTo(PAD.l, Y(e)); g.lineTo(W - PAD.r, Y(e)); g.stroke();
    g.textAlign = 'right'; g.fillText(e + '', PAD.l - 4, Y(e) + 3);
  }
  const sD = niceStep(D / 5); g.textAlign = 'center';
  for (let d = 0; d <= D; d += sD) g.fillText((d / 1000).toFixed(sD < 1000 ? 1 : 0) + ' km', X(d), H - 4);
  const grad = g.createLinearGradient(0, PAD.t, 0, H - PAD.b);
  grad.addColorStop(0, 'rgba(79,195,247,.35)'); grad.addColorStop(1, 'rgba(79,195,247,0)');
  g.beginPath(); g.moveTo(X(0), H - PAD.b);
  for (const p of profile) g.lineTo(X(p.d), Y(p.e));
  g.lineTo(X(D), H - PAD.b); g.closePath(); g.fillStyle = grad; g.fill();
  g.lineWidth = 2.5; g.lineCap = 'round';
  for (let i = 1; i < profile.length; i++) {
    const c = slopeRGB(profile[i].s);
    g.strokeStyle = c ? `rgb(${c.join(',')})` : '#e8ecf1';
    g.beginPath(); g.moveTo(X(profile[i - 1].d), Y(profile[i - 1].e)); g.lineTo(X(profile[i].d), Y(profile[i].e)); g.stroke();
  }
  if (hoverI >= 0 && profile[hoverI]) {
    const p = profile[hoverI], x = X(p.d);
    g.strokeStyle = '#ff4081'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, H - PAD.b); g.stroke();
    g.fillStyle = '#ff4081'; g.beginPath(); g.arc(x, Y(p.e), 4, 0, 7); g.fill();
    const txt = `${(p.d / 1000).toFixed(2)} km · ${Math.round(p.e)} m · ${isNaN(p.s) ? '–' : p.s.toFixed(0) + '°'}`;
    g.font = '600 11px system-ui'; const tw = g.measureText(txt).width + 12;
    const bx = Math.min(Math.max(x - tw / 2, PAD.l), W - PAD.r - tw);
    g.fillStyle = 'rgba(7,16,24,.9)'; g.fillRect(bx, PAD.t, tw, 18);
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.fillText(txt, bx + 6, PAD.t + 13);
  }
}
function profileHover(e) {
  if (!profile.length) return;
  const r = pc.getBoundingClientRect(), D = profile[profile.length - 1].d;
  const d = (e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r) * D;
  let lo = 0, hi = profile.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (profile[m].d < d) lo = m; else hi = m; }
  hoverI = Math.abs(profile[lo].d - d) < Math.abs(profile[hi].d - d) ? lo : hi;
  const p = profile[hoverI];
  map.getSource('hover')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  drawProfile();
}
pc.addEventListener('pointerdown', e => { pc.setPointerCapture(e.pointerId); profileHover(e); });
pc.addEventListener('pointermove', profileHover);
pc.addEventListener('pointerleave', () => { hoverI = -1; map.getSource('hover')?.setData(emptyFC()); drawProfile(); });
addEventListener('resize', () => drawProfile());

function fitCoords(cs) {
  if (!cs.length) return;
  const b = new maplibregl.LngLatBounds(cs[0], cs[0]); cs.forEach(c => b.extend(c));
  const wide = innerWidth >= 760;
  map.fitBounds(b, { padding: { top: 80, bottom: 260, left: wide ? 400 : 30, right: 60 }, pitch: settings.terrain3d ? 55 : 0, duration: 1200, maxZoom: 15.5 });
}

/* =====================================================================
 * Salvataggio percorsi
 * ===================================================================== */
let currentRouteId = LS.get('fm.currentRoute', null);
const loadRoutes = () => LS.get('fm.routes', []);
const storeRoutes = l => LS.set('fm.routes', l);

$('bSave').onclick = () => {
  if (coords.length < 2) return toast('Traccia prima un percorso');
  const l = loadRoutes(), name = $('rName').value.trim() || 'Percorso ' + new Date().toLocaleDateString('it-IT');
  const ex = currentRouteId && l.find(r => r.id === currentRouteId);
  if (ex) { ex.name = name; ex.coords = coords.slice(); ex.updated = Date.now(); }
  else { currentRouteId = Date.now(); l.unshift({ id: currentRouteId, name, coords: coords.slice(), created: Date.now() }); }
  if (!storeRoutes(l)) return toast('Spazio di salvataggio esaurito');
  LS.set('fm.currentRoute', currentRouteId);
  $('rName').value = name; toast('Percorso salvato ✓');
};
function openRoute(r) {
  coords = r.coords.slice(); currentRouteId = r.id; LS.set('fm.currentRoute', r.id);
  $('rName').value = r.name; updateRoute(); fitCoords(coords); closePanel();
}
function renderSaved() {
  const l = loadRoutes(), packs = loadPacks();
  $('savedList').innerHTML = l.length ? l.map(r => {
    const km = r.coords.reduce((s, c, i, a) => i ? s + haversine(a[i - 1], c) : 0, 0) / 1000;
    const off = packs.some(p => p.routeId === r.id);
    return `<div class="item" data-id="${r.id}"><div class="nm"><b>${esc(r.name)}</b><span class="muted">${km.toFixed(1)} km${off ? ' · 📶 offline' : ''}</span></div>
      <button data-a="open">Apri</button><button data-a="dl" title="Scarica offline">⬇</button><button data-a="del" class="danger">✕</button></div>`;
  }).join('') : '<p class="muted">Nessun percorso salvato. Tracciane uno dalla scheda Traccia.</p>';
}
$('savedList').onclick = e => {
  const b = e.target.closest('button'), it = e.target.closest('.item'); if (!b || !it) return;
  const id = +it.dataset.id, r = loadRoutes().find(x => x.id === id); if (!r) return;
  if (b.dataset.a === 'open') openRoute(r);
  if (b.dataset.a === 'dl') { openRoute(r); openPanel('offline'); planDownload('route'); }
  if (b.dataset.a === 'del') {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Elimina?'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '✕'; }, 3000); return; }
    storeRoutes(loadRoutes().filter(x => x.id !== id));
    if (currentRouteId === id) currentRouteId = null;
    renderSaved();
  }
};

/* =====================================================================
 * GPX
 * ===================================================================== */
$('fGpx').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const xml = new DOMParser().parseFromString(await f.text(), 'application/xml');
    let nodes = xml.getElementsByTagName('trkpt');
    if (!nodes.length) nodes = xml.getElementsByTagName('rtept');
    if (!nodes.length) nodes = xml.getElementsByTagName('wpt');
    let cs = [...nodes].map(n => [+n.getAttribute('lon'), +n.getAttribute('lat')]).filter(c => isFinite(c[0]) && isFinite(c[1]));
    if (cs.length > 3000) { const k = Math.ceil(cs.length / 3000); cs = cs.filter((_, i) => i % k === 0 || i === cs.length - 1); }
    if (cs.length < 2) throw new Error('nessuna traccia');
    coords = cs; currentRouteId = null;
    const nm = xml.getElementsByTagName('name')[0];
    $('rName').value = nm ? nm.textContent.trim() : f.name.replace(/\.gpx$/i, '');
    updateRoute(); fitCoords(coords); closePanel(); toast('GPX importato · ricordati di salvarlo');
  } catch (err) { toast('GPX non valido: ' + err.message); }
  e.target.value = '';
};
$('bExport').onclick = () => {
  if (coords.length < 2) return toast('Nessun percorso da esportare');
  const name = ($('rName').value || 'Percorso').replace(/[<&>]/g, '');
  const pts = profile.length ? profile : coords.map(c => ({ lng: c[0], lat: c[1], e: NaN }));
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Cresta 3D" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${name}</name><trkseg>\n` +
    pts.map(p => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">${isNaN(p.e) ? '' : `<ele>${p.e.toFixed(1)}</ele>`}</trkpt>`).join('\n') +
    `\n</trkseg></trk>\n</gpx>\n`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = name.replace(/[^\w\-]+/g, '_') + '.gpx'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};

/* =====================================================================
 * Registrazione GPS
 * ===================================================================== */
let rec = null;
$('bRec').onclick = async () => {
  if (rec) return stopRec();
  if (!navigator.geolocation) return toast('GPS non disponibile');
  rec = { pts: [], dist: 0, wake: null };
  try { rec.wake = await navigator.wakeLock?.request('screen'); } catch {}
  rec.watch = navigator.geolocation.watchPosition(p => {
    if (p.coords.accuracy > 40) return;
    const c = [+p.coords.longitude.toFixed(6), +p.coords.latitude.toFixed(6)], last = rec.pts[rec.pts.length - 1];
    if (last) { const d = haversine(last, c); if (d < 5) return; rec.dist += d; }
    rec.pts.push(c);
    map.getSource('rec')?.setData(rec.pts.length > 1 ? { type: 'Feature', geometry: { type: 'LineString', coordinates: rec.pts } } : emptyFC());
    $('recInfo').textContent = rec.dist < 1000 ? Math.round(rec.dist) + ' m' : (rec.dist / 1000).toFixed(2) + ' km';
  }, err => toast('GPS: ' + err.message), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  $('recbar').hidden = false; $('bRec').classList.add('on'); $('bRec').textContent = '■ Stop';
  closePanel(); toast('Registrazione avviata · tieni lo schermo acceso');
  try { geolocate.trigger(); } catch {}
};
$('recStop').onclick = () => stopRec();
function stopRec() {
  if (!rec) return;
  navigator.geolocation.clearWatch(rec.watch);
  try { rec.wake && rec.wake.release(); } catch {}
  const pts = rec.pts; rec = null;
  $('recbar').hidden = true; $('bRec').classList.remove('on'); $('bRec').textContent = '⏺ Registra GPS';
  map.getSource('rec')?.setData(emptyFC());
  if (pts.length < 2) return toast('Registrazione troppo breve');
  const l = loadRoutes(), id = Date.now(), name = 'Registrazione ' + new Date().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  l.unshift({ id, name, coords: pts, created: id, recorded: true }); storeRoutes(l);
  openRoute(l[0]); toast('Traccia registrata e salvata ✓');
}
document.addEventListener('visibilitychange', async () => {
  if (rec && document.visibilityState === 'visible' && !rec.wake) { try { rec.wake = await navigator.wakeLock?.request('screen'); } catch {} }
});

/* =====================================================================
 * Download offline
 * ===================================================================== */
const loadPacks = () => LS.get('fm.packs', []);
const storePacks = l => LS.set('fm.packs', l);
let plan = null, dl = null;

function bufFn(z) { return z <= 10 ? 15000 : z <= 12 ? 6000 : z <= 14 ? Math.max(settings.bufM, 2500) : settings.bufM; }
function corridorTiles(cs, zMin, zMax) {
  const pts = densify(cs, 80), out = [];
  for (let z = zMin; z <= zMax; z++) {
    const n = 1 << z, set = new Set();
    for (const [lng, lat] of pts) {
      const r = Math.ceil(bufFn(z) / (EARTH_C * Math.cos(lat * D2R) / n));
      const [fx, fy] = tileXY(lng, lat, z);
      for (let dy = -r; dy <= r; dy++) { const y = fy + dy; if (y < 0 || y >= n) continue; for (let dx = -r; dx <= r; dx++) set.add((((fx + dx) % n) + n) % n + '/' + y); }
    }
    for (const k of set) { const [x, y] = k.split('/').map(Number); out.push([z, x, y]); }
  }
  return out;
}
function bboxTiles(b, zMin, zMax) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const [x0, y0] = tileXY(b[0], b[3], z), [x1, y1] = tileXY(b[2], b[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

function buildPlan(kind) {
  let area, bbox;
  if (kind === 'route') {
    if (coords.length < 2) { toast('Apri o traccia prima un percorso'); return null; }
    area = (a, b) => corridorTiles(coords, a, b);
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
    const padLat = settings.bufM / 111320, padLng = padLat / Math.cos(lats[0] * D2R);
    bbox = [Math.min(...lngs) - padLng, Math.min(...lats) - padLat, Math.max(...lngs) + padLng, Math.max(...lats) + padLat];
  } else {
    const b = map.getBounds(); bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const areaKm2 = haversine([bbox[0], bbox[1]], [bbox[2], bbox[1]]) * haversine([bbox[0], bbox[1]], [bbox[0], bbox[3]]) / 1e6;
    if (areaKm2 > 1500) { toast('Zona troppo ampia: avvicinati (max ~1500 km²)'); return null; }
    area = (a, b) => bboxTiles(bbox, a, b);
  }
  const jobs = [], seen = new Set();
  const add = (id, zMin, zMax, type) => {
    const s = SRC[id];
    for (const [z, x, y] of area(zMin, Math.min(zMax, s.max))) {
      if (s.bounds && !tileInBounds(z, x, y, s.bounds)) continue;
      const url = s.url(z, x, y);
      if (url && !seen.has(url)) { seen.add(url); jobs.push({ url, type, z }); }
    }
  };
  const base = settings.base;
  if (base === 's2' && !settings.s2.instance) { toast('Configura prima Sentinel-2'); return null; }
  if (base === 'wayback' && !settings.wayback) { toast('Scegli prima una versione Wayback'); return null; }
  add(base, 6, base === 's2' ? 13 : base === 'topo' ? Math.min(settings.imgMax, 16) : settings.imgMax, 'img');
  if (base === 'esri') {
    if (settings.ortoCH) add('ch', 8, settings.imgMax, 'img');
    if (settings.ortoFR) add('fr', 8, settings.imgMax, 'img');
  }
  for (const x of EXTRAS) if (settings.extras[x]) add(x, x === 'labels' ? 6 : 10, 16, 'ov');
  for (const [z, x, y] of area(5, settings.demMax)) jobs.push({ url: DEM_URL(z, x, y), type: 'dem', z, x, y });
  jobs.sort((a, b) => a.z - b.z);
  const est = jobs.reduce((s, j) => s + (j.type === 'dem' ? 120e3 : j.type === 'img' ? 25e3 : 6e3), 0);
  return { kind, jobs, bbox, est, routeId: kind === 'route' ? currentRouteId : null };
}

function planDownload(kind) {
  if (dl) return toast('Download già in corso');
  plan = buildPlan(kind); if (!plan) return;
  const nImg = plan.jobs.filter(j => j.type !== 'dem').length, nDem = plan.jobs.length - nImg;
  $('dlBox').hidden = false; $('dlBar').style.width = '0';
  $('dlName').value = kind === 'route' ? ($('rName').value || 'Percorso') : 'Zona ' + new Date().toLocaleDateString('it-IT');
  $('dlInfo').innerHTML = `<b>${plan.jobs.length.toLocaleString('it-IT')}</b> tile (${nImg} immagini, ${nDem} terreno) · stima <b>~${fmtMB(plan.est)}</b><br><span class="muted">Le tile già scaricate non vengono riscaricate dalla rete.</span>`;
  $('dlGo').disabled = false; $('dlGo').hidden = false; $('dlName').hidden = false;
  $('dlCancel').textContent = 'Annulla';
}
$('planRoute').onclick = () => planDownload('route');
$('planView').onclick = () => planDownload('view');
$('dlCancel').onclick = () => { if (dl) { dl.cancel = true; } else { plan = null; $('dlBox').hidden = true; } };
$('dlGo').onclick = () => runDownload();

async function runDownload() {
  if (!plan || dl) return;
  if (!HAS_CACHE) return toast('Serve HTTPS (app installata) per l\'offline');
  try { await navigator.storage?.persist?.(); } catch {}
  const meta = { id: Date.now(), name: $('dlName').value.trim() || 'Zona', bbox: plan.bbox, routeId: plan.routeId, created: Date.now(),
    base: settings.base, imgMax: settings.imgMax, demMax: settings.demMax, tiles: 0, bytes: 0 };
  const cache = await caches.open('pack-' + meta.id);
  const jobs = plan.jobs; plan = null;
  dl = { cancel: false }; let i = 0, done = 0, bytes = 0, fail = 0, ok = 0;
  $('dlGo').hidden = true; $('dlName').hidden = true; $('dlCancel').textContent = 'Interrompi';
  const t0 = performance.now();
  const ui = () => {
    $('dlBar').style.width = (done / jobs.length * 100).toFixed(1) + '%';
    const el = (performance.now() - t0) / 1000, eta = done ? el / done * (jobs.length - done) : 0;
    $('dlInfo').innerHTML = `Scaricate <b>${done.toLocaleString('it-IT')}</b> / ${jobs.length.toLocaleString('it-IT')} · ${fmtMB(bytes)}${fail ? ` · <span style="color:#ff9800">${fail} errori</span>` : ''}<br><span class="muted">${done < jobs.length ? 'Tempo rimanente ~' + Math.ceil(eta / 60) + ' min · tieni l\'app aperta' : ''}</span>`;
  };
  let lastUi = 0;
  async function worker() {
    while (i < jobs.length && !dl.cancel) {
      const j = jobs[i++];
      try {
        let r;
        for (let a = 0; a < 3; a++) {
          r = j.type === 'dem' ? await fetchDemRaw(j.z, j.x, j.y) : await fetchRaw(j.url);
          if (r.status !== 'error') break;
          if (!navigator.onLine) { dl.cancel = true; break; }
          await sleep(600 * (a + 1));
        }
        if (r.status === 'ok') { await cache.put(j.url, new Response(r.buf.slice(0))); bytes += r.buf.byteLength; ok++; }
        else if (r.status === 'error') fail++;
      } catch { fail++; }
      done++;
      if (performance.now() - lastUi > 250) { lastUi = performance.now(); ui(); }
    }
  }
  try { await Promise.all(Array.from({ length: 6 }, worker)); } finally {
    ui();
    const cancelled = dl.cancel; dl = null;
    $('dlCancel').textContent = 'Chiudi';
    if (cancelled && ok === 0) { await caches.delete('pack-' + meta.id); $('dlInfo').innerHTML += '<br>Download annullato.'; }
    else {
      meta.tiles = ok; meta.bytes = bytes; meta.partial = cancelled || fail > 0;
      const l = loadPacks(); l.unshift(meta); storePacks(l);
      $('dlInfo').innerHTML += `<br><b>${cancelled ? 'Interrotto: salvato quanto scaricato.' : 'Completato ✓'}</b>${fail ? ' Puoi riscaricare la stessa zona per completare i mancanti.' : ''}`;
      renderPacks(); updateStorageInfo();
    }
  }
}

function renderPacks() {
  const l = loadPacks();
  if ($('packList')) $('packList').innerHTML = l.length ? l.map(p => `<div class="item" data-id="${p.id}"><div class="nm"><b>${esc(p.name)}</b>
    <span class="muted">${fmtMB(p.bytes)} · ${p.tiles.toLocaleString('it-IT')} tile · ${new Date(p.created).toLocaleDateString('it-IT')}${p.partial ? ' · incompleta' : ''}</span></div>
    <button data-a="go">Vai</button><button data-a="del" class="danger">✕</button></div>`).join('') : '<p class="muted">Nessuna zona scaricata.</p>';
  const show = $('showPacks') ? $('showPacks').checked : true;
  map.getSource('packs')?.setData(show ? { type: 'FeatureCollection', features: l.map(p => {
    const [w, s, e, n] = p.bbox; return { type: 'Feature', geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } };
  }) } : emptyFC());
}
$('showPacks').onchange = renderPacks;
$('packList').onclick = async e => {
  const b = e.target.closest('button'), it = e.target.closest('.item'); if (!b || !it) return;
  const id = +it.dataset.id, p = loadPacks().find(x => x.id === id); if (!p) return;
  if (b.dataset.a === 'go') {
    const r = p.routeId && loadRoutes().find(x => x.id === p.routeId);
    if (r) openRoute(r); else { map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { padding: 40, pitch: settings.terrain3d ? 55 : 0 }); closePanel(); }
  }
  if (b.dataset.a === 'del') {
    if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'Elimina?'; setTimeout(() => { b.classList.remove('armed'); b.textContent = '✕'; }, 3000); return; }
    await caches.delete('pack-' + id); storePacks(loadPacks().filter(x => x.id !== id)); renderPacks(); updateStorageInfo();
  }
};
async function updateStorageInfo() {
  try {
    const e = await navigator.storage.estimate(), pers = await navigator.storage.persisted?.();
    $('storageInfo').innerHTML = `Spazio usato: <b>${fmtMB(e.usage || 0)}</b> di ${fmtMB(e.quota || 0)} disponibili${pers ? ' · archiviazione persistente ✓' : ''}`;
  } catch { $('storageInfo').textContent = ''; }
}
function initOfflineUI() {
  for (const k of ['imgMax', 'demMax', 'bufM']) {
    $(k).value = settings[k];
    $(k).onchange = e => {
      settings[k] = +e.target.value; saveSettings();
      if (k === 'demMax') { // aggiorna il terreno visualizzato
        for (const s of ['dem', 'demHs']) { const src = map.getSource(s); if (src) { src.maxzoom = settings.demMax; } }
        toast('Dettaglio del terreno aggiornato al prossimo avvio');
      }
      if (plan) planDownload(plan.kind);
    };
  }
}

/* =====================================================================
 * Stato rete, service worker, avvio
 * ===================================================================== */
function netState() { $('netBadge').hidden = navigator.onLine; }
addEventListener('online', netState); addEventListener('offline', netState); netState();
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape') setDrawing(false);
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && drawing) { coords.pop(); updateRoute(); }
});
if ('serviceWorker' in navigator && HAS_CACHE) navigator.serviceWorker.register('sw.js').catch(() => {});

initLayerUI();
initOfflineUI();
if (currentRouteId) { const r = loadRoutes().find(x => x.id === currentRouteId); if (r) $('rName').value = r.name; }
