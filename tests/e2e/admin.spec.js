const { test, expect } = require('@playwright/test');
const { adminLogin, adminCredentials } = require('./helpers');

test.describe('admin', () => {
  test('rejects a wrong password and protects routes', async ({ page, request }) => {
    const r = await request.get('/admin/stories', { maxRedirects: 0 });
    expect(r.status()).toBe(302);
    const api = await request.post('/admin/stories', { data: {}, maxRedirects: 0 });
    expect([302, 401, 403]).toContain(api.status());
    await page.goto('/admin/login');
    await page.fill('#username', adminCredentials().user);
    await page.fill('#password', 'definitely-wrong');
    await page.click('button[type=submit]');
    await expect(page.locator('.adm-alert--error')).toBeVisible();
  });

  test('dashboard, story CRUD with validation, hide and delete', async ({ page }) => {
    await adminLogin(page);
    await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
    await expect(page.locator('.kpi')).toHaveCount(6);

    await page.goto('/admin/stories/new');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.field--error').first()).toBeVisible(); // client-side zod validation

    const title = `E2E історія ${Date.now()}`;
    await page.fill('#title', title);
    await page.fill('#article', 'Текст історії для автотесту. '.repeat(5));
    await page.selectOption('#category_id', { index: 1 });
    await page.selectOption('#owner_id', { index: 1 });
    await page.selectOption('#country_code', 'JP');
    await page.fill('#region', 'Кансай');
    await page.fill('#region_en', 'Kansai');
    await page.locator('input[name=seasons][value=autumn]').check();
    await page.selectOption('#budget', 'medium');
    await page.locator('input[name=tags][value=food]').check();
    await page.fill('#duration_days', '6');
    await page.fill('#lat', '35.0116');
    await page.fill('#lng', '135.7681');
    await page.setInputFiles('[data-cover-input]', 'public/images/hero_2x.jpg');
    await page.locator('[data-submit]').click();
    await expect(page).toHaveURL(/\/admin\/stories\/[0-9a-f]{24}$/);
    const id = page.url().split('/').pop();
    await expect(page.locator('#title')).toHaveValue(title);
    await expect(page.locator('[data-cover-preview]')).toHaveAttribute('src', /\/uploads\/covers\//);

    // Visible on the site with facets.
    await page.goto(`/stories/${id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator('.story-facts')).toContainText('Японія');

    // Edit.
    await page.goto(`/admin/stories/${id}`);
    await page.fill('#title', title + ' (ред.)');
    await page.locator('[data-submit]').click();
    await expect(page.locator('.toast')).toContainText('Зміни збережено');

    // Hide from the list, then delete with confirmation.
    await page.goto('/admin/stories?q=' + encodeURIComponent(title));
    await page.locator(`[data-toggle-hidden="${id}"]`).click();
    await expect(page.locator(`[data-toggle-hidden="${id}"]`)).toHaveText('Приховано');
    expect((await page.request.get(`/stories/${id}`)).status()).toBe(404);
    await page.locator(`[data-delete="/admin/stories/${id}/delete"]`).click();
    await page.locator('[data-modal-confirm]').click();
    await expect(page.locator('.toast')).toContainText('видалено');
  });

  test('dictionaries: create and delete a tag; used category cannot be deleted', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/dictionaries');
    const form = page.locator('[data-form-name="facet"]');
    const slug = `e2e-${Date.now().toString(36)}`;
    await form.locator('[name=slug]').fill(slug);
    await form.locator('[name=label_uk]').fill('Е2Е тег');
    await form.locator('[name=label_en]').fill('E2E tag');
    await form.locator('[name=label_es]').fill('Etiqueta E2E');
    await form.locator('[type=submit]').click();
    await expect(page.locator('.chip-admin', { hasText: 'Е2Е тег' })).toBeVisible();
    await page.locator('.chip-admin', { hasText: 'Е2Е тег' }).locator('[data-delete]').click();
    await page.locator('[data-modal-confirm]').click();
    await expect(page.locator('.toast')).toContainText('Тег видалено');

    // Category "Азія" is used by stories -> refused with a clear message.
    await page.goto('/admin/dictionaries');
    await page.locator('[data-delete="/admin/categories/68fb50c80ae91338641121f0/delete"]').click();
    await page.locator('[data-modal-confirm]').click();
    await expect(page.locator('.toast--error')).toContainText('видалення заборонено');
  });

  test('traveller with services, slots and booking status change', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/travellers/new');
    const name = `E2E Гід ${Date.now() % 100000}`;
    await page.fill('#name', name);
    await page.locator('input[name=accepts_bookings]').check();
    await page.locator('[data-submit]').click();
    await expect(page).toHaveURL(/\/admin\/travellers\/[0-9a-f]{24}$/);
    const svc = page.locator('[data-service-form]');
    await svc.locator('[name=title]').fill('Тестовий созвон');
    await svc.locator('[name=price_label]').fill('€15');
    await svc.locator('[type=submit]').click();
    await expect(page.locator('td', { hasText: 'Тестовий созвон' })).toBeVisible();
    const from = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
    const slots = page.locator('form[action$="/slots"]');
    await slots.locator('[name=from]').fill(from);
    await slots.locator('[name=to]').fill(to);
    await slots.locator('[type=submit]').click();
    await expect(page.locator('.slot').first()).toBeVisible();

    await page.goto('/admin/bookings?status=new');
    const confirm = page.locator('[data-booking-status][data-status=confirmed]').first();
    if (await confirm.count()) {
      await confirm.click();
      await expect(page.locator('.toast')).toContainText('підтверджено');
    }
  });

  test('settings page and demo cleanup guard', async ({ page }) => {
    await adminLogin(page);
    await page.goto('/admin/settings');
    await page.fill('#bookingAid', '123456');
    await page.locator('form[data-plain-form] [type=submit]').click();
    await expect(page.locator('.toast')).toContainText('збережено');
    await expect(page.locator('#bookingAid')).toHaveValue('123456');
    // Without typing DELETE nothing is removed.
    await page.locator('[data-demo-delete] [type=submit]').click();
    await expect(page.locator('.toast--error')).toContainText('DELETE');
    await page.fill('#bookingAid', '');
    await page.locator('form[data-plain-form] [type=submit]').click();
  });
});
