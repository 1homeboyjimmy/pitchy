import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

test.use({ timezoneId: 'America/Los_Angeles' });

import { mockOverview, homework, event, analytics } from './fixtures/acceleratorOverview';

test('overview shows real summary and connects actions and specific agenda entries', async ({ page }) => {
  await mockOverview(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/accelerator');
  await expect(page.getByRole('button', { name: 'Участники: 3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Пройдено программы: 50%' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Посещаемость: 67%' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Трекеры: 1' })).toBeVisible();
  await expect(page.getByText('1 из 3 участников завершили этап')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новый акселератор' })).toHaveCount(0);
  await page.screenshot({ path: '../output/accelerator-overview/implemented-desktop.png', fullPage: true });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (value: string) => { document.documentElement.dataset.copiedUrl = value; } } }));
  await page.getByRole('button', { name: 'Ссылка на заявку', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Скопировано', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.copiedUrl)).toBe(new URL('/accelerators/apply/12', page.url()).href);
  await page.getByRole('button', { name: 'Участники: 3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники' })).toBeVisible();
  await page.getByRole('button', { name: '← Обзор потока', exact: true }).click();
  await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
  await expect(page.getByText('Кандидат', { exact: true }).first()).toBeVisible();
  const back = () => page.getByRole('button', { name: '← Обзор потока', exact: true }).click();
  await back();
  await page.getByRole('button', { name: 'Проверить', exact: true }).click();
  await expect(page.locator('#dashboard-homework-41')).toHaveClass(/dashboard-focus/);
  await back();
  await page.getByRole('button', { name: 'Назначить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники' })).toBeVisible();
  await expect(page).toHaveURL(/resident=101/);
  await expect(page.getByRole('dialog', { name: 'Карточка участника' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Карточка участника' })).toHaveCount(0);
  await back();
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Трекинг', exact: true })).toBeVisible();
  await expect(page.getByText('Нет чек-ина')).toBeVisible();
  await back();
  await page.getByRole('button', { name: 'Открыть событие', exact: true }).click();
  await expect(page.locator('#dashboard-event-51')).toHaveClass(/dashboard-focus/);
  await back();
  await page.getByRole('button', { name: 'Перейти к этапу', exact: true }).click();
  await expect(page.locator('#dashboard-stage-31')).toHaveClass(/dashboard-focus/);
  await back();
  await page.getByRole('button', { name: 'Подробнее', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Операционный обзор' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Временно отключить', exact: true })).toHaveCount(0);
});

test('overview changes cohort without keeping old tasks and respects disabled modules', async ({ page }) => {
  await mockOverview(page);
  await page.goto('/accelerator');
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Поток', exact: true }).selectOption('13');
  await expect(page.getByText('Новый поток · Главное на сегодня')).toBeVisible();
  await expect(page.getByText('Срочных задач нет')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Участники: 0', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
  await expect(page.getByText('Воркшоп по CustDev')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Посещаемость:/ })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Разделы акселератора' }).getByRole('button', { name: 'Программа', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Домашние задания', exact: true })).toHaveCount(0);
});

test('overview survives a partial request failure and can retry', async ({ page }) => {
  await mockOverview(page);
  let failed = true;
  await page.route('**/api/accelerators/cohorts/12/homework', route => failed ? route.fulfill({ status: 503, json: { detail: 'Unavailable' } }) : route.fulfill({ json: [homework] }));
  await page.goto('/accelerator');
  const warning = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить' });
  await expect(warning).toContainText('Не удалось загрузить: задания');
  await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
});

test('overview mobile layout has working navigation and no page overflow', async ({ page }) => {
  await mockOverview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/accelerator');
  await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../output/accelerator-overview/implemented-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.getByRole('navigation', { name: 'Разделы акселератора' }).getByRole('button', { name: 'Участники', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участники' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeVisible();
});

test('overview avoids fetching temporarily disabled modules', async ({ page }) => {
  await mockOverview(page);
  const disabled = { homework: { scope_type: 'cohort' }, attendance: { scope_type: 'cohort' }, progress_tracking: { scope_type: 'cohort' } };
  await page.route('**/api/accelerators/cohorts/12/analytics', route => route.fulfill({ json: { ...analytics, runtime_disabled_modules: disabled } }));
  let moduleRequests = 0;
  for (const endpoint of ['homework', 'events', 'tracking-dashboard']) await page.route(`**/api/accelerators/cohorts/12/${endpoint}`, route => { moduleRequests++; return route.fulfill({ status: 503, json: { detail: 'Module disabled' } }); });
  await page.goto('/accelerator');
  await expect(page.getByRole('button', { name: 'Разобрать', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Посещаемость: 67%', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Проверить', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Назначить', exact: true })).toHaveCount(0);
  expect(moduleRequests).toBe(0);
});

test('overview displays naive UTC timestamps in the cohort timezone', async ({ page }) => {
  await mockOverview(page);
  const starts = new Date(Date.now() + 3_600_000);
  const ends = new Date(starts.getTime() + 3_600_000);
  await page.route('**/api/accelerators/cohorts/12/events', route => route.fulfill({ json: [{ ...event, starts_at: starts.toISOString().slice(0, -1), ends_at: ends.toISOString().slice(0, -1) }] }));
  await page.goto('/accelerator');
  const agenda = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Ближайшее', exact: true }) });
  await expect(agenda).toContainText(starts.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }));
  await expect(agenda.getByRole('button', { name: 'Открыть событие', exact: true })).toBeVisible();
});
