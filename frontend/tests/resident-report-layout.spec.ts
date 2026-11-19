import { expect, test } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';

for (const modules of [true, false]) {
  for (const [width, zoom] of [[1952, 1], [1952, 1.5], [1952, 2], [390, 1]]) {
    test(`report columns stay separated at ${width}px zoom ${zoom}, optional columns ${modules}`, async ({ page }) => {
      await mockOverview(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/accelerators/cohorts/12/report', route => route.fulfill({ json: {
        modules: { program_progress: modules, homework: modules },
        summary: { residents: 1, enrolled: 1, suspended: 0, completed: 0, overdue_homework: 0 },
        rows: [{ membership_id: 101, name: 'Абакумов Александр Ярославович', email: `${'longemail'.repeat(12)}@example.test`, status: 'enrolled',
          participant_profile: { institute: 'Университет с длинным названием и несколькими институтами', study_group: 'КРБО-01-23' },
          teams: [{ id: 1, name: 'Разработка системы поддержки принятия решений специалистом при сборе анамнеза и оценке психического состояния' }],
          trackers: [{ name: 'Трекер с длинным именем' }], program: { percent: 100 }, homework: { accepted: 5, total: 6, overdue: 1 }, attendance: { present: 10, total: 10, percent: 100 }, last_activity_at: '2026-11-19T10:00:00Z' }],
      } }));
      await page.goto('/accelerator?context=staff&section=reports&accelerator=7&cohort=12');
      const region = page.getByRole('region', { name: 'Таблица участников' });
      await expect(region).toBeVisible();
      await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom); }, zoom);
      await expect(region.getByRole('columnheader', { name: 'Активность', exact: true })).toHaveCount(0);
      const overflow = await region.evaluate(region => {
        const cells = [...region.querySelectorAll('th, td')];
        return cells.filter(cell => cell.scrollWidth > cell.clientWidth + 1).map(cell => cell.textContent);
      });
      expect(overflow).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await region.evaluate(region => { region.scrollLeft = region.scrollWidth; });
      await region.getByRole('button', { name: 'Карточка' }).scrollIntoViewIfNeeded();
      await expect(region.getByRole('button', { name: 'Карточка' })).toBeInViewport();
    });
  }
}
