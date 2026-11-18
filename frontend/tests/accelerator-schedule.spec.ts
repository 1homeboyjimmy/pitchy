import { expect, test } from '@playwright/test';
import { mockOverview } from './fixtures/acceleratorOverview';

const modules = { program: true, program_progress: false, homework: false, attendance: true, progress_tracking: true };

test('participant sees attendance and a timetable without completion or homework', async ({ page }) => {
  await mockOverview(page);
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: {
    memberships: [{ membership_id: 101, status: 'enrolled', modules,
      accelerator: { id: 7, name: 'Акселератор', status: 'active' },
      cohort: { id: 12, name: 'Преакселератор', status: 'active', timezone: 'Europe/Moscow' } }], effective_quotas: {},
  } }));
  await page.route('**/api/accelerators/memberships/101/today', route => route.fulfill({ json: {
    membership_id: 101, timezone: 'Europe/Moscow', required_actions: [], upcoming: [], unavailable_sections: [],
    progress: { percent: 0, total_stages: 13, completed_stages: 0, current_stage: null },
    attendance: { percent: 30, present: 3, total: 10, unmarked: 5, basis: 'planned' },
  } }));
  await page.route('**/api/accelerators/memberships/101/program-stages', route => route.fulfill({ json: [{
    id: 31, title: 'Целевая аудитория', state: 'locked', description: 'Спикер: Анна Иванова',
    materials: [{ id: 41, title: 'Ссылка на вебинар', url: 'https://example.test/webinar' }],
    timeline: [{ key: 'event:51', kind: 'event', id: 51, title: 'Вебинар', sort_at: '2026-11-18T15:00:00Z' }],
  }] }));
  await page.route('**/api/accelerators/memberships/101/events', route => route.fulfill({ json: [51, 52].map((id, i) => ({ id, title: i ? 'Маркетинг' : 'Рынок', starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z', status: 'published', event_format: 'online', timezone: 'Europe/Moscow', homework_links: [], post_materials: [] })) }));
  await page.goto('/accelerator/my/101');
  await expect(page.getByTestId('resident-today')).toBeVisible();
  await expect(page.getByText('30%', { exact: true })).toBeVisible();
  await expect(page.getByText('Посещено 3 из 10 мероприятий программы · 5 без отметки')).toBeVisible();
  await expect(page.getByText('0%', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/этапов завершены/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Все задания' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Нужно сделать' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Расписание и мероприятия', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Материалы программы' })).toBeVisible();
  const day = page.getByRole('button', { name: /18 ноябрь 2026.*Рынок.*Маркетинг/ });
  await day.click();
  await expect(page.locator('#resident-events-51')).toBeFocused();
  await expect(page.locator('#resident-events-52')).toBeVisible();
  await page.getByRole('button', { name: 'Следующий месяц' }).click();
  await expect(page.getByRole('button', { name: /18 декабрь 2026.*нет мероприятий/ })).toBeDisabled();
  await expect(page.getByText('Спикер: Анна Иванова')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ссылка на вебинар' })).toHaveAttribute('href', 'https://example.test/webinar');
  await expect(page.locator('#resident-events-51').getByText(/18 ноября 2026.*18:00/)).toBeVisible();
  await expect(page.getByText(/18:00:00/)).toHaveCount(0);
  await expect(page.getByText('Закрыт', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/этапов завершено|обязательных действий/)).toHaveCount(0);
});

test('organizer overview and participant report keep attendance without learning metrics', async ({ page }) => {
  await mockOverview(page);
  await page.route('**/api/accelerators/cohorts/12/program-config', route => route.fulfill({ json: {
    cohort_id: 12, version: 1, modules, locked_modules: { applications: true, program: true },
  } }));
  await page.route('**/api/accelerators/cohorts/12/report', route => route.fulfill({ json: {
    modules, summary: { residents: 1, enrolled: 1, suspended: 0, completed: 0, overdue_homework: 0 },
    rows: [{ membership_id: 101, name: 'Участник', email: 'resident@example.test', status: 'enrolled', trackers: [],
      program: { percent: 100 }, homework: { accepted: 0, total: 0, overdue: 0 }, attendance: { present: 3, total: 10, percent: 30 } }],
  } }));
  await page.goto('/accelerator');
  await expect(page.getByRole('heading', { name: 'Обзор потока' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Посещаемость:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Пройдено программы:/ })).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: 'Прогресс текущего этапа' })).toHaveCount(0);
  await page.goto('/accelerator?section=reports&cohort=12');
  await expect(page.getByRole('columnheader', { name: 'Посещение' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Программа' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Домашки' })).toHaveCount(0);
  await expect(page.getByText('Просрочено ДЗ', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: '3/10 · 30%' })).toBeVisible();
});
