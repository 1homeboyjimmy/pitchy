import { expect, test, type Page } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';

async function workspace(page: Page) {
  await mockOverview(page);
  await page.route("**/me", route => route.fulfill({ json: { id: 1, name: "Администратор и участник", is_admin: true, is_active: true, email_verified: true } }));
  const memberships = [12, 13].map((cohortId, index) => ({
    membership_id: 101 + index, status: 'enrolled',
    accelerator: { id: 7, name: 'Акселератор', status: 'active' },
    cohort: { id: cohortId, name: `Поток ${cohortId}`, status: 'active', timezone: 'Europe/Moscow' },
    modules: {}, project: null,
  }));
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships, effective_quotas: {} } }));
  await page.route('**/api/accelerators/memberships/*/today', route => route.fulfill({ status: 503, json: { detail: 'Нет событий' } }));
  const initial = new Date().toISOString();
  const streams: Record<string, Array<{ id: number; title: string; body: string; created_at: string; read_at: string | null }>> = {
    '12:resident': [{ id: 501, title: 'Задание для участника 12', body: 'Личное событие', created_at: initial, read_at: null }],
    '13:resident': [{ id: 502, title: 'Задание для участника 13', body: 'Другой поток', created_at: initial, read_at: null }],
    '12:staff': [{ id: 601, title: 'Проверить работу в потоке 12', body: 'Служебное событие', created_at: initial, read_at: null }],
    '13:staff': [],
  };
  const writes: string[] = [];
  const requests: string[] = [];
  await page.route('**/api/accelerators/notifications**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/preferences')) return route.fulfill({ json: { email_enabled: true } });
    const cohort = url.searchParams.get('cohort_id');
    const context = url.searchParams.get('context');
    expect(cohort).toBeTruthy();
    expect(['resident', 'staff']).toContain(context);
    const key = `${cohort}:${context}`;
    requests.push(key);
    const items = streams[key] || [];
    if (url.pathname.endsWith('/unread-count')) return route.fulfill({ json: { count: items.filter(item => !item.read_at).length } });
    if (url.pathname.endsWith('/read-all')) {
      writes.push(key);
      for (const item of items) item.read_at = initial;
      return route.fulfill({ json: { updated: items.length, read_at: initial } });
    }
    if (url.pathname.endsWith('/read')) {
      const id = Number(url.pathname.split('/').at(-2));
      const item = items.find(row => row.id === id);
      expect(item).toBeTruthy();
      writes.push(key);
      if (item) item.read_at = initial;
      return route.fulfill({ json: item });
    }
    return route.fulfill({ json: { items, next_cursor: null } });
  });
  return { streams, writes, requests };
}

for (const mode of ['light', 'dark']) {
  test(`participant and staff inboxes stay separate across cohorts in ${mode}`, async ({ page }) => {
    const { streams, writes, requests } = await workspace(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('pitchy_accelerator_theme', value), mode);
    await page.goto('/accelerator/my/101');
    const bell = page.getByRole('button', { name: 'Уведомления, непрочитанных: 1', exact: true });
    await expect(bell).toBeVisible();
    const initialButton = await bell.boundingBox();
    // Prime native WebKit hit testing after the initial header is painted.
    if (initialButton) await page.mouse.move(initialButton.x + initialButton.width / 2, initialButton.y + initialButton.height / 2);
    await page.getByRole('button', { name: 'Уведомления, непрочитанных: 1', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Уведомления', exact: true });
    await expect(dialog.getByText('Задание для участника 12')).toBeVisible();
    await expect(dialog.getByText('Проверить работу в потоке 12')).toHaveCount(0);
    await expect(dialog.getByText('Задание для участника 13')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Прочитать все', exact: true }).click();
    expect(writes).toEqual(['12:resident']);
    expect(streams['12:staff'][0].read_at).toBeNull();
    expect(streams['13:resident'][0].read_at).toBeNull();
    await page.getByRole('combobox', { name: 'Поток', exact: true }).selectOption('102');
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Уведомления, непрочитанных: 1', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Уведомления', exact: true });
    await expect(dialog.getByText('Задание для участника 13')).toBeVisible();
    await expect(dialog.getByText('Задание для участника 12')).toHaveCount(0);
    await page.goto('/accelerator?context=staff&accelerator=7&cohort=12');
    await page.getByRole('button', { name: 'Уведомления, непрочитанных: 1', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Уведомления', exact: true });
    await expect(dialog.getByText('Проверить работу в потоке 12')).toBeVisible();
    await expect(dialog.getByText('Задание для участника 12')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Отметить прочитанным', exact: true }).click();
    expect(writes).toEqual(['12:resident', '12:staff']);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `../output/notifications-${mode}-mobile.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('combobox', { name: 'Поток', exact: true }).selectOption('13');
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Уведомления', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Уведомления' }).getByText('Пока тихо')).toBeVisible();
    await expect(page.getByText('Проверить работу в потоке 12')).toHaveCount(0);
    expect(requests).toContain('13:resident');
    expect(requests).toContain('13:staff');
  });
}
