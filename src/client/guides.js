// /guides filters and "Показати ще" without reloads; the profile's mobile sticky "Забронювати".
import { request } from './ui.js';

function initGuidesPage() {
  const page = document.querySelector('[data-guides-page]');
  if (!page) return;
  const form = page.querySelector('[data-guides-form]');
  const list = page.querySelector('[data-guide-list]');
  const more = page.querySelector('[data-load-more-guides]');
  const empty = page.querySelector('[data-guides-empty]');
  const count = page.querySelector('[data-guides-count]');

  async function load(url, { append = false, push = true } = {}) {
    if (!append) list.classList.add('is-busy');
    try {
      const data = await request(url, { headers: { 'X-Partial': '1' } });
      if (append) list.insertAdjacentHTML('beforeend', data.html); else list.innerHTML = data.html;
      count.textContent = data.totalLabel;
      empty.hidden = data.total > 0;
      more.hidden = !data.hasMore;
      more.href = data.nextUrl;
      if (push && !append) history.pushState({ guides: true }, '', data.url);
    } catch { /* toast shown */ } finally {
      list.classList.remove('is-busy');
    }
  }

  const formUrl = () => {
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(form).entries()) if (v) p.set(k, v);
    return form.getAttribute('action') + (p.toString() ? '?' + p : '');
  };
  form.addEventListener('change', () => load(formUrl()));
  form.addEventListener('submit', (e) => { e.preventDefault(); load(formUrl()); });
  page.addEventListener('click', (e) => {
    const reset = e.target.closest('[data-guides-reset]');
    if (reset) { e.preventDefault(); form.reset(); [...form.elements].forEach((el) => { if (el.name) el.value = ''; }); load(reset.href); }
    if (e.target.closest('[data-load-more-guides]') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); load(more.href, { append: true }); }
  });
  window.addEventListener('popstate', () => location.reload());
}

/** Sticky button on small screens, hidden while the booking block itself is on screen. */
function initStickyBooking() {
  const sticky = document.querySelector('[data-booking-sticky]');
  const block = document.getElementById('booking');
  if (!sticky || !block || !('IntersectionObserver' in window)) return;
  new IntersectionObserver((entries) => {
    sticky.classList.toggle('booking-sticky--hidden', entries[0].isIntersecting);
  }, { threshold: 0.15 }).observe(block);
}

export function initGuides() {
  initGuidesPage();
  initStickyBooking();
}
