import { expect, test } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';
import { manager } from './fixtures/attendance';

test('organizer browser back and forward restore sections', async ({ page }) => {
  await mockOverview(page);
  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Участники: 3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
});

test('site Back restores previous section and reload retains history', async ({ page }) => {
  await mockOverview(page);
  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Участники: 3', exact: true }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '← Назад', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
});

test('back from event closes QR then event drawer without leaving attendance', async ({ page }) => {
  await manager(page);
  await page.route('**/api/accelerators/events/51/check-in-session', r => r.fulfill({ json: { checkin_url: 'https://pitchy.pro/test', expires_at: '2030-12-01T00:00:00Z', qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }));
  await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
  await page.getByRole('heading', { name: 'QR class', exact: true }).click();
  await page.getByRole('button', { name: 'QR-код и ссылка для отметки' }).click();
  await expect(page.getByRole('dialog', { name: 'QR-код и ссылка', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'QR-код и ссылка', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'QR class' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Мероприятия и посещаемость' })).toBeVisible();
});

test('cohort selection is restored on back and direct-link Back stays in accelerator', async ({ page }) => {
  await mockOverview(page);
  await page.goto('/accelerator?section=reports&accelerator=7&cohort=12');
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Поток', exact: true }).selectOption('13');
  await expect(page.getByRole('combobox', { name: 'Поток', exact: true })).toHaveValue('13');
  await page.goBack();
  await expect(page.getByRole('combobox', { name: 'Поток', exact: true })).toHaveValue('12');
});

test('direct-link site Back falls back to overview and repeated section clicks add no steps', async ({ page }) => {
  await mockOverview(page);
  await page.goto('/accelerator?section=reports&accelerator=7&cohort=12');
  await expect(page.getByRole('heading', { name: 'Участники', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Разделы акселератора' });
  await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
  await nav.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
});
