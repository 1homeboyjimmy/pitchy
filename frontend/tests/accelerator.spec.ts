import { expect, test, type Page } from '@playwright/test';

async function mockManagerWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 1, email: 'admin@example.test', name: 'Admin', is_admin: true, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [{ id: 7, name: 'Тестовый акселератор', description: 'Программа для команд', status: 'draft', access_role: 'global_admin' }] }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/7/cohorts', async (route) => route.fulfill({ json: [{ id: 12, accelerator_id: 7, name: 'Поток 2026', status: 'draft', timezone: 'Europe/Moscow', application_form_schema: { title: 'Заявка', fields: [] }, default_quota_config: { messages: 70, roadmaps: 4, custdev: 2, grants: 1 } }] }));
  await page.route('**/api/accelerators/cohorts/12/program-config', async (route) => route.fulfill({ json: { cohort_id: 12, version: 1, modules: { applications: true, program: true, homework: true, attendance: false, progress_tracking: true, matchmaking: true, project_audit: true, demo_day: true, pitchy_artifacts: true }, locked_modules: { applications: true, program: true } } }));
  await page.route('**/api/accelerators/cohorts/12/applications', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/residents', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/program-stages', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/matchmaking/profiles', async (route) => route.fulfill({ json: [{ id: 41, user_id: 8, membership_id: 101, role: 'resident', name: 'Резидент А', email: 'resident@example.test', expertise: ['продукт'], needs: ['продажи'], industries: ['SaaS'], goals: [], preferred_formats: ['онлайн'], max_matches: 3, active_matches: 0, active: true }] }));
  await page.route('**/api/accelerators/cohorts/12/matches', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/project-audits', async (route) => route.fulfill({ json: { access_role: 'global_admin', audits: [{ id: 81, membership_id: 101, audit_type: 'product', audit_type_label: 'Продукт', status: 'completed', overall_score: 72, project: { id: 5, name: 'Проект А' }, resident: { id: 8, name: 'Резидент А' }, requested_by: { id: 1, name: 'Admin' }, quota: { resource: 'custdev', consumed: true }, linked_tasks: [], result: { summary: 'Проблема подтверждена, требуется проверить цену.', overall_score: 72, strengths: ['Есть интервью'], findings: [{ title: 'Не проверена цена', description: 'Нет оплаченных пилотов', severity: 'medium' }], recommendations: [{ title: 'Проверить цену', description: 'Предложить три пилота', priority: 'high', expected_result: 'Один оплаченный пилот' }], data_gaps: [] }, created_at: new Date().toISOString() }] } }));
  await page.route('**/api/accelerators/cohorts/12/demo-days', async (route) => route.fulfill({ json: { access_role: 'global_admin', demo_days: [{ id: 91, title: 'Demo Day 2026', status: 'finalized', access_role: 'global_admin', criteria: [{ key: 'problem', label: 'Проблема', weight: 100, max_score: 10 }], experts: [{ id: 1, user_id: 9, name: 'Expert', email: 'expert@example.test' }], projects: [{ id: 92, membership_id: 101, resident: { id: 8, name: 'Резидент А', email: 'resident@example.test' }, project: { id: 5, name: 'Проект А', readiness_index: 80 }, pitch_title: 'Проект А', summary: 'Автоматизация процесса', presentation_url: 'https://example.test/pitch', attachments: [], submitted_at: new Date().toISOString(), evaluation_count: 1, average_score: 90, score_adjustment: 2, outcome: 'winner', final_score: 92, rank: 1, evaluations: [] }] }] } }));
  await page.route('**/api/accelerators/cohorts/12/artifacts', async (route) => route.fulfill({ json: { access_role: 'global_admin', artifacts: [{ id: 111, artifact_type: 'chat', status: 'ready', title: 'Разбор гипотезы', summary: 'Гипотеза уточнена и готова к проверке.', visibility: { organizer: true, tracker: false }, updated_at: new Date().toISOString(), details_visible: true, resident: { id: 8, name: 'Резидент А' }, project: { id: 5, name: 'Проект А' }, action: { id: 21, title: 'Разобрать гипотезу', action_type: 'chat' }, stage: { id: 31, title: 'Проверка проблемы' } }] } }));
  await page.route('**/api/accelerators/cohorts/12/teams', async (route) => route.fulfill({ json: { teams: [{ id: 601, name: 'Команда Проекта А', status: 'active', max_members: 5, project: { id: 5, name: 'Проект А' }, owner_membership_id: 101, can_manage: false, members: [{ id: 611, membership_id: 101, role: 'owner', title: 'Основатель', status: 'active', share_contact: true, person: { id: 8, name: 'Резидент А', email: 'resident@example.test' } }, { id: 612, membership_id: 102, role: 'member', title: 'Продажи', status: 'active', share_contact: false, person: { id: 9, name: 'Резидент Б' } }], pending_invitations: [{ id: 621, team_id: 601, status: 'pending', message: null, expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(), team: { id: 601, name: 'Команда Проекта А', project: { id: 5, name: 'Проект А' } }, invitee: { membership_id: 103, name: 'Резидент В' }, invited_by: { id: 8, name: 'Резидент А' }, counterpart_profile_id: 43, can_respond: false, can_cancel: false }] }] } }));
  await page.route('**/api/accelerators/cohorts/12/analytics', async (route) => route.fulfill({ json: { cohort_id: 12, applications: { submitted: 9, accepted: 4 }, residents: { enrolled: 4 }, program: { published_stages: 5, completion_percent: 60 }, homework: { published: 3, submissions: { submitted: 7 } }, attendance: { published_events: 2, attendance_percent: 75 }, quota_usage: { messages: 31 }, artifacts: { ready: 6 }, teams: { active: 1, active_members: 2, average_size: 2 }, demo_day: { projects: 1, outcomes: { winner: 1 } }, alumni: { published_profiles: 0 }, runtime_disabled_modules: {} } }));
  await page.route('**/api/accelerators/cohorts/12/operations-health', async (route) => route.fulfill({ json: { cohort_id: 12, status: 'warning', summary: { error: 0, warning: 1, info: 0 }, issues: [{ code: 'stale_applications', severity: 'warning', count: 2, message: 'Заявки находятся в работе больше 7 дней', recommended_action: 'Откройте раздел заявок и зафиксируйте решение' }] } }));
  let runtimeOverrides: Array<Record<string, unknown>> = [];
  await page.route('**/api/accelerators/runtime-overrides', async (route) => {
    if (route.request().method() === 'PUT') {
      const payload = route.request().postDataJSON();
      runtimeOverrides = payload.disabled ? [{ id: 801, scope_type: payload.scope_type, scope_id: payload.scope_id, module_key: payload.module_key, reason: payload.reason, expires_at: payload.expires_at, active: true }] : [];
    }
    await route.fulfill({ json: { overrides: runtimeOverrides } });
  });
  await page.route('**/api/accelerators/7/organizers', async (route) => route.fulfill({ json: [] }));
  let emailEnabled = false;
  await page.route('**/api/accelerators/notifications/unread-count', async (route) => route.fulfill({ json: { count: 2 } }));
  await page.route('**/api/accelerators/notifications?**', async (route) => route.fulfill({ json: { items: [
    { id: 501, event_type: 'homework.reviewed', title: 'Домашняя работа принята', body: 'Откройте программу и продолжайте следующий этап.', action_url: '/accelerator?from=notification', read_at: null, created_at: new Date().toISOString() },
    { id: 502, event_type: 'security.external', title: 'Внешняя ссылка заблокирована', body: 'Такой переход не должен открываться.', action_url: 'javascript:alert(1)', read_at: null, created_at: new Date().toISOString() },
  ], next_cursor: null } }));
  await page.route('**/api/accelerators/notifications/preferences', async (route) => {
    if (route.request().method() === 'PATCH') emailEnabled = Boolean(route.request().postDataJSON().email_enabled);
    await route.fulfill({ json: { email_enabled: emailEnabled } });
  });
  await page.route('**/api/accelerators/notifications/*/read', async (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/accelerators/notifications/read-all', async (route) => route.fulfill({ json: { ok: true } }));
}

test('manager workspace is split into focused sections', async ({ page }) => {
  await mockManagerWorkspace(page);
  await page.goto('/accelerator');
  await expect(page.getByRole('heading', { name: 'Поток 2026' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Заявки');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Домашние задания');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).not.toContainText('Посещаемость');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Трекеры');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Отчётность');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Матчмейкинг');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Аудит проекта');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Демо-день');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Результаты Pitchy');
  await page.getByRole('button', { name: 'Состояние', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Операционный обзор' })).toBeVisible();
  await expect(page.getByText('Заявки находятся в работе больше 7 дней')).toBeVisible();
  await expect(page.getByText('60%')).toBeVisible();
  await page.getByPlaceholder('Что произошло и когда проверить снова').fill('Плановые работы');
  await page.getByRole('button', { name: 'Временно отключить', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Временно отключённые функции' })).toBeVisible();
  await expect(page.getByText('Плановые работы')).toBeVisible();
  await page.getByRole('button', { name: 'Результаты Pitchy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Артефакты резидентов' })).toBeVisible();
  await expect(page.getByText('Гипотеза уточнена и готова к проверке.')).toBeVisible();
  await page.getByRole('button', { name: 'Демо-день', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Demo Day 2026' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Результаты CSV' })).toBeVisible();
  await page.getByRole('button', { name: 'Аудит проекта', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Аудит проекта' })).toBeVisible();
  await expect(page.getByText('Проблема подтверждена, требуется проверить цену.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'В задачи' })).toBeVisible();
  await page.getByRole('button', { name: 'Матчмейкинг', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Команды потока' })).toBeVisible();
  await expect(page.getByText('Команда Проекта А')).toBeVisible();
  await expect(page.getByText('resident@example.test')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Подобрать связку' })).toBeVisible();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор функций' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Матчмейкинг Включён' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Демо-день и экспорт Включён' })).toBeVisible();
});

test('notification center keeps navigation internal and manages read state', async ({ page }) => {
  await mockManagerWorkspace(page);
  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Уведомления, непрочитанных: 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Уведомления' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Домашняя работа принята')).toBeVisible();
  await expect(dialog.getByText('Внешняя ссылка заблокирована')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Открыть' })).toHaveCount(1);
  await dialog.getByLabel('Дублировать на email').check();
  await expect(dialog.getByLabel('Дублировать на email')).toBeChecked();
  await dialog.getByRole('listitem').filter({ hasText: 'Внешняя ссылка заблокирована' }).getByRole('button', { name: 'Отметить прочитанным' }).click();
  await expect(page.getByRole('button', { name: 'Уведомления, непрочитанных: 1' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Прочитать все' }).click();
  await expect(page.getByRole('button', { name: 'Уведомления', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Открыть' }).click();
  await expect(page).toHaveURL(/\/accelerator\?from=notification$/);
});

test('resident launches a Pitchy action and controls result visibility', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 8, email: 'resident@example.test', name: 'Резидент А', is_admin: false, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [{ id: 7, name: 'Тестовый акселератор', status: 'active', access_role: 'resident' }] }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [{ membership_id: 101, application_id: 44, status: 'enrolled', accepted_at: new Date().toISOString(), enrolled_at: new Date().toISOString(), accelerator: { id: 7, name: 'Тестовый акселератор', status: 'active' }, cohort: { id: 12, name: 'Поток 2026', status: 'active', timezone: 'Europe/Moscow' }, project: { id: 5, name: 'Проект А', readiness_index: 70, status: 'active' }, modules: { applications: true, program: true, pitchy_artifacts: true } }], effective_quotas: {} } }));

  let artifact: Record<string, unknown> | null = null;
  const programStages = () => [{ id: 31, title: 'Проверка проблемы', description: 'Проверьте ключевую гипотезу.', required: true, state: 'available', materials: [], actions: [{ id: 21, action_type: 'chat', title: 'Разобрать гипотезу', description: 'Обсудите риски с аналитиком.', required: true, artifact }] }];
  await page.route('**/api/accelerators/memberships/101/program-stages', async (route) => route.fulfill({ json: programStages() }));
  await page.route('**/api/accelerators/program/actions/21/launch', async (route) => {
    artifact = { id: 111, action_id: 21, artifact_type: 'chat', status: 'started', title: 'Разобрать гипотезу', summary: null, url: '/dashboard?tab=chat&session=33', source_type: 'chat_session', source_id: '33', visibility: { organizer: false, tracker: false }, updated_at: new Date().toISOString() };
    await route.fulfill({ json: { artifact, launch_url: '/dashboard?tab=chat&session=33' } });
  });
  await page.route('**/api/accelerators/program/artifacts/111/sync', async (route) => {
    artifact = { ...artifact, status: 'ready', updated_at: new Date().toISOString() };
    await route.fulfill({ json: artifact });
  });
  let updatePayload: Record<string, unknown> | null = null;
  await page.route('**/api/accelerators/program/artifacts/111', async (route) => {
    updatePayload = route.request().postDataJSON();
    artifact = { ...artifact, visibility: { organizer: true, tracker: false }, updated_at: new Date().toISOString() };
    await route.fulfill({ json: artifact });
  });

  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Программа', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Действия и результаты' })).toBeVisible();
  await expect(page.getByText('Разобрать гипотезу', { exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/dashboard\?tab=chat&session=33/);
  await popup.close();
  await expect(page.getByRole('button', { name: 'Проверить диалог' })).toBeVisible();
  await page.getByRole('button', { name: 'Проверить диалог' }).click();
  await expect(page.getByText('Готов', { exact: true })).toBeVisible();
  await page.getByLabel('Организатору').check();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => updatePayload).toMatchObject({ share_with_organizer: true, share_with_tracker: false });
});

test('resident creates a team and invites only recommended residents', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 8, email: 'resident@example.test', name: 'Резидент А', is_admin: false, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [{ id: 7, name: 'Тестовый акселератор', status: 'active', access_role: 'resident' }] }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [{ membership_id: 101, application_id: 44, status: 'enrolled', accepted_at: new Date().toISOString(), enrolled_at: new Date().toISOString(), accelerator: { id: 7, name: 'Тестовый акселератор', status: 'active' }, cohort: { id: 12, name: 'Поток 2026', status: 'active', timezone: 'Europe/Moscow' }, project: { id: 5, name: 'Проект А', readiness_index: 70, status: 'active' }, modules: { applications: true, program: true, matchmaking: true } }], effective_quotas: {} } }));
  await page.route('**/api/accelerators/notifications/unread-count', async (route) => route.fulfill({ json: { count: 0 } }));
  const residentProfile = { id: 41, user_id: 8, membership_id: 101, role: 'resident', name: 'Резидент А', bio: 'Основатель проекта', expertise: ['продукт'], needs: ['продажи'], industries: ['SaaS'], goals: [], preferred_formats: ['онлайн'], max_matches: 5, active_matches: 0, active: true };
  await page.route('**/api/accelerators/cohorts/12/matchmaking/me', async (route) => route.fulfill({ json: { access_role: 'resident', profiles: [residentProfile], matches: [] } }));
  await page.route('**/api/accelerators/memberships/101/match-profile', async (route) => route.fulfill({ json: residentProfile }));

  let teamCreated = false;
  let teamStatus = 'active';
  let teamCanManage = true;
  let viewerLeft = false;
  let shareContact = false;
  let incomingInvitations: Array<Record<string, unknown>> = [{ id: 701, team_id: 880, status: 'pending', team: { id: 880, name: 'Команда Альфа', project: { id: 6, name: 'Проект Альфа' } }, invitee: { membership_id: 101, name: 'Резидент А' }, invited_by: { id: 10, name: 'Резидент Г' }, counterpart_profile_id: 41, can_respond: true, can_cancel: false, expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(), message: 'Присоединяйтесь к продуктовой команде' }];
  let pendingInvitations: Array<Record<string, unknown>> = [];
  let createPayload: Record<string, unknown> | null = null;
  let answerPayload: Record<string, unknown> | null = null;
  let invitePayload: Record<string, unknown> | null = null;
  let contactPayload: Record<string, unknown> | null = null;
  let memberPayload: Record<string, unknown> | null = null;
  let archivePayload: Record<string, unknown> | null = null;
  const currentTeam = () => teamCreated ? { id: 900, name: 'Команда Проект А', status: teamStatus, max_members: 5, project: { id: 5, name: 'Проект А' }, owner_membership_id: teamCanManage ? 101 : 103, can_manage: teamCanManage, members: [{ id: 801, membership_id: 101, role: teamCanManage ? 'owner' : 'member', title: teamCanManage ? 'Основатель' : 'Продукт', status: viewerLeft ? 'left' : 'active', share_contact: shareContact, person: { id: 8, name: 'Резидент А', ...(shareContact ? { email: 'resident@example.test' } : {}) } }, { id: 802, membership_id: 103, role: teamCanManage ? 'member' : 'owner', title: 'Технологии', status: 'active', share_contact: false, person: { id: 11, name: 'Резидент Д' } }], pending_invitations: pendingInvitations } : null;
  await page.route('**/api/accelerators/memberships/101/team', async (route) => {
    if (route.request().method() === 'POST') { createPayload = route.request().postDataJSON(); teamCreated = true; }
    await route.fulfill({ json: route.request().method() === 'GET' ? { team: currentTeam(), invitations: incomingInvitations } : currentTeam() });
  });
  await page.route('**/api/accelerators/team-invitations/701', async (route) => {
    answerPayload = route.request().postDataJSON(); incomingInvitations = [];
    await route.fulfill({ json: { id: 701, ...answerPayload } });
  });
  await page.route('**/api/accelerators/memberships/101/matchmaking/recommendations?role=resident', async (route) => route.fulfill({ json: [
    { profile: { id: 902, membership_id: 102, role: 'resident', name: 'Резидент Б', bio: 'Эксперт по продажам' }, score: 91, reasons: ['Закрывает запрос: продажи'] },
    { profile: { id: 903, role: 'expert', name: 'Эксперт В' }, score: 99, reasons: ['Не является резидентом'] },
  ] }));
  await page.route('**/api/accelerators/teams/900/invitations', async (route) => {
    invitePayload = route.request().postDataJSON();
    pendingInvitations = [{ id: 702, team_id: 900, status: 'pending', message: 'Нужна помощь с первыми продажами', expires_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: new Date().toISOString(), team: { id: 900, name: 'Команда Проект А', project: { id: 5, name: 'Проект А' } }, invitee: { membership_id: 102, name: 'Резидент Б' }, invited_by: { id: 8, name: 'Резидент А' }, counterpart_profile_id: 902, can_respond: false, can_cancel: true }];
    await route.fulfill({ json: pendingInvitations[0] });
  });
  await page.route('**/api/accelerators/team-members/801/contact', async (route) => {
    contactPayload = route.request().postDataJSON(); shareContact = Boolean(contactPayload?.share_contact);
    await route.fulfill({ json: currentTeam()?.members[0] });
  });
  await page.route('**/api/accelerators/team-members/802', async (route) => {
    memberPayload = route.request().postDataJSON();
    await route.fulfill({ json: { id: 802, membership_id: 103, ...memberPayload, status: 'active', share_contact: false, person: { id: 11, name: 'Резидент Д' } } });
  });
  await page.route('**/api/accelerators/team-members/801', async (route) => {
    if (route.request().method() === 'DELETE') viewerLeft = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/accelerators/teams/900', async (route) => {
    archivePayload = route.request().postDataJSON();
    if (archivePayload?.status === 'archived') teamStatus = 'archived';
    await route.fulfill({ json: currentTeam() });
  });

  await page.goto('/accelerator');
  await page.getByRole('button', { name: 'Матчмейкинг', exact: true }).click();
  await expect(page.getByText('Команда Альфа')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Принять' })).toBeVisible();
  await page.getByRole('button', { name: 'Отклонить' }).click();
  await expect.poll(() => answerPayload).toMatchObject({ status: 'declined' });
  await page.getByLabel('Название', { exact: true }).fill('Команда Проект А');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect.poll(() => createPayload).toMatchObject({ name: 'Команда Проект А', max_members: 5 });
  await expect(page.getByRole('heading', { name: 'Команда Проект А' })).toBeVisible();
  await page.getByRole('button', { name: 'Подобрать резидентов' }).click();
  await expect(page.getByText('Резидент Б', { exact: true })).toBeVisible();
  await expect(page.getByText('Эксперт В')).toHaveCount(0);
  await page.getByLabel('Сообщение для Резидент Б').fill('Нужна помощь с первыми продажами');
  await page.getByRole('button', { name: 'Пригласить в команду' }).click();
  await expect.poll(() => invitePayload).toMatchObject({ counterpart_profile_id: 902, message: 'Нужна помощь с первыми продажами' });
  await expect(page.getByText('Ожидают ответа')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть контакт Резидент А' }).click();
  await expect.poll(() => contactPayload).toMatchObject({ share_contact: true });
  await expect(page.getByText('resident@example.test')).toBeVisible();
  await page.getByLabel('Роль Резидент Д').selectOption('cofounder');
  await page.getByRole('button', { name: 'Сохранить роль' }).click();
  await expect.poll(() => memberPayload).toMatchObject({ role: 'cofounder', title: 'Технологии' });
  await expect(page.getByLabel('Максимум участников команды')).toHaveAttribute('min', '3');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Архивировать команду' }).click();
  await expect.poll(() => archivePayload).toMatchObject({ status: 'archived' });
  await expect(page.getByText('В архиве', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подобрать резидентов' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Скрыть контакт Резидент А' })).toHaveCount(0);
  teamStatus = 'active'; teamCanManage = false;
  await page.reload();
  await page.getByRole('button', { name: 'Матчмейкинг', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Покинуть команду' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Покинуть команду' }).click();
  await expect(page.getByText('Вы больше не состоите в этой команде. История состава доступна только для просмотра.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Покинуть команду' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Скрыть контакт Резидент А' })).toHaveCount(0);
});

test('tracker sees reporting only for assigned residents', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 5, email: 'tracker@example.test', name: 'Tracker', is_admin: false, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [{ id: 7, name: 'Тестовый акселератор', status: 'active', access_role: 'tracker' }] }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/7/cohorts', async (route) => route.fulfill({ json: [{ id: 12, accelerator_id: 7, name: 'Поток 2026', status: 'active', timezone: 'Europe/Moscow', application_form_schema: { title: 'Заявка', fields: [] } }] }));
  await page.route('**/api/accelerators/cohorts/12/program-config', async (route) => route.fulfill({ json: { cohort_id: 12, version: 1, modules: { applications: true, program: true, homework: true, attendance: true, progress_tracking: true, project_audit: true }, locked_modules: { applications: true, program: true } } }));
  await page.route('**/api/accelerators/cohorts/12/residents', async (route) => route.fulfill({ json: [{ membership_id: 101, user_id: 8, name: 'Резидент А', email: 'resident@example.test', status: 'enrolled', trackers: [{ user_id: 5, name: 'Tracker' }] }] }));
  await page.route('**/api/accelerators/cohorts/12/report', async (route) => route.fulfill({ json: {
    access_role: 'tracker',
    summary: { residents: 1, enrolled: 1, suspended: 0, completed: 0, overdue_homework: 1 },
    rows: [{ membership_id: 101, name: 'Резидент А', email: 'resident@example.test', status: 'enrolled', trackers: [{ user_id: 5, name: 'Tracker' }], program: { completed: 2, total: 4, percent: 50 }, homework: { accepted: 1, waiting_review: 0, overdue: 1, total: 2 }, attendance: { present: 3, marked: 4, total: 5 }, quota: {}, last_activity_at: null }],
  } }));
  await page.route('**/api/accelerators/memberships/101/lifecycle-events', async (route) => route.fulfill({ json: [
    { id: 1, from_status: null, to_status: 'accepted', reason: 'Заявка одобрена', created_at: '2026-08-01T10:00:00' },
    { id: 2, from_status: 'accepted', to_status: 'enrolled', reason: 'Зачислен в поток', created_at: '2026-08-02T10:00:00' },
  ] }));
  await page.route('**/api/accelerators/cohorts/12/tracking-dashboard', async (route) => route.fulfill({ json: {
    summary: { residents: 1, green: 0, yellow: 1, red: 0, overdue_tasks: 0 },
    rows: [{ membership_id: 101, name: 'Резидент А', email: 'resident@example.test', status: 'enrolled', program: { percent: 50 }, homework: { overdue: 1 }, attendance: { present: 3, total: 5 }, open_tasks: 1, risk: { level: 'yellow', reasons: ['Нет чек-ина за текущую неделю'], overdue_homework: 1, overdue_tasks: 0, attendance_percent: 60 } }],
  } }));
  await page.route('**/api/accelerators/cohorts/12/project-audits', async (route) => route.fulfill({ json: { access_role: 'tracker', audits: [] } }));

  await page.goto('/accelerator');
  await expect(page.getByText('Роль: трекер')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toHaveText(/Мои резиденты/);
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).not.toContainText('Заявки');
  await expect(page.getByRole('heading', { name: 'Отчёт по резидентам' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Резидент А/ })).toBeVisible();
  await expect(page.getByText('Просрочено: 1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Приостановить' })).toHaveCount(0);
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.getByText('Заявка одобрена')).toBeVisible();
  await expect(page.getByText('Зачислен в поток')).toBeVisible();
  await page.getByRole('button', { name: 'Трекинг', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Трекинг прогресса' })).toBeVisible();
  await expect(page.getByText('Нужна внимательность')).toBeVisible();
  await page.getByRole('button', { name: 'Аудит проекта', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Аудит проекта' })).toBeVisible();
});

test('expert sees only own matchmaking connections', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 9, email: 'expert@example.test', name: 'Expert', is_admin: false, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [{ id: 7, name: 'Тестовый акселератор', status: 'active', access_role: 'expert' }] }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/7/cohorts', async (route) => route.fulfill({ json: [{ id: 12, accelerator_id: 7, name: 'Поток 2026', status: 'active', timezone: 'Europe/Moscow', application_form_schema: {} }] }));
  await page.route('**/api/accelerators/cohorts/12/program-config', async (route) => route.fulfill({ json: { cohort_id: 12, version: 1, modules: { applications: true, program: true, matchmaking: true, demo_day: true }, locked_modules: { applications: true, program: true } } }));
  await page.route('**/api/accelerators/cohorts/12/matchmaking/me', async (route) => route.fulfill({ json: {
    access_role: 'expert',
    profiles: [{ id: 51, cohort_id: 12, user_id: 9, role: 'expert', name: 'Expert', email: 'expert@example.test', bio: 'Эксперт по B2B', expertise: ['продажи'], needs: [], industries: ['SaaS'], goals: [], preferred_formats: ['онлайн'], max_matches: 3, active_matches: 1, active: true }],
    matches: [{ id: 71, resident: { membership_id: 101, user_id: 8, name: 'Резидент А', email: 'resident@example.test' }, counterpart: { id: 51, user_id: 9, role: 'expert', name: 'Expert', expertise: ['продажи'], needs: [], industries: ['SaaS'], goals: [], preferred_formats: ['онлайн'], max_matches: 3, active_matches: 1, active: true }, counterpart_role: 'expert', score: 90, reasons: ['Закрывает запрос: продажи'], status: 'active', created_at: new Date().toISOString() }],
  } }));
  await page.route('**/api/accelerators/cohorts/12/demo-days', async (route) => route.fulfill({ json: { access_role: 'expert', demo_days: [{ id: 91, title: 'Demo Day 2026', status: 'scoring', access_role: 'expert', criteria: [{ key: 'problem', label: 'Проблема', weight: 100, max_score: 10 }], experts: [{ id: 1, user_id: 9, name: 'Expert' }], projects: [{ id: 92, membership_id: 101, resident: { id: 8, name: 'Резидент А' }, project: { id: 5, name: 'Проект А', readiness_index: 80 }, pitch_title: 'Проект А', summary: 'Автоматизация процесса', presentation_url: 'https://example.test/pitch', attachments: [], submitted_at: new Date().toISOString(), evaluation_count: 0, evaluations: [] }] }] } }));

  await page.goto('/accelerator');
  await expect(page.getByText('Роль: эксперт')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Мои связки');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Демо-день');
  await expect(page.getByRole('heading', { name: 'Профиль для подбора' })).toBeVisible();
  await expect(page.getByText('Резидент А')).toBeVisible();
  await page.getByRole('button', { name: 'Демо-день', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ваша оценка' })).toBeVisible();
  await expect(page.getByText('Заявки')).toHaveCount(0);
});

test('participant without a project does not see project questions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() })));
  await page.route('**/api/accelerators/public/cohorts/12/application-form', async (route) => route.fulfill({ json: {
    accelerator: { id: 7, name: 'Тестовый акселератор' }, cohort: { id: 12, name: 'Поток 2026' },
    form_schema: { title: 'Заявка', required: ['motivation', 'project_name'], fields: [
      { key: 'motivation', label: 'Мотивация', type: 'textarea', required: true, application_types: ['project', 'participant'] },
      { key: 'project_name', label: 'Название проекта', required: true, application_types: ['project'] },
    ] },
  } }));
  await page.goto('/accelerators/apply/12');
  await expect(page.getByText('Название проекта')).toBeVisible();
  await page.getByLabel('Тип заявки').selectOption('participant');
  await expect(page.getByText('Название проекта')).toHaveCount(0);
  await expect(page.getByText('Мотивация')).toBeVisible();
});

test('setup wizard sends one atomic foundation request', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', async (route) => route.fulfill({ json: { id: 1, email: 'admin@example.test', name: 'Admin', is_admin: true, is_active: true, email_verified: true, created_at: new Date().toISOString() } }));
  await page.route('**/api/accelerators/me/memberships', async (route) => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/organizations', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators', async (route) => route.fulfill({ json: [] }));
  let setupPayload: Record<string, unknown> | null = null;
  await page.route('**/api/accelerators/setup', async (route) => {
    setupPayload = route.request().postDataJSON();
    await route.fulfill({ json: { accelerator: { id: 7 }, cohort: { id: 12 }, organization: { id: 3 } } });
  });
  await page.goto('/accelerator');
  await page.getByLabel('Название организации').fill('Фонд проектов');
  await page.getByLabel('Название акселератора').fill('Летний акселератор');
  await page.getByRole('button', { name: /Продолжить/ }).click();
  await page.getByLabel('Название потока').fill('Поток 2026');
  await page.getByRole('button', { name: /Продолжить/ }).click();
  await page.getByRole('button', { name: /Создать акселератор/ }).click();
  await expect.poll(() => setupPayload).not.toBeNull();
  expect(setupPayload).toMatchObject({ organization_name: 'Фонд проектов', accelerator_name: 'Летний акселератор', cohort_name: 'Поток 2026', modules: { homework: true, attendance: true, progress_tracking: true, matchmaking: true, project_audit: true, demo_day: true, pitchy_artifacts: true } });
});
