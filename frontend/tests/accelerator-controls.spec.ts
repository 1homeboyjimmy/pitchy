import { expect, test } from '@playwright/test';
import { manager } from './fixtures/attendance';
import { mockOverview } from './fixtures/acceleratorOverview';

for (const mode of ['light', 'dark']) {
  test(`selected application queue remains readable in ${mode}`, async ({ page }) => {
    await mockOverview(page);
    await page.addInitScript(mode => localStorage.setItem('pitchy_accelerator_theme', mode), mode);
    await page.goto('/accelerator?context=staff&section=applications&accelerator=7&cohort=12');
    const queues = page.getByRole('group', { name: 'Очереди заявок' });
    await expect(queues).toBeVisible();
    for (const button of await queues.getByRole('button').all()) {
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(button).toHaveCSS('color', mode === 'light' ? 'rgb(24, 34, 48)' : 'rgb(20, 19, 19)');
      await expect(button).toHaveCSS('background-color', mode === 'light' ? 'rgb(226, 232, 240)' : 'rgb(255, 255, 255)');
    }
  });
}

for (const width of [390, 1440, 1952]) {
  test(`event actions and long titles at ${width}px`, async ({ page }) => {
    await manager(page);
    await page.setViewportSize({ width, height: 1000 });
    const title = 'Правила поведения на сцене, практические навыки выступления';
    await page.route('**/api/accelerators/cohorts/12/events', route => route.fulfill({ json: [{ id: 51, title, status: 'published', starts_at: '2030-11-10T15:30:00Z', ends_at: '2030-11-10T16:30:00Z', homework_links: [], post_materials: [], attendance_count: 1, event_format: 'online' }] }));
    await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
    const card = page.locator('#dashboard-event-51');
    await expect(card.getByRole('heading', { name: title })).toBeVisible();
    for (const name of ['Перенести', 'Отменить', 'Итоги']) {
      const button = card.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveCSS('border-top-style', 'solid');
      await expect(button).toHaveCSS('color', name === 'Отменить' ? 'rgb(185, 28, 28)' : 'rgb(51, 65, 85)');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../output/fixes/events-${width}.png`, fullPage: true });
    await card.getByRole('heading', { name: title }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Отменить', exact: true })).toHaveCSS('color', 'rgb(185, 28, 28)');
  });
}

test('reset mark updates counts; failed reset preserves current status', async ({ page }) => {
  await manager(page);
  let status = 'present';
  let fail = true;
  await page.route('**/api/accelerators/events/51/attendance', route => {
    if (route.request().method() === 'PATCH') {
      expect(route.request().postDataJSON()).toEqual({ membership_id: 101, status: 'not_marked' });
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Попробуйте ещё раз' } });
      status = 'not_marked';
      return route.fulfill({ json: { status } });
    }
    return route.fulfill({ json: [{ membership_id: 101, name: 'Alex', email: 'test@example.test', status }] });
  });
  await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
  await page.getByRole('button', { name: 'Посещение', exact: true }).click();
  const reset = page.getByRole('button', { name: 'Снять отметку: Alex' });
  await reset.click();
  await expect(page.getByText('Сервис временно недоступен. Повторите попытку через минуту.', { exact: true })).toBeVisible();
  await expect(reset).toBeVisible();
  fail = false;
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Присутствовал', exact: true })).toHaveAttribute('aria-pressed', 'false');
});
