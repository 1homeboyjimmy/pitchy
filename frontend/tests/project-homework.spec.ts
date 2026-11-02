import { expect, test, type Page } from '@playwright/test';

async function resident(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', r => r.fulfill({ json: { id: 18, name: 'Анна', email: null, is_admin: false, is_active: true, email_verified: true } }));
  await page.route('**/api/accelerators', r => r.fulfill({ json: [{ id: 7, name: 'Акселератор', status: 'active', access_role: 'resident' }] }));
  await page.route('**/api/accelerators/me/memberships', r => r.fulfill({ json: { memberships: [{ membership_id: 101, status: 'enrolled',
    accelerator: { id: 7, name: 'Акселератор', status: 'active' }, cohort: { id: 12, name: 'Основной поток', status: 'active', timezone: 'Europe/Moscow' },
    project: null, modules: { homework: true } }], effective_quotas: {} } }));
  await page.route('**/api/accelerators/notifications**', r => r.fulfill({ json: { items: [], count: 0, unread_count: 0, next_cursor: null } }));
  await page.route('**/api/accelerators/memberships/101/today', r => r.fulfill({ status: 503, json: { detail: 'Нет событий' } }));
  await page.route('**/api/accelerators/memberships/101/project-recommendations', r => r.fulfill({ json: { recommendations: [], dismissed_recommendations: [] } }));
}

for (const kind of ['solo', 'team', 'conflict'] as const) {
  test(`project homework submission supports ${kind}`, async ({ page }) => {
    await resident(page);
    const context = { team_id: kind === 'solo' ? null : 601, team_name: kind === 'solo' ? null : 'Исследователи', project_id: null,
      project_name: null, submitted_by_user_id: 18, members: [{ membership_id: 101, user_id: 18, name: 'Анна' },
        ...(kind === 'solo' ? [] : [{ membership_id: 102, user_id: 19, name: 'Олег' }])] };
    let revision = 0; let posts = 0;
    const work = () => ({ id: 41, cohort_id: 12, title: 'ДЗ 3', description: 'Исследуйте гипотезу', assignment_type: 'text_files', submission_mode: 'team',
      can_submit: true, expected_revision: revision, submission_context: context, workspace_submission: null, submission: null,
      display_status: 'not_started', is_overdue: false, allow_resubmit: true, pitchy_enabled: false, pitchy_tools: [], quiz_questions: [], max_attempts: 1 });
    await page.route('**/api/accelerators/memberships/101/homework', r => r.fulfill({ json: [work()] }));
    await page.route('**/api/accelerators/homework/41/submission', async r => {
      posts++; const body = r.request().postDataJSON();
      expect(body).toMatchObject({ answer_text: 'Моя работа по гипотезе', expected_revision: revision, expected_context: context });
      if (kind === 'conflict' && posts === 1) { revision = 1; return r.fulfill({ status: 409, json: { detail: 'Работу уже изменил другой участник. Обновите задание; ваш текст сохранён в форме.' } }); }
      return r.fulfill({ json: { id: 501, status: 'submitted' } });
    });
    await page.goto('/accelerator/my/101');
    await page.getByRole('button', { name: 'Программа', exact: true }).click();
    await page.getByRole('button', { name: 'Домашние задания', exact: true }).click();
    await expect(page.getByText(kind === 'solo' ? 'Вы сдаёте самостоятельно' : 'Один ответ от команды «Исследователи»', { exact: true })).toBeVisible();
    await expect(page.getByText(kind === 'solo' ? 'Засчитывается участникам: Анна' : 'Засчитывается участникам: Анна, Олег', { exact: true })).toBeVisible();
    const input = page.locator('#resident-homework-41 textarea');
    await input.fill('Моя работа по гипотезе');
    await page.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
    if (kind === 'conflict') {
      await expect(page.getByRole('alert').filter({ hasText: 'Работу уже изменил' })).toContainText('Работу уже изменил');
      await expect(input).toHaveValue('Моя работа по гипотезе');
      await page.getByRole('button', { name: 'Обновить сведения, сохранив мой текст', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Работу уже изменил' })).toHaveCount(0);
      await expect(input).toHaveValue('Моя работа по гипотезе');
      await page.getByRole('button', { name: 'Отправить ответ', exact: true }).click();
    }
    await expect.poll(() => posts).toBe(kind === 'conflict' ? 2 : 1);
  });
}

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


test('organizer can configure solo project work and individual exceptions', async ({ page }) => {
  await mockOverview(page);
  let saved = false;
  await page.route('**/api/accelerators/homework/41/exceptions', r => r.fulfill({ json: [] }));
  await page.route('**/api/accelerators/homework/41/credit-options', r => r.fulfill({ json: [] }));
  await page.route('**/api/accelerators/homework/41/exceptions/101', async r => {
    expect(r.request().postDataJSON()).toMatchObject({ allow_individual: true, reason: 'Выполнить исследование самостоятельно' });
    saved = true;
    return r.fulfill({ json: { membership_id: 101, allow_individual: true, due_at: null, reason: 'Выполнить исследование самостоятельно' } });
  });
  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await page.getByRole('button', { name: 'Домашние задания', exact: true }).click();
  await page.getByRole('button', { name: 'Все задания', exact: true }).click();
  await page.getByRole('button', { name: 'Индивидуальные условия и зачёт', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Индивидуальные условия и зачёт' });
  await dialog.getByLabel('Участник для индивидуальных условий').selectOption('101');
  await dialog.getByRole('checkbox').check();
  await dialog.getByLabel('Причина изменения условий').fill('Выполнить исследование самостоятельно');
  await dialog.getByRole('button', { name: 'Сохранить условия', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Индивидуальные условия сохранены');
  expect(saved).toBe(true);
  await page.screenshot({ path: '../output/project-homework-exceptions.png', fullPage: true });
});
