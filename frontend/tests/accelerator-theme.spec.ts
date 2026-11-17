import { test, expect } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';

const key = 'pitchy_accelerator_theme';
const theme = '.accelerator-theme';

test.beforeEach(async ({ page }) => { await mockOverview(page); });

test('light by default; keyboard toggle and reload preserve the selection', async ({ page }) => {
  await page.goto('/accelerator');
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
  await expect(page.locator(theme)).toHaveAttribute('data-theme', 'light');
  const button = page.getByRole('button', { name: 'Переключить тему' });
  await expect(button).toHaveText('Тёмная тема', { useInnerText: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(theme)).toHaveAttribute('data-theme', 'dark');
  await expect(button).toHaveText('Светлая тема', { useInnerText: true });
  await page.reload();
  await expect(page.locator(theme)).toHaveAttribute('data-theme', 'dark');
  await button.click();
  await page.reload();
  await expect(page.locator(theme)).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBe('light');
});

for (const saved of ['dark', 'light', 'invalid']) {
  test(`saved preference: ${saved}`, async ({ page }) => {
    await page.addInitScript(({ key, saved }) => localStorage.setItem(key, saved), { key, saved });
    await page.goto('/accelerator');
    await expect(page.locator(theme)).toHaveAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');
  });
}

test('switching works when storage is unavailable', async ({ page }) => {
  await page.addInitScript(({ key }) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function(k) { if (k === key) throw new Error('Blocked'); return original.call(this, k); };
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(k, v) { if (k === key) throw new Error('Blocked'); return set.call(this, k, v); };
  }, { key });
  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator(theme)).toHaveAttribute('data-theme', 'dark');
});

test('changes in another tab synchronize', async ({ page, context }) => {
  await page.goto('/accelerator');
  const other = await context.newPage();
  await other.goto('/accelerator');
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(other.locator(theme)).toHaveAttribute('data-theme', 'dark');
  await other.close();
});

for (const mode of ['light', 'dark']) {
  for (const width of [390, 1440]) {
    test(`${mode} theme at ${width}px: overview, navigation, settings and form`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.addInitScript(({ key, mode }) => localStorage.setItem(key, mode), { key, mode });
      await page.goto('/accelerator');
      await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
      const toggle = page.getByRole('button', { name: 'Переключить тему' });
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toHaveCSS('width', '44px');
      await expect(toggle).toHaveCSS('height', '44px');
      await expect(toggle).toHaveCSS('border-radius', '50%');
      await expect(page.locator('.accelerator-theme-toolbar')).toHaveCount(0);
      const header = page.locator('.organizer-header');
      await expect(header.getByRole('button', { name: 'Переключить тему' })).toBeVisible();
      const order = await header.locator('button[aria-label="Обновить"] + button').getAttribute('aria-label');
      expect(order).toBe('Переключить тему');
      await expect(page.locator('.overview-panel').first()).toHaveCSS('background-color', mode === 'light' ? 'rgb(255, 255, 255)' : 'rgb(28, 27, 27)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `../output/theme/${mode}-${width}.png`, fullPage: true });
      if (width < 1024) await page.getByRole('button', { name: /меню/i }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Основное', exact: true })).toBeVisible();
      const input = page.getByLabel('Поток', { exact: true });
      await expect(input.last()).toHaveCSS('color', mode === 'light' ? 'rgb(24, 34, 48)' : 'rgb(255, 255, 255)');
    });
  }
}

test('light text meets WCAG AA against panel background', async ({ page }) => {
  await page.goto('/accelerator');
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
  await expect(page.getByText('Интервью с клиентами', { exact: true })).toBeVisible();
  const ratios = await page.locator('.overview-panel [class*="text-white/"]').evaluateAll(elements => {
    const luminance = (rgb: number[]) => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, c, i) => n + c * [.2126, .7152, .0722][i], 0);
    return elements.filter(e => e.textContent?.trim()).map(e => {
      const rgb = getComputedStyle(e).color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      return 1.05 / (luminance(rgb) + .05);
    });
  });
  expect(ratios.length).toBeGreaterThan(10);
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
});

for (const route of ['/accelerator-invite', '/accelerator/check-in/example', '/accelerators/apply/12', '/accelerators/application-revision/example', '/accelerator/my/101']) {
  test(`theme covers ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Переключить тему' })).toBeVisible();
    await expect(page.locator(theme)).toHaveAttribute('data-theme', 'light');
  });
}

test('public pages keep their own styling after leaving the accelerator', async ({ page }) => {
  await page.goto('/accelerator');
  await page.goto('/terms');
  await expect(page.locator(theme)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Переключить тему' })).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('registration dialog is themed once and keeps editable fields readable', async ({ page }) => {
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [{ membership_id: 101, registration_required: true, participant_profile: {}, cohort: { name: 'Тестовый поток' } }], effective_quotas: {} } }));
  await page.goto('/accelerator');
  const gate = page.getByRole('dialog', { name: 'Завершение регистрации' });
  await expect(gate).toHaveCount(1);
  await expect(gate).toBeVisible();
  await expect(gate).toHaveCSS('background-color', 'rgb(246, 247, 249)');
  await expect(gate.getByLabel('Учебная группа')).toHaveCSS('color', 'rgb(24, 34, 48)');
  await gate.getByLabel('Учебная группа').fill('ИВБО-20-25');
  await expect(gate.getByLabel('Учебная группа')).toHaveValue('ИВБО-20-25');
});
