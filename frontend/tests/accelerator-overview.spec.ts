import { expect as baseExpect, test, type Page } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 20_000 });

test.use({ timezoneId: 'America/Los_Angeles' });

const modules = { applications: true, program: true, homework: true, attendance: true, progress_tracking: true, matchmaking: true, project_audit: true, demo_day: true, pitchy_artifacts: true };
const stage = { id: 31, title: 'Проверка гипотез', status: 'published', position: 0, materials: [], actions: [], homework_assignment_ids: [] };
const homework = { id: 41, title: 'Интервью с клиентами', description: 'Проведите интервью', due_at: new Date(Date.now() + 86_400_000).toISOString(), status: 'published', audience: 'cohort', target_count: 3, target_membership_ids: [], submission_counts: { review_pending: 3 }, pitchy_tools: [], allow_resubmit: true };
const event = { id: 51, title: 'Воркшоп по CustDev', starts_at: new Date(Date.now() + 3_600_000).toISOString(), ends_at: new Date(Date.now() + 7_200_000).toISOString(), event_format: 'online', event_type: 'workshop', homework_links: [], post_materials: [], status: 'published', attendance_count: 0, checkin_url: '/accelerator/check-in/test' };
const residents = ['Егор', 'Александр', 'Мария'].map((name, index) => ({ membership_id: 101 + index, user_id: 8 + index, name, email: `resident${index}@example.test`, status: 'enrolled', trackers: index === 2 ? [{ user_id: 9, name: 'Анна' }] : [] }));
const analytics = { applications: { submitted: 1 }, residents: { enrolled: 3 }, program: { published_stages: 2, completion_percent: 50, participating_residents: 3, current_stage: { id: 31, title: stage.title, completed: 1, total: 3 } }, homework: { published: 1, submissions: { submitted: 3 } }, attendance: { published_events: 2, past_events: 1, attendance_percent: 67 }, teams: { active: 0, active_members: 0, average_size: 0 }, demo_day: { projects: 0, outcomes: {} }, alumni: { published_profiles: 0 }, quota_usage: {}, artifacts: {}, runtime_disabled_modules: {} };

async function mockOverview(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', route => route.fulfill({ json: { id: 1, name: 'Организатор', email: 'organizer@example.test', is_admin: false, is_active: true, email_verified: true } }));
  await page.route('**/api/accelerators', route => route.fulfill({ json: [{ id: 7, name: 'Pitchy Accelerator', access_role: 'organizer', status: 'active' }] }));
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/7/cohorts', route => route.fulfill({ json: [12, 13].map(id => ({ id, accelerator_id: 7, name: id === 12 ? 'Осень 2026' : 'Новый поток', status: id === 12 ? 'active' : 'draft', timezone: 'Europe/Moscow', application_form_schema: { fields: [] } })) }));
  await page.route('**/api/accelerators/notifications/unread-count', route => route.fulfill({ json: { count: 0 } }));
  await page.route('**/api/accelerators/cohorts/12/*', async route => {
    const path = new URL(route.request().url()).pathname.split('/').pop();
    const responses: Record<string, unknown> = {
      'program-config': { cohort_id: 12, version: 1, modules, locked_modules: { applications: true, program: true } },
      applications: [{ id: 71, status: 'submitted', applicant_name: 'Кандидат', application_type: 'project', form_payload: {}, submitted_at: new Date().toISOString() }],
      residents,
      analytics,
      'operations-health': { status: 'error', issues: [{ code: 'failed_notifications', severity: 'error', count: 27, message: 'Уведомления не доставлены', recommended_action: 'Проверьте состояние доставки' }] },
      homework: [homework], events: [event], trackers: [{ staff_id: 61, user_id: 9, name: 'Анна', email: 'tracker@example.test', membership_ids: [103], team_ids: [] }],
      'program-stages': [stage], 'homework-review-queue': { items: [] },
      report: { summary: { residents: 3, enrolled: 3, suspended: 0, completed: 0, overdue_homework: 0 }, rows: [] },
      'tracking-dashboard': { summary: { residents: 3, green: 2, yellow: 1, red: 0, overdue_tasks: 0 }, rows: residents.map((row, index) => ({ ...row, program: { percent: 50 }, homework: { overdue: 0 }, attendance: { present: 1, total: 1 }, open_tasks: 0, risk: { level: index === 2 ? 'yellow' : 'green', reasons: index === 2 ? ['Нет чек-ина'] : [], overdue_homework: 0, overdue_tasks: 0, attendance_percent: 100 } })) },
    };
    await route.fulfill({ json: responses[path || ''] || [] });
  });
  await page.route('**/api/accelerators/cohorts/13/*', route => {
    const path = new URL(route.request().url()).pathname.split('/').pop();
    const responses: Record<string, unknown> = { 'program-config': { cohort_id: 13, version: 1, modules: { applications: true, program: true }, locked_modules: {} }, analytics: { program: { published_stages: 0, completion_percent: 0, current_stage: null }, attendance: { past_events: 0, attendance_percent: 0 } }, 'operations-health': { issues: [] } };
    return route.fulfill({ json: responses[path || ''] || [] });
  });
}

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
  await page.keyboard.press('Escape');
  await back();
  await page.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Трекинг прогресса' })).toBeVisible();
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
