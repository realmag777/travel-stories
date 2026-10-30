// Anonymous favourites: ids live in localStorage, the server only receives the counter change
// (rate-limited per IP and story). The "Збережені" page is rendered from localStorage.
import { request, toast, t, locale } from './ui.js';

const KEY = 'pp:saved';

export function getSaved() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function setSaved(ids) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}

export function refreshButtons(root = document) {
  const saved = new Set(getSaved());
  root.querySelectorAll('[data-save]').forEach((btn) => {
    const on = saved.has(btn.dataset.save);
    btn.setAttribute('aria-pressed', String(on));
    const big = btn.hasAttribute('data-save-big');
    btn.classList.toggle(big ? 'save-box__button--saved' : 'story-card__button--saved', on);
    const label = on ? btn.dataset.labelSaved : btn.dataset.labelSave;
    if (big) btn.textContent = label; else btn.setAttribute('aria-label', label);
  });
  const n = saved.size;
  document.querySelectorAll('[data-saved-nav]').forEach((li) => { li.hidden = n === 0; });
  document.querySelectorAll('[data-saved-count]').forEach((el) => { el.textContent = n ? `(${n})` : ''; });
}

async function toggle(btn) {
  const id = btn.dataset.save;
  const saved = getSaved();
  const isOn = saved.includes(id);
  const nextList = isOn ? saved.filter((x) => x !== id) : [id, ...saved].slice(0, 200);
  setSaved(nextList);
  refreshButtons();
  btn.disabled = true;
  try {
    const r = await request(`/api/v2/stories/${id}/save`, { method: 'POST', body: { action: isOn ? 'remove' : 'add' } });
    document.querySelectorAll(`[data-fav-count="${id}"]`).forEach((el) => { el.textContent = r.data.favoriteCount; });
    toast(isOn ? t('unsaved') : t('savedToast'), 'success', 2500);
    if (isOn && document.querySelector('[data-saved-page]')) renderSavedPage();
  } catch {
    setSaved(saved); // roll back the optimistic change
    refreshButtons();
  } finally {
    btn.disabled = false;
  }
}

export async function renderSavedPage() {
  const page = document.querySelector('[data-saved-page]');
  if (!page) return;
  const box = page.querySelector('[data-saved-results]');
  const ids = getSaved();
  if (!ids.length) {
    box.replaceChildren(page.querySelector('[data-saved-empty]').content.cloneNode(true));
    return;
  }
  try {
    const prefix = locale === 'uk' ? '' : '/' + locale;
    const res = await fetch(`${prefix}/saved/cards?ids=${ids.join(',')}`, { headers: { 'X-Partial': '1' } });
    const data = await res.json();
    box.innerHTML = data.html;
    refreshButtons(box);
  } catch {
    toast(t('requestFailed'), 'error');
  }
}

export function initSaved() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-save]');
    if (btn) { e.preventDefault(); toggle(btn); }
  });
  window.addEventListener('storage', (e) => { if (e.key === KEY) refreshButtons(); });
  refreshButtons();
  renderSavedPage();
}
