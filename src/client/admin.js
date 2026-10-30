// Admin bundle: confirm modal, AJAX forms with field errors (zod on the client for the story
// form), cover preview, tabs, translation button, booking status, map point picker.
import { request, toast } from './ui.js';
import { adminStory, issueToMessage } from '../shared/schemas.js';

const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
const MESSAGES = {
  'validation.required': 'Обовʼязкове поле',
  'validation.min': 'Замало символів (мінімум {min})',
  'validation.max': 'Забагато символів (максимум {max})',
  'validation.email': 'Некоректний e-mail',
  'validation.invalid': 'Некоректне значення',
};
const msg = (e) => (MESSAGES[e.key] || e.key).replace(/\{(\w+)\}/g, (m, k) => (e.vars && e.vars[k] !== undefined ? e.vars[k] : m));

// ---------- Flash -> toast ----------
const flashEl = document.getElementById('flash');
if (flashEl) { try { const f = JSON.parse(flashEl.textContent); toast(f.message, f.type); } catch { /* ignore */ } }

// ---------- Sidebar on small screens ----------
document.querySelector('[data-adm-burger]')?.addEventListener('click', () => document.querySelector('[data-adm-side]').classList.toggle('adm-side--open'));

// ---------- Confirm modal ----------
const modal = document.querySelector('[data-modal]');
function confirmDialog(title, text, danger = true) {
  return new Promise((resolve) => {
    modal.querySelector('[data-modal-title]').textContent = title;
    modal.querySelector('[data-modal-text]').textContent = text || '';
    const ok = modal.querySelector('[data-modal-confirm]');
    ok.classList.toggle('modal__confirm--danger', danger);
    modal.hidden = false;
    ok.focus();
    const done = (v) => {
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onClick = (e) => {
      if (e.target.closest('[data-modal-confirm]')) done(true);
      else if (e.target.closest('[data-modal-close]')) done(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    modal.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  });
}

async function post(url, body) {
  const fd = body instanceof FormData ? body : null;
  return request(url, { method: 'POST', body: fd || body || {}, headers: { 'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest' }, silent: true });
}

function handleResult(r) {
  if (r.message) toast(r.message, 'success');
  if (r.redirect) setTimeout(() => { location.href = r.redirect; }, 400);
  else if (r.reload) setTimeout(() => location.reload(), 500);
}

function showFieldErrors(form, errors = {}) {
  form.querySelectorAll('.field').forEach((f) => {
    const name = f.dataset.field || f.querySelector('[name]')?.name;
    const err = errors[name];
    f.classList.toggle('field--error', Boolean(err));
    const slot = f.querySelector('.field__error');
    if (slot) slot.textContent = err ? msg(err) : '';
  });
  const first = form.querySelector('.field--error input, .field--error textarea, .field--error select');
  if (first) {
    const panel = first.closest('[data-tab-panel]');
    if (panel && panel.hidden) document.querySelector(`[data-tab="${panel.dataset.tabPanel}"]`)?.click();
    first.focus();
  }
}

document.addEventListener('click', async (e) => {
  const del = e.target.closest('[data-delete]');
  if (del) {
    e.preventDefault();
    if (!(await confirmDialog(del.dataset.confirmTitle || 'Видалити?', del.dataset.confirmText))) return;
    try { handleResult(await post(del.dataset.delete)); } catch (err) { toast(err.message, 'error', 8000); }
    return;
  }
  const st = e.target.closest('[data-booking-status]');
  if (st) {
    const status = st.dataset.status;
    if (status === 'cancelled' && !(await confirmDialog('Скасувати бронювання?', 'Клієнт отримає лист про скасування, слот знову стане вільним.'))) return;
    try {
      await post(`/admin/bookings/${st.dataset.bookingStatus}/status`, { status });
      toast(status === 'confirmed' ? 'Бронювання підтверджено' : 'Бронювання скасовано', 'success');
      setTimeout(() => location.reload(), 500);
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  const hid = e.target.closest('[data-toggle-hidden]');
  if (hid) {
    const hidden = hid.dataset.hidden !== '1';
    try {
      await post(`/admin/stories/${hid.dataset.toggleHidden}/hidden`, { hidden: hidden ? '1' : '0' });
      hid.dataset.hidden = hidden ? '1' : '0';
      hid.textContent = hidden ? 'Приховано' : 'Опубліковано';
      hid.className = `pill ${hidden ? 'pill--muted' : 'pill--ok'}`;
    } catch (err) { toast(err.message, 'error'); }
    return;
  }
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    document.querySelectorAll('[data-tab]').forEach((t) => { t.classList.toggle('tabs__tab--active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
    document.querySelectorAll('[data-tab-panel]').forEach((p) => { p.hidden = p.dataset.tabPanel !== tab.dataset.tab; });
    return;
  }
  const tr = e.target.closest('[data-translate]');
  if (tr) {
    tr.classList.add('is-loading');
    try {
      const r = await post(`/admin/stories/${tr.dataset.story}/translate`, { locale: tr.dataset.translate });
      for (const [k, v] of Object.entries(r.patch)) { const el = document.querySelector(`[name="${k}"]`); if (el) el.value = v; }
      toast(r.message, 'success');
    } catch (err) { toast(err.message, 'error', 9000); } finally { tr.classList.remove('is-loading'); }
    return;
  }
  const fill = e.target.closest('[data-fill-form]');
  if (fill) {
    const form = document.querySelector(`[data-form-name="${fill.dataset.fillForm}"]`);
    const values = JSON.parse(fill.dataset.values);
    for (const [k, v] of Object.entries(values)) { const el = form.querySelector(`[name="${k}"]`); if (el) el.value = v ?? ''; }
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector('input:not([type=hidden])')?.focus();
    return;
  }
  const svc = e.target.closest('[data-edit-service]');
  if (svc) {
    const s = JSON.parse(svc.dataset.editService);
    const form = document.querySelector('[data-service-form]');
    form.querySelector('[name="serviceId"]').value = s.id;
    for (const k of ['kind', 'title', 'title_en', 'title_es', 'duration_min', 'price_label', 'description']) { const el = form.querySelector(`[name="${k}"]`); if (el) el.value = s[k] ?? ''; }
    form.querySelector('[name="active"]').checked = s.active;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

// ---------- AJAX forms (story, traveller, dictionaries, services, slots) ----------
document.querySelectorAll('[data-adm-form], [data-ajax-form]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (form.dataset.admForm === 'story') {
      const obj = Object.fromEntries([...fd.entries()].filter(([k]) => !['seasons', 'tags', 'cover'].includes(k)));
      obj.seasons = fd.getAll('seasons');
      obj.tags = fd.getAll('tags');
      obj.is_demo = fd.get('is_demo') === 'on';
      const r = adminStory.safeParse(obj);
      if (!r.success) {
        const errors = {};
        for (const issue of r.error.issues) { const k = issue.path[0]; if (!errors[k]) errors[k] = issueToMessage(issue); }
        showFieldErrors(form, errors);
        toast('Перевірте поля форми', 'error');
        return;
      }
    }
    const btn = form.querySelector('[type=submit]');
    btn?.classList.add('is-loading');
    try {
      const url = form.getAttribute('action');
      const r = await post(url + (url.includes('_csrf') ? '' : (url.includes('?') ? '&' : '?') + '_csrf=' + encodeURIComponent(csrf)), fd);
      showFieldErrors(form, {});
      handleResult(r);
    } catch (err) {
      if (err.data && err.data.errors) showFieldErrors(form, err.data.errors);
      toast(err.message, 'error', 8000);
    } finally {
      btn?.classList.remove('is-loading');
    }
  });
});

// Plain forms (settings, demo delete) still get a loader on submit.
document.querySelector('[data-demo-delete]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.confirm.value !== 'DELETE') { toast('Введіть DELETE для підтвердження', 'error'); form.confirm.focus(); return; }
  if (await confirmDialog('Видалити весь демо-контент?', 'Згенеровані історії, мандрівники, їхні фото, послуги та слоти буде видалено. Імпортований оригінал залишиться.')) form.submit();
});
document.querySelectorAll('[data-plain-form]').forEach((f) => f.addEventListener('submit', () => f.querySelector('[type=submit]')?.classList.add('is-loading')));

// Filters: change of a select submits immediately.
document.querySelectorAll('[data-autosubmit] select').forEach((s) => s.addEventListener('change', () => s.form.submit()));

// ---------- Cover / avatar preview ----------
document.querySelectorAll('[data-cover-upload]').forEach((box) => {
  const input = box.querySelector('[data-cover-input]');
  const img = box.querySelector('[data-cover-preview]');
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Лише JPEG, PNG або WEBP', 'error'); input.value = ''; return; }
    if (f.size > 8 * 1024 * 1024) { toast('Файл більший за 8 МБ', 'error'); input.value = ''; return; }
    img.src = URL.createObjectURL(f);
  });
});

// ---------- Character counters ----------
document.querySelectorAll('[data-counter]').forEach((ta) => {
  const out = document.querySelector(`[data-count-for="${ta.name}"]`);
  const upd = () => { if (out) out.textContent = `${ta.value.length} / ${ta.maxLength}`; };
  ta.addEventListener('input', upd);
  upd();
});
