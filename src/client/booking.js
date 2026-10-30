// Booking widget: service -> calendar of free slots -> form validated with the shared zod schema.
import { booking as bookingSchema, issueToMessage } from '../shared/schemas.js';
import { request, toast, t, locale } from './ui.js';

const root = document.querySelector('[data-booking]');
const travellerId = root.dataset.traveller;
const cal = root.querySelector('[data-calendar]');
const form = root.querySelector('[data-booking-form]');
const submit = root.querySelector('[data-booking-submit]');
const summary = root.querySelector('[data-booking-summary]');
const slotInput = root.querySelector('[data-slot-input]');

let slotsByDay = {};
let month = null;
let selectedDay = null;
let selectedSlot = null;

const fmtMonth = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function service() {
  const r = root.querySelector('input[name="serviceId"]:checked');
  return r ? { id: Number(r.value), title: r.dataset.title, price: r.dataset.price } : null;
}

async function loadSlots() {
  try {
    const r = await request(`/api/v2/travellers/${travellerId}/booking?lang=${locale}`);
    slotsByDay = {};
    for (const s of r.data.slots) (slotsByDay[s.day] = slotsByDay[s.day] || []).push(s);
    const first = Object.keys(slotsByDay).sort()[0];
    month = first ? first.slice(0, 7) : new Date().toISOString().slice(0, 7);
    renderCalendar();
  } catch {
    cal.innerHTML = `<p class="calendar__empty">${t('booking.loadFailed')}</p>`;
  }
}

function renderCalendar() {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const months = Object.keys(slotsByDay).map((d) => d.slice(0, 7));
  const minM = months.length ? months.reduce((a, b) => (a < b ? a : b)) : month;
  const maxM = months.length ? months.reduce((a, b) => (a > b ? a : b)) : month;
  const dows = t('booking.weekdays');
  let html = `<div class="calendar__nav">
    <button type="button" class="calendar__arrow" data-month="-1" aria-label="${t('booking.prevMonth')}" ${month <= minM ? 'disabled' : ''}>‹</button>
    <span class="calendar__month" aria-live="polite">${fmtMonth.format(first)}</span>
    <button type="button" class="calendar__arrow" data-month="1" aria-label="${t('booking.nextMonth')}" ${month >= maxM ? 'disabled' : ''}>›</button>
  </div><div class="calendar__grid" role="grid">`;
  for (const d of dows) html += `<span class="calendar__dow">${d}</span>`;
  for (let i = 0; i < offset; i++) html += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const key = `${month}-${String(d).padStart(2, '0')}`;
    const has = Boolean(slotsByDay[key]);
    const sel = key === selectedDay;
    html += has
      ? `<button type="button" class="calendar__day calendar__day--available${sel ? ' calendar__day--selected' : ''}" data-day="${key}" aria-pressed="${sel}" aria-label="${fmtDay.format(new Date(key + 'T00:00:00Z'))}">${d}</button>`
      : `<span class="calendar__day" aria-hidden="true">${d}</span>`;
  }
  html += '</div>';
  if (selectedDay && slotsByDay[selectedDay]) {
    html += `<div class="calendar__times" role="group" aria-label="${t('booking.times')}">` + slotsByDay[selectedDay]
      .map((s) => `<button type="button" class="calendar__time${selectedSlot && selectedSlot.id === s.id ? ' calendar__time--selected' : ''}" data-slot="${s.id}" aria-pressed="${Boolean(selectedSlot && selectedSlot.id === s.id)}">${s.time}</button>`).join('') + '</div>';
  } else if (!Object.keys(slotsByDay).length) {
    html += `<p class="calendar__empty">${t('booking.noSlots')}</p>`;
  } else {
    html += `<p class="calendar__empty">${t('booking.pickDay')}</p>`;
  }
  html += `<p class="calendar__tz">${t('booking.tz')}</p>`;
  cal.innerHTML = html;
}

