import { expect, test } from '@playwright/test';

for (const method of ['invitation', 'application'] as const) {
  test(`a personal project is preserved and the team project becomes primary after ${method}`, async ({ page }) => {
    let joined = false;
    let pending = false;
    let workspaceReads = 0;
    const personal = { id: 501, name: 'Личный проект', readiness_index: 40, status: 'active' };
    const shared = { id: 502, name: 'Командный проект', readiness_index: 60, status: 'active' };
    const team = () => ({ id: 601, name: 'Новая команда', status: 'active', max_members: 5,
      recruiting_open: true, project: shared, owner_membership_id: 102, can_manage: false,
      members: [{ id: 801, membership_id: 101, role: 'member', title: null, status: 'active', share_contact: false,
        person: { id: 18, name: 'Участник' } }], pending_invitations: [] });
    await page.addInitScript(() => {
      localStorage.setItem('vi_auth_state', 'cookie-session');
      localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
    });
    await page.route('**/me', route => route.fulfill({ json: { id: 18, name: 'Участник', email: null,
      is_admin: false, is_active: true, email_verified: true, created_at: '2026-10-29T10:00:00' } }));
    await page.route('**/api/accelerators', route => route.fulfill({ json: [{ id: 7, name: 'Акселератор', status: 'active', access_role: 'resident' }] }));
    await page.route('**/api/accelerators/me/memberships', route => {
      workspaceReads++;
      return route.fulfill({ json: { memberships: [{ membership_id: 101, application_id: null,
        status: 'enrolled', accepted_at: '2026-10-29T10:00:00',
        accelerator: { id: 7, name: 'Акселератор', status: 'active' },
        cohort: { id: 12, name: 'Основной поток', status: 'active', timezone: 'Europe/Moscow' },
        project: joined ? shared : personal, modules: { matchmaking: true } }], effective_quotas: {} } });
    });
    await page.route('**/api/accelerators/notifications**', route => route.fulfill({ json: { items: [], count: 0, unread_count: 0, next_cursor: null } }));
    await page.route('**/api/accelerators/memberships/101/today', route => route.fulfill({ status: 503, json: { detail: 'Нет событий' } }));
    await page.route('**/api/accelerators/memberships/101/project-recommendations', route => route.fulfill({ json: { recommendations: [], dismissed_recommendations: [] } }));
    await page.route('**/projects', route => route.fulfill({ json: joined ? [shared, personal] : [personal] }));
    await page.route('**/api/accelerators/cohorts/12/matchmaking/me', route => route.fulfill({ json: { access_role: 'resident', profiles: [], matches: [] } }));
    await page.route('**/api/accelerators/memberships/101/match-profile', route => route.fulfill({ json: null }));
    await page.route('**/api/accelerators/memberships/101/project-options', route => route.fulfill({ json: {
      project_id: joined ? 502 : 501, projects: joined ? [personal, shared] : [personal], selection_locked: joined,
      team: joined ? { id: 601, name: 'Новая команда', project_id: 502 } : null } }));
    await page.route('**/api/accelerators/memberships/101/team', route => route.fulfill({ json: {
      team: joined ? team() : null,
      invitations: !joined && method === 'invitation' ? [{ id: 901, status: 'pending', can_respond: true,
        team: { id: 601, name: 'Новая команда' }, invited_by: { name: 'Капитан' } }] : [] } }));
    await page.route('**/api/accelerators/memberships/101/team-pool', route => route.fulfill({ json: {
      teams: [{ id: 601, name: 'Новая команда', max_members: 5, member_count: 1, recruiting_open: true,
        captain: { name: 'Капитан', email: null, competencies: [] }, summary: '', details: [] }],
      candidates: [], applications: pending ? [{ id: 902, team_id: 601, team_name: 'Новая команда',
        membership_id: 101, status: 'pending', can_cancel: true, can_respond: false }] : [] } }));
    await page.route('**/api/accelerators/team-invitations/901', route => {
      expect(route.request().postDataJSON()).toEqual({ status: 'accepted' });
      joined = true;
      return route.fulfill({ json: { id: 901, status: 'accepted' } });
    });
    await page.route('**/api/accelerators/teams/601/applications', route => {
      pending = true;
      return route.fulfill({ json: { id: 902, status: 'pending' } });
    });

    await page.goto('/accelerator/my/101');
    await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/501');
    await page.getByRole('button', { name: 'Команда и поддержка', exact: true }).click();
    if (method === 'invitation') {
      await page.getByRole('button', { name: 'Принять', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Найти команду', exact: true }).click();
      await page.getByRole('button', { name: 'Подать заявку', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Заявка отправлена', exact: true })).toBeVisible();
      // The captain accepts in another session. The applicant refreshes the team.
      joined = true;
      await page.getByRole('button', { name: 'Обновить команду', exact: true }).click();
    }
    await expect.poll(() => workspaceReads).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/502');
    await expect(page.getByText('Основной проект — проект команды «Новая команда».', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Основной проект в акселераторе' })).toHaveCount(0);
    await expect(page.getByText('Личные проекты и их история сохранены и доступны отдельно на дашборде Pitchy.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/502');
  });
}
