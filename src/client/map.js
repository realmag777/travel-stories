// Leaflet + OpenStreetMap with marker clusters. Used by /map, the "Карта" view of /stories
// and the small location map on a story page. "Шукати в видимій області" adds bbox to the
// filter state, so facet counts follow the visible area.
const L = require('leaflet');
window.L = L;
require('leaflet.markercluster');
const filterState = require('../shared/filter-state');
const { request, t, locale } = require('./ui.js');

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const prefix = locale === 'uk' ? '' : '/' + locale;

const pinIcon = L.divIcon({ className: '', html: '<div class="map-pin"></div>', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function currentState() {
  const path = location.pathname.replace(/^\/(en|es)(?=\/)/, '');
  const m = path.match(/\/filter\/(.+)$/);
  return filterState.parse(m ? m[1].split('/') : [], Object.fromEntries(new URLSearchParams(location.search)));
}

/** API query for the points: the filter without bbox, so moving the map never hides markers. */
function apiQuery(state) {
  const q = new URLSearchParams({ lang: locale });
  for (const f of filterState.FACETS) if (state[f].length) q.set(f, state[f].join(','));
  if (state.category) q.set('category', state.category);
  if (state.sort) q.set('sort', state.sort);
  return q.toString();
}

function initCatalogMap(el) {
  const map = L.map(el, { scrollWheelZoom: true, worldCopyJump: true }).setView([30, 15], 2);
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(map);
  const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  map.addLayer(cluster);
  const status = el.querySelector('[data-map-status]');
  const bboxToggle = el.querySelector('[data-bbox-toggle]');
  // Leaflet must not treat clicks on our overlay controls as map clicks.
  el.querySelectorAll('.map-view__bbox, .map-view__status').forEach((c) => L.DomEvent.disableClickPropagation(c));
  let first = true;

  async function loadPoints() {
    const state = currentState();
    try {
      const r = await request('/api/v2/map?' + apiQuery(state));
      cluster.clearLayers();
      const markers = r.data.points.map((p) => L.marker([p.lat, p.lng], { icon: pinIcon, title: p.title }).bindPopup(
        `<div class="map-popup"><img class="map-popup__image" src="${esc(p.img)}" alt="" width="240" height="140" loading="lazy">
         <div class="map-popup__category">${esc(p.category || '')}</div>
         <div class="map-popup__title">${esc(p.title)}</div>
         <div class="map-popup__meta">${esc(p.date)} · ${esc(p.favoriteCount)} ★</div>
         <a class="map-popup__link" href="${prefix}/stories/${p.id}">${esc(t('map.open'))}</a></div>`,
        { maxWidth: 260 },
      ));
      cluster.addLayers(markers);
      if (status) status.textContent = t('map.count', { n: r.data.total });
      if (first) {
        first = false;
        if (state.bbox) map.fitBounds([[state.bbox[0], state.bbox[1]], [state.bbox[2], state.bbox[3]]]);
        else if (markers.length) map.fitBounds(cluster.getBounds(), { padding: [30, 30], maxZoom: 7 });
      }
    } catch { /* toast shown */ }
  }

  function bboxUrl(on) {
    const u = new URL(location.href);
    if (on) {
      const b = map.getBounds();
      const w = Math.max(-180, b.getWest());
      const e = Math.min(180, b.getEast());
      u.searchParams.set('bbox', [b.getSouth(), w, b.getNorth(), e].map((x) => x.toFixed(4)).join(','));
    } else u.searchParams.delete('bbox');
    u.searchParams.delete('page');
    return u.pathname + u.search;
  }

  if (bboxToggle) {
    bboxToggle.addEventListener('change', () => document.dispatchEvent(new CustomEvent('catalog:navigate', { detail: { url: bboxUrl(bboxToggle.checked) } })));
    map.on('moveend', () => {
      if (bboxToggle.checked && !first) document.dispatchEvent(new CustomEvent('catalog:navigate', { detail: { url: bboxUrl(true) } }));
    });
  }
  let lastKey = '';
  document.addEventListener('catalog:updated', () => {
    const state = currentState();
    if (bboxToggle) bboxToggle.checked = Boolean(state.bbox);
    const key = apiQuery(state);
    if (key !== lastKey) { lastKey = key; loadPoints(); }
  });
  lastKey = apiQuery(currentState());
  loadPoints();
}

function initStoryMap(el) {
  const lat = Number(el.dataset.lat);
  const lng = Number(el.dataset.lng);
  const map = L.map(el, { scrollWheelZoom: false }).setView([lat, lng], 7);
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(map);
  L.marker([lat, lng], { icon: pinIcon, title: el.dataset.title }).addTo(map);
}

// Tiles and Leaflet load lazily when the map scrolls into view.
function whenVisible(el, fn) {
  if (!('IntersectionObserver' in window)) return fn(el);
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(el); }
  }, { rootMargin: '200px' });
  io.observe(el);
}

// Admin: pick the story point by clicking or dragging; the lat/lng inputs stay in sync.
function initPicker(el) {
  const latIn = document.querySelector('[name="lat"]');
  const lngIn = document.querySelector('[name="lng"]');
  const has = latIn.value !== '' && lngIn.value !== '';
  const map = L.map(el).setView(has ? [Number(latIn.value), Number(lngIn.value)] : [48.5, 24], has ? 7 : 3);
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 18 }).addTo(map);
  let marker = null;
  const place = (lat, lng) => {
    if (!marker) {
      marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); latIn.value = p.lat.toFixed(5); lngIn.value = p.lng.toFixed(5); });
    } else marker.setLatLng([lat, lng]);
  };
  if (has) place(Number(latIn.value), Number(lngIn.value));
  map.on('click', (e) => { place(e.latlng.lat, e.latlng.lng); latIn.value = e.latlng.lat.toFixed(5); lngIn.value = e.latlng.lng.toFixed(5); });
  const sync = () => { const a = Number(latIn.value); const b = Number(lngIn.value); if (latIn.value !== '' && lngIn.value !== '' && Number.isFinite(a) && Number.isFinite(b)) { place(a, b); map.setView([a, b]); } };
  latIn.addEventListener('change', sync);
  lngIn.addEventListener('change', sync);
}
const picker = document.querySelector('[data-pick-map]');
if (picker) initPicker(picker);

const catalogMap = document.querySelector('[data-map]');
if (catalogMap) initCatalogMap(catalogMap);
const storyMap = document.querySelector('[data-story-map]');
if (storyMap) whenVisible(storyMap, initStoryMap);
