const { test, expect } = require('@playwright/test');

test.describe('mobile 375', () => {
  test('burger menu opens and closes', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.nav__list')).toBeHidden();
    await page.locator('[data-burger]').click();
    await expect(page.locator('.nav__list')).toBeVisible();
    await expect(page.locator('[data-burger]')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('.nav__list')).toBeHidden();
  });

  test('filter drawer and category select', async ({ page }) => {
    await page.goto('/stories');
    await expect(page.locator('[data-filter-panel]')).not.toBeInViewport();
    await page.locator('[data-open-filters]').click();
    await expect(page.locator('[data-filter-panel]')).toBeInViewport();
    await page.locator('.facet__option[data-facet="budget"][data-value="low"]').click();
    await expect(page).toHaveURL(/budget-low/);
    await page.locator('[data-show-results]').click();
    await expect(page.locator('[data-filter-panel]')).not.toBeInViewport();
    await page.locator('[data-category-select]').selectOption({ index: 2 });
    await expect(page).toHaveURL(/category=/);
  });

  test('travellers page loads 8 cards per step like the original', async ({ page }) => {
    await page.goto('/travellers');
    await expect(page.locator('.traveller-card')).toHaveCount(8);
    await page.locator('[data-load-more-travellers]').click();
    await expect(page.locator('.traveller-card')).toHaveCount(16);
  });

  test('guide profile shows a sticky book button that leads to the booking block', async ({ page, request }) => {
    const g = (await (await request.get('/api/v2/guides?limit=1')).json()).data.guides[0];
    await page.goto('/travellers/' + g.id);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const sticky = page.locator('[data-booking-sticky]');
    await expect(sticky).toBeInViewport();
    await sticky.getByRole('link').click();
    await expect(page.locator('#booking')).toBeInViewport();
  });

  test('burger menu has the guides item', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-burger]').click();
    await expect(page.locator('.nav__list').getByRole('link', { name: 'Гіди', exact: true })).toBeVisible();
  });

  test('no horizontal scroll on main pages', async ({ page }) => {
    for (const p of ['/', '/stories', '/travellers', '/guides', '/map', '/stories/68498236a100312bea07901c']) {
      await page.goto(p);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, p).toBeLessThanOrEqual(1);
    }
  });
});
