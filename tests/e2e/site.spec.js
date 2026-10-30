const { test, expect } = require('@playwright/test');

test.describe('home page', () => {
  test('renders the original sections in order', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Подорожники/);
    await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /.{40,}/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Відкрийте світ');
    await expect(page.getByRole('link', { name: 'Доєднатись' })).toBeVisible();
    const h2 = await page.locator('main h2').allTextContents();
    expect(h2).toEqual(['Проєкт, створений для тих, хто живе подорожами', 'Популярні історії', 'Наші Мандрівники', 'Популярні гіди', 'Приєднуйтесь до нашої спільноти']);
    await expect(page.locator('.popular__item')).toHaveCount(4);
    await expect(page.locator('.popular__item:visible')).toHaveCount(3); // 4th is shown only on tablets, like the original
    await expect(page.locator('.travellers-block__card')).toHaveCount(4);
    await expect(page.locator('link[rel=alternate][hreflang=en]')).toHaveAttribute('href', /\/en\/$/);
  });

  test('story page has meta, JSON-LD Article and popular stories', async ({ page }) => {
    await page.goto('/stories/68498236a100312bea07901c');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Марокко: вулиці Марракеша');
    await expect(page.getByText('Автор статті')).toBeVisible();
    await expect(page.getByText('Опубліковано')).toBeVisible();
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((s) => JSON.parse(s)['@type'] === 'Article')).toBe(true);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
    await expect(page.locator('.popular__item').first()).toBeVisible();
  });

  test('traveller page has JSON-LD Person and stories', async ({ page }) => {
    await page.goto('/travellers/6881563901add19ee16fcff5');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Історії Мандрівника');
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((s) => JSON.parse(s).mainEntity?.['@type'] === 'Person')).toBe(true);
  });

  test('404 page and sitemap/robots', async ({ page, request }) => {
    const r = await page.goto('/no-such-page');
    expect(r.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сторінку не знайдено');
    const sm = await request.get('/sitemap.xml');
    expect(await sm.text()).toContain('hreflang="es"');
    expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap:');
  });

  test('saving a story works anonymously and shows it on the saved page', async ({ page }) => {
    await page.goto('/stories/68498236a100312bea07901c');
    const before = Number(await page.locator('[data-fav-count]').first().textContent());
    await page.locator('[data-save-big]').click();
    await expect(page.locator('[data-save-big]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.toast')).toContainText('збережено');
    await page.goto('/saved');
    await expect(page.locator('[data-story-card="68498236a100312bea07901c"]')).toBeVisible();
    await expect(page.locator('[data-saved-nav]')).toBeVisible();
    await page.locator('[data-story-card="68498236a100312bea07901c"] [data-save]').click();
    await expect(page.locator('.empty-state')).toBeVisible();
    expect(before).toBeGreaterThanOrEqual(0);
  });
});

test.describe('faceted filter', () => {
  test('updates results, counts and URL without reload; URL is shareable', async ({ page }) => {
    await page.goto('/stories');
    const total0 = await page.locator('[data-total-label] b').textContent();
    await page.evaluate(() => { window.__noReload = true; });
    await page.locator('.facet__option[data-facet="season"][data-value="winter"]').click();
    await expect(page).toHaveURL(/\/stories\/filter\/season-winter$/);
    await expect(page.locator('.chip', { hasText: 'Зима' })).toBeVisible();
    expect(await page.evaluate(() => window.__noReload)).toBe(true); // no full page load happened
    const total1 = await page.locator('[data-total-label] b').textContent();
    expect(Number(total1)).toBeLessThan(Number(total0));
    await page.locator('.facet__option[data-facet="trip"][data-value="friends"]').click();
    await expect(page).toHaveURL(/season-winter\/trip-friends/);
    const url = page.url();
    // Server-rendered state for the same URL.
    await page.goto(url);
    await expect(page.locator('.facet__option[data-facet="season"][data-value="winter"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-total-label] b')).not.toHaveText(total1);
    // Back button restores the previous state.
    await page.goBack(); // reloading the same URL replaced the entry, so one step back
    await expect(page).toHaveURL(/\/stories\/filter\/season-winter$/);
  });

  test('zero-result options are disabled; category chips keep working', async ({ page }) => {
    await page.goto('/stories/filter/country-jp');
    const disabled = page.locator('.facet__option--disabled');
    expect(await disabled.count()).toBeGreaterThan(0);
    await page.locator('.categories__desktop [data-category]').filter({ hasText: 'Азія' }).click();
    await expect(page).toHaveURL(/category=68fb50c80ae91338641121f0/);
    await page.locator('[data-sort]').selectOption('popular');
    await expect(page).toHaveURL(/sort=popular/);
  });

  test('load more appends cards', async ({ page }) => {
    await page.goto('/stories');
    await expect(page.locator('[data-story-card]')).toHaveCount(9);
    await page.locator('[data-load-more]').click();
    await expect(page.locator('[data-story-card]')).toHaveCount(18);
  });
});

test.describe('natural-language search', () => {
  test('turns a query into removable chips', async ({ page }) => {
    await page.goto('/stories');
    await page.fill('[data-nl-input]', 'куди поїхати в травні з дітьми недорого');
    await page.press('[data-nl-input]', 'Enter');
    await expect(page).toHaveURL(/season-spring/);
    await expect(page).toHaveURL(/budget-low/);
    await expect(page).toHaveURL(/trip-family/);
    for (const label of ['Весна', 'Низький', "Сім'я"]) await expect(page.locator('.chip', { hasText: label })).toBeVisible();
    await page.locator('.chip', { hasText: 'Низький' }).click();
    await expect(page).not.toHaveURL(/budget-low/);
  });

  test('works without JavaScript through /stories/search', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto('/stories/search?q=' + encodeURIComponent('гори взимку з друзями'));
    await expect(page).toHaveURL(/season-winter/);
    await ctx.close();
  });
});

