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
  await page.route('**/api/accelerators/cohorts/12/program-config', async (route) => route.fulfill({ json: { cohort_id: 12, version: 1, modules: { applications: true, program: true, homework: true, attendance: false }, locked_modules: { applications: true, program: true } } }));
  await page.route('**/api/accelerators/cohorts/12/applications', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/residents', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/cohorts/12/program-stages', async (route) => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/7/organizers', async (route) => route.fulfill({ json: [] }));
}

test('manager workspace is split into focused sections', async ({ page }) => {
  await mockManagerWorkspace(page);
  await page.goto('/accelerator');
  await expect(page.getByRole('heading', { name: 'Поток 2026' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Заявки');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).toContainText('Домашние задания');
  await expect(page.getByRole('navigation', { name: 'Разделы акселератора' })).not.toContainText('Посещаемость');
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Конструктор функций' })).toBeVisible();
  await expect(page.getByText('Матчмейкинг')).toHaveCount(0);
  await expect(page.getByText('Демо-день')).toHaveCount(0);
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
  expect(setupPayload).toMatchObject({ organization_name: 'Фонд проектов', accelerator_name: 'Летний акселератор', cohort_name: 'Поток 2026', modules: { homework: true, attendance: true } });
});
