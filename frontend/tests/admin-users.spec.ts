import { expect, test, type Page } from '@playwright/test';

async function adminDashboard(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/chat/sessions', route => route.fulfill({ json: [] }));
  await page.route('**/projects?**', route => route.fulfill({ json: [] }));
  await page.route('**/me', route => route.fulfill({ json: {
    id: 1, name: 'Administrator', email: 'admin@example.com', is_admin: true, is_active: true,
    email_verified: true, onboarding_completed_at: new Date().toISOString(), created_at: new Date().toISOString(),
  } }));
  await page.route('**/me/usage', route => route.fulfill({ json: {
    tier: 'free', limits: { messages: 5, roadmaps: 1, custdev: 0, grants: 0 },
    usage: {}, remaining: {}, period_start: new Date().toISOString(),
  } }));
  await page.route('**/api/accelerators', route => route.fulfill({ json: [] }));
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [], effective_quotas: {} } }));
}

test('admin list shows imported accounts and distinguishes load failure from an empty list', async ({ page }) => {
  await adminDashboard(page);
  let unavailable = true;
  await page.route('**/admin/users', route => unavailable
    ? route.fulfill({ status: 500, json: { detail: 'internal_error' } })
    : route.fulfill({ json: [{
      id: 27, name: 'Импортированный участник', email: 'resident@example.test',
      is_admin: false, is_active: true, email_verified: false,
      subscription_tier: 'free', created_at: new Date().toISOString(),
    }, {
      id: 28, name: 'Участник без почты', email: null, username: 'mtusi-resident',
      is_admin: false, is_active: true, email_verified: false,
      subscription_tier: 'free', created_at: new Date().toISOString(),
    }] }));
  await page.goto('/dashboard?tab=admin');
  const error = page.getByRole('alert').filter({ hasText: 'Сервис временно недоступен' });
  await expect(error).toBeVisible();
  await expect(page.getByText('Нет пользователей', { exact: true })).toHaveCount(0);
  unavailable = false;
  await error.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Импортированный участник resident@example.test' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Участник без почты mtusi-resident' })).toBeVisible();
  await expect(error).toHaveCount(0);
});