test.describe('map', () => {
  test('shows clustered markers and syncs the visible area with facets', async ({ page }) => {
    await page.goto('/map');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.locator('[data-map-status]')).toContainText(/\d+/);
    await expect(page.locator('.marker-cluster, .map-pin').first()).toBeVisible();
    await page.locator('[data-bbox-toggle]').check();
    await expect(page).toHaveURL(/bbox=/);
    await expect(page.locator('.chip', { hasText: 'Видима область' })).toBeVisible();
    await page.locator('.leaflet-control-zoom-in').click();
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/bbox=/);
  });

  test('list/map toggle on /stories keeps the filter', async ({ page }) => {
    await page.goto('/stories/filter/season-summer');
    await page.locator('[data-view="map"]').click();
    await expect(page).toHaveURL(/season-summer.*view=map/);
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});

test.describe('guides and booking', () => {
  test('home -> guides -> profile -> book a slot -> confirmation -> visible in admin', async ({ page }) => {
    const { adminLogin } = require('./helpers');
    await page.goto('/');
    await expect(page.locator('.guides-block .guide-card')).toHaveCount(4);
    await page.locator('.nav__list').getByRole('link', { name: 'Гіди', exact: true }).click();
    await expect(page).toHaveURL(/\/guides$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Гіди');
    const card = page.locator('.guide-card').filter({ has: page.locator('time') }).first();
    await card.locator('.guide-card__book').click();
    await expect(page).toHaveURL(/\/travellers\/[0-9a-f]{24}#booking$/);
    await expect(page.locator('.profile-card__badge')).toHaveText('Гід');
    // The booking block comes before the stories.
    const order = await page.evaluate(() => document.querySelector('#booking').compareDocumentPosition(document.querySelector('.profile-blog')));
    expect(order & 4).toBeTruthy();
    await page.locator('.calendar__day--available').first().click();
    await page.locator('[data-slot]').first().click();
    const name = 'E2E Гість ' + Date.now().toString(36);
    await page.fill('#b-name', name);
    await page.fill('#b-email', 'e2e-guest@example.com');
    await page.locator('[data-booking-submit]').click();
    await expect(page).toHaveURL(/\/booking\/[0-9a-f]{32}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Бронювання отримано');
    await expect(page.locator('[data-booking-status-label]')).toContainText('Нове');
    await expect(page.locator('.confirm__details')).toContainText(name);
    const confirmUrl = page.url();
    const cancelUrl = await page.locator('[data-cancel-link]').getAttribute('href');

    await adminLogin(page);
    await page.goto('/admin/bookings?status=new');
    await expect(page.locator('.tbl tbody tr', { hasText: name })).toBeVisible();

    // One-time cancel link.
    await page.goto(cancelUrl);
    await page.locator('[data-cancel-form] [type=submit]').click();
    await expect(page).toHaveURL(/cancelled=1/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Бронювання скасовано');
    await page.goto(cancelUrl);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Посилання вже не діє');
    await page.goto(confirmUrl);
    await expect(page.locator('[data-booking-status-label]')).toHaveText('Скасовано');
  });

  test('guides filters update the list; the same slot cannot be booked twice', async ({ page, request }) => {
    await page.goto('/guides');
    const total = await page.locator('.guide-card').count();
    await page.selectOption('#g-service', 'plan');
    await expect(page).toHaveURL(/service=plan/);
    await expect(page.locator('.guide-card .guide-card__kind', { hasText: 'Планування маршруту' }).first()).toBeVisible();
    expect(await page.locator('.guide-card').count()).toBeLessThanOrEqual(total);
    const g = (await (await request.get('/api/v2/guides?limit=1')).json()).data.guides[0];
    const b = (await (await request.get('/api/v2/travellers/' + g.id + '/booking')).json()).data;
    const body = { serviceId: b.services[0].id, slotId: b.slots[0].id, name: 'Race One', email: 'r1@example.com' };
    const first = await request.post('/api/v2/travellers/' + g.id + '/bookings', { data: body });
    expect(first.status()).toBe(201);
    expect((await first.json()).data.confirmUrl).toMatch(/^\/booking\/[0-9a-f]{32}$/);
    const second = await request.post('/api/v2/travellers/' + g.id + '/bookings', { data: { ...body, name: 'Race Two' } });
    expect(second.status()).toBe(409);
  });

  test('a story by a guide offers to book the author', async ({ page, request }) => {
    const g = (await (await request.get('/api/v2/guides?limit=1')).json()).data.guides[0];
    const s = (await (await request.get('/api/users/' + g.id + '?limit=1')).json()).data.stories[0];
    await page.goto('/stories/' + s._id);
    const cta = page.locator('[data-guide-cta]');
    await expect(cta).toContainText('Хочете так само?');
    await cta.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp('/travellers/' + g.id + '#booking$'));
  });
});

test.describe('languages', () => {
  test('switches between uk, en and es with translated UI and hreflang', async ({ page }) => {
    await page.goto('/');
    await page.locator('.footer__lang', { hasText: 'English' }).click();
    await expect(page).toHaveURL(/\/en\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Discover the world');
    await page.goto('/en/stories');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Travellers' Stories");
    await page.goto('/es/stories/68498236a100312bea07901c');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.story__note')).toContainText('ucraniano');
    await expect(page.locator('link[rel=alternate][hreflang=uk]')).toHaveAttribute('href', /\/stories\/68498236a100312bea07901c$/);
  });
});
