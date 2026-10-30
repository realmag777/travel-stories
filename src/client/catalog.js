// Instant faceted catalog. Every control is a real link to a server-rendered URL; here we
// intercept it, fetch the same URL with X-Partial and swap the fragments, so results, counts,
// chips and categories update without a reload while the address bar stays shareable.
import { request, toast, t, locale } from './ui.js';
import { refreshButtons } from './saved.js';

let controller = null;

function $(sel, root = document) { return root.querySelector(sel); }

async function load(url, { push = true, append = false } = {}) {
  const root = $('[data-catalog]');
  if (!root) return (window.location.href = url);
  if (controller) controller.abort();
  controller = new AbortController();
  const list = $('[data-story-list]', root);
  if (list && !append) list.classList.add('is-busy');
  try {
    const data = await request(url, { headers: { 'X-Partial': append ? 'append' : '1' }, signal: controller.signal });
    if (append) {
      const tmp = document.createElement('div');
      tmp.innerHTML = data.html;
      const newList = $('[data-story-list]', tmp);
      if (newList && list) list.append(...newList.children);
      const more = $('[data-load-more]', root);
      if (data.hasMore && more) more.href = data.nextUrl; else if (more) more.closest('.load-more, a').remove();
      refreshButtons(root);
      return;
    }
    const results = $('[data-results]', root);
    if (results) results.innerHTML = data.html['story-results'];
    $('[data-facets]', root).innerHTML = data.html.facets;
    $('[data-active-chips]', root).innerHTML = data.html['active-chips'];
    const cats = $('[data-categories]', root);
    if (cats) cats.innerHTML = data.html.categories;
    $('[data-total-label]', root).innerHTML = data.totalLabel;
    const badge = $('[data-active-count]', root);
    if (badge) { badge.textContent = data.activeCount; badge.hidden = !data.activeCount; }
    const show = $('[data-show-results]', root);
    if (show) show.textContent = data.showLabel;
    if (push) history.pushState({ catalog: true }, '', data.url);
    syncViewLinks(data.url);
    refreshButtons(root);
    document.dispatchEvent(new CustomEvent('catalog:updated', { detail: { url: data.url } }));
  } catch (e) {
    if (e.name !== 'AbortError' && list) list.classList.remove('is-busy');
  }
}

/** Keep "Список / Карта" links pointing at the current filter. */
function syncViewLinks(url) {
  const u = new URL(url, location.origin);
  const params = new URLSearchParams(u.search);
  params.delete('page');
  const path = u.pathname.replace(/^\/(en|es)(?=\/)/, '').replace(/^\/map/, '/stories');
  const prefix = locale === 'uk' ? '' : '/' + locale;
  const list = new URLSearchParams(params); list.delete('view');
  const map = new URLSearchParams(params); map.set('view', 'map');
  document.querySelectorAll('[data-view="list"]').forEach((a) => { a.href = prefix + path + (list.toString() ? '?' + list : ''); });
  document.querySelectorAll('[data-view="map"]').forEach((a) => {
    a.href = document.querySelector('[data-map-page]') ? location.pathname + location.search : prefix + path + '?' + map;
  });
}

