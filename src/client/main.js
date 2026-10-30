// Public site bundle: header menu, saves, catalog, load-more.
import { initSaved } from './saved.js';
import { initCatalog, initLoadMore } from './catalog.js';
import { initGuides } from './guides.js';

function initMenu() {
  const burger = document.querySelector('[data-burger]');
  const menu = document.querySelector('[data-menu]');
  const container = document.querySelector('[data-header-container]');
  if (!burger || !menu) return;
  const isHome = container.classList.contains('header__container--home');
  const icon = burger.querySelector('[data-burger-icon]');
  const homeEls = () => document.querySelectorAll('.header .btn--home, .header .nav__item--home, .header .nav__link--home');
  let homeMarked = [];
  const set = (open) => {
    menu.classList.toggle('header__menu--open', open);
    container.classList.toggle('header__container--open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? burger.dataset.labelClose : burger.dataset.labelOpen);
    icon.setAttribute('href', open ? '/sprite.svg#icon-close' : '/sprite.svg#icon-menu');
    document.body.style.overflow = open ? 'hidden' : '';
    // Over the hero the opened menu switches to the regular (light) header, as in the original.
    if (isHome) {
      container.classList.toggle('header__container--home', !open);
      document.querySelector('[data-logo-home]').toggleAttribute('hidden', open);
      document.querySelector('[data-logo-default]').toggleAttribute('hidden', !open);
      if (open) {
        homeMarked = [...homeEls()].map((el) => [el, [...el.classList].filter((c) => /--home$/.test(c))]);
        homeMarked.forEach(([el, cls]) => el.classList.remove(...cls));
      } else {
        homeMarked.forEach(([el, cls]) => el.classList.add(...cls));
      }
    }
  };
  burger.addEventListener('click', () => set(!menu.classList.contains('header__menu--open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('header__menu--open')) { set(false); burger.focus(); } });
  window.addEventListener('resize', () => { if (window.innerWidth >= 1440 && menu.classList.contains('header__menu--open')) set(false); });
}

initMenu();
initSaved();
initCatalog();
initLoadMore();
initGuides();

// Booking widget is loaded only where it is needed.
const bookingRoot = document.querySelector('[data-booking]');
if (bookingRoot) {
  const s = document.createElement('script');
  s.src = bookingRoot.dataset.script;
  s.defer = true;
  document.body.append(s);
}