function updateSummary() {
  const s = service();
  if (selectedSlot && s) {
    summary.textContent = t('booking.summary', { service: s.title, price: s.price, day: fmtDay.format(new Date(selectedSlot.day + 'T00:00:00Z')), time: selectedSlot.time });
    slotInput.value = selectedSlot.id;
    submit.disabled = false;
  } else {
    summary.textContent = t('booking.pickSlotShort');
    slotInput.value = '';
    submit.disabled = true;
  }
}

cal.addEventListener('click', (e) => {
  const mBtn = e.target.closest('[data-month]');
  if (mBtn) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + Number(mBtn.dataset.month), 1));
    month = d.toISOString().slice(0, 7);
    renderCalendar();
    return;
  }
  const dBtn = e.target.closest('[data-day]');
  if (dBtn) { selectedDay = dBtn.dataset.day; selectedSlot = null; renderCalendar(); updateSummary(); return; }
  const sBtn = e.target.closest('[data-slot]');
  if (sBtn) {
    selectedSlot = slotsByDay[selectedDay].find((s) => s.id === Number(sBtn.dataset.slot));
    renderCalendar();
    updateSummary();
  }
});

root.addEventListener('change', (e) => {
  if (e.target.name === 'serviceId') {
    root.querySelectorAll('.service').forEach((l) => l.classList.toggle('service--selected', l.contains(e.target)));
    updateSummary();
  }
});

function showErrors(errors) {
  form.querySelectorAll('[data-field]').forEach((f) => {
    const err = errors[f.dataset.field];
    f.classList.toggle('field--error', Boolean(err));
    f.querySelector('.field__error').textContent = err ? t(err.key.replace('validation.', 'validation.'), err.vars) : '';
    const input = f.querySelector('input, textarea');
    if (err) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  });
}

function collect() {
  const fd = new FormData(form);
  return { serviceId: service() && service().id, slotId: Number(slotInput.value), name: fd.get('name'), email: fd.get('email'), message: fd.get('message') || '' };
}

function validate(onlyField) {
  const r = bookingSchema.safeParse(collect());
  const errors = {};
  if (!r.success) for (const issue of r.error.issues) { const k = issue.path[0]; if (!errors[k]) errors[k] = issueToMessage(issue); }
  if (onlyField) {
    const f = form.querySelector(`[data-field="${onlyField}"]`);
    if (f) showErrors({ ...Object.fromEntries([...form.querySelectorAll('[data-field].field--error')].map((x) => [x.dataset.field, errors[x.dataset.field]]).filter(([, v]) => v)), ...(errors[onlyField] ? { [onlyField]: errors[onlyField] } : {}) });
    return r;
  }
  showErrors(errors);
  return r;
}

form.addEventListener('focusout', (e) => { if (e.target.name && e.target.value) validate(e.target.name); });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = validate();
  if (!r.success) { form.querySelector('.field--error input, .field--error textarea')?.focus(); return; }
  submit.classList.add('is-loading');
  submit.disabled = true;
  try {
    await request(`/api/v2/travellers/${travellerId}/bookings?lang=${locale}`, { method: 'POST', body: r.data, silent: true });
    const done = document.createElement('div');
    done.className = 'booking__done';
    done.innerHTML = `<p class="booking__done-title"></p><p></p>`;
    done.firstChild.textContent = t('booking.doneTitle');
    done.lastChild.textContent = t('booking.doneText', { day: summary.textContent });
    form.replaceWith(done);
    toast(t('booking.doneToast'), 'success');
  } catch (err) {
    if (err.status === 409) {
      toast(t('booking.taken'), 'error');
      selectedSlot = null;
      await loadSlots();
      updateSummary();
    } else if (err.status === 400 && err.data && err.data.errors) {
      showErrors(err.data.errors);
    } else {
      toast(err.status === 429 ? t('tooMany') : t('requestFailed'), 'error');
    }
  } finally {
    submit.classList.remove('is-loading');
    if (form.isConnected) submit.disabled = !slotInput.value;
  }
});

loadSlots();
updateSummary();