function openFilters(open) {
  const panel = $('[data-filter-panel]');
  if (!panel) return;
  panel.classList.toggle('filter-panel--open', open);
  document.querySelectorAll('[data-open-filters]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  let backdrop = $('.filter-backdrop');
  if (open && !backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'filter-backdrop';
    backdrop.addEventListener('click', () => openFilters(false));
    document.body.append(backdrop);
  } else if (!open && backdrop) backdrop.remove();
  document.body.style.overflow = open && window.innerWidth < 1440 ? 'hidden' : '';
  if (open) panel.querySelector('button, a')?.focus();
}

async function nlSearch(q) {
  const input = $('[data-nl-input]');
  if (input) input.value = q;
  if (!q.trim()) return;
  try {
    const r = await request(`/api/v2/search?q=${encodeURIComponent(q)}&lang=${locale}`);
    const d = r.data;
    const prefix = locale === 'uk' ? '' : '/' + locale;
    const base = $('[data-map-page]') ? d.url.replace(/^\/stories/, '/map') : d.url;
    await load(prefix + base);
    const found = Object.entries(d.facets).filter(([, v]) => (Array.isArray(v) ? v.length : v)).length;
    toast(found ? t('searchApplied', { n: d.total }) : t('searchNothing'), found ? 'success' : 'info', 3500);
  } catch { /* toast shown */ }
}

export function initCatalog() {
  const root = $('[data-catalog]');
  if (!root) return;

  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-facet], a[data-category], a[data-reset-all], [data-load-more]');
    if (a && a.tagName === 'A' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      if (a.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      e.preventDefault();
      if (a.hasAttribute('data-reset-all')) {
        const q = $('[data-nl-input]'); if (q) q.value = '';
      }
      if (a.dataset.facet === 'q') { const q = $('[data-nl-input]'); if (q) q.value = ''; }
      load(a.href, { append: a.hasAttribute('data-load-more') });
      return;
    }
    if (e.target.closest('[data-open-filters]')) openFilters(true);
    if (e.target.closest('[data-close-filters]')) openFilters(false);
    const ex = e.target.closest('[data-nl-example]');
    if (ex) nlSearch(ex.textContent.trim());
    const clear = e.target.closest('[data-nl-clear]');
    if (clear) {
      const input = $('[data-nl-input]');
      input.value = '';
      clear.hidden = true;
      input.focus();
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-sort]')) {
      const u = new URL(location.href);
      if (e.target.value === 'new') u.searchParams.delete('sort'); else u.searchParams.set('sort', e.target.value);
      u.searchParams.delete('page');
      load(u.pathname + u.search);
    }
    if (e.target.matches('[data-category-select]')) {
      const u = new URL(location.href);
      if (e.target.value) u.searchParams.set('category', e.target.value); else u.searchParams.delete('category');
      u.searchParams.delete('page');
      load(u.pathname + u.search);
    }
  });

  const form = $('[data-nl-form]');
  if (form) {
    form.addEventListener('submit', (e) => { e.preventDefault(); nlSearch($('[data-nl-input]').value); });
    $('[data-nl-input]').addEventListener('input', (e) => { const c = $('[data-nl-clear]'); if (c) c.hidden = !e.target.value; });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openFilters(false); });
  window.addEventListener('popstate', () => load(location.pathname + location.search, { push: false }));
  document.addEventListener('catalog:navigate', (e) => load(e.detail.url));
}

/** Smaller screens load fewer cards per step, like the original (8 travellers / 4 stories). */
function trimForScreen() {
  if (window.innerWidth >= 1440) return;
  document.querySelectorAll('[data-mobile-limit]').forEach((list) => {
    const limit = Number(list.dataset.mobileLimit);
    const total = Number(list.dataset.total);
    [...list.children].slice(limit).forEach((li) => li.remove());
    list.classList.add('is-trimmed');
    const more = list.parentElement.querySelector('[data-load-more], [data-load-more-travellers]');
    if (!more) return;
    if (total <= limit) { more.remove(); return; }
    const u = new URL(more.href, location.origin);
    u.searchParams.delete('page');
    u.searchParams.set('offset', String(limit));
    u.searchParams.set('limit', String(limit));
    more.href = u.pathname + u.search;
  });
}

/** Travellers page and profile page "Показати ще". */
export function initLoadMore() {
  trimForScreen();
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-load-more-travellers], .profile-blog [data-load-more]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    try {
      const travellers = a.hasAttribute('data-load-more-travellers');
      const data = await request(a.href, { headers: { 'X-Partial': travellers ? '1' : 'append' } });
      const tmp = document.createElement('div');
      tmp.innerHTML = data.html;
      const target = travellers ? document.querySelector('[data-traveller-list]') : a.parentElement.querySelector('[data-story-list]');
      const items = travellers ? [...tmp.children] : [...(tmp.querySelector('[data-story-list]')?.children || [])];
      target.append(...items);
      refreshButtons(target);
      if (data.hasMore) a.href = data.nextUrl; else a.remove();
    } catch { /* toast shown */ }
  });
}
