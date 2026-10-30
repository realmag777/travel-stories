// Shared browser helpers: i18n strings, toasts, the top loader bar and a fetch wrapper
// that drives both (every request shows the loader, every failure shows a toast).

const dict = (() => {
  try { return JSON.parse(document.getElementById('i18n').textContent) || {}; } catch { return {}; }
})();

export function t(key, vars) {
  let s = key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), dict);
  if (s === undefined) return key;
  if (vars && typeof s === 'string') s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return s;
}

export const locale = document.body.dataset.locale || 'uk';

export function toast(message, type = 'info', timeout = 5000) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.className = 'toast__text';
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.setAttribute('aria-label', t('close'));
  close.innerHTML = '<svg width="16" height="16" aria-hidden="true"><use href="/sprite.svg#icon-close"></use></svg>';
  const remove = () => { el.classList.add('toast--leaving'); setTimeout(() => el.remove(), 220); };
  close.addEventListener('click', remove);
  el.append(text, close);
  box.append(el);
  if (timeout) setTimeout(remove, timeout);
}

let pending = 0;
function loader(on) {
  const bar = document.getElementById('loader-bar');
  if (!bar) return;
  pending += on ? 1 : -1;
  if (pending > 0) {
    bar.classList.remove('loader-bar--done');
    // Restart the transition so long requests keep moving.
    void bar.offsetWidth;
    bar.classList.add('loader-bar--active');
    document.body.setAttribute('aria-busy', 'true');
  } else {
    pending = 0;
    bar.classList.remove('loader-bar--active');
    bar.classList.add('loader-bar--done');
    document.body.removeAttribute('aria-busy');
  }
}

/** fetch with loader + error toast; resolves to parsed JSON (or throws after showing a toast). */
export async function request(url, { method = 'GET', body, headers = {}, silent = false, signal } = {}) {
  loader(true);
  try {
    const res = await fetch(url, {
      method,
      signal,
      headers: { Accept: 'application/json', ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.message) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (!silent) toast(e.status === 429 ? t('tooMany') : e.status ? t('requestFailed') : t('network'), 'error');
    throw e;
  } finally {
    loader(false);
  }
}
