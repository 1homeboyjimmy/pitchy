import type { Page } from '@playwright/test';
export async function auth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', r => r.fulfill({ json: { id: 1, name: 'QR test', is_admin: true, is_active: true, email_verified: true } }));
  await page.route('**/api/accelerators/me/memberships', r => r.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/notifications**', r => r.fulfill({ json: { items: [], count: 0, unread_count: 0 } }));
}

export async function manager(page: Page) {
  await auth(page);
  await page.route('**/api/accelerators', r => r.fulfill({ json: [{ id: 7, name: 'QR test', status: 'active', access_role: 'global_admin' }] }));
  await page.route('**/api/accelerators/7/cohorts', r => r.fulfill({ json: [{ id: 12, accelerator_id: 7, name: 'Moscow cohort', timezone: 'Europe/Moscow', status: 'active' }] }));
  await page.route('**/api/accelerators/cohorts/12/**', route => {
    const endpoint = new URL(route.request().url()).pathname.split('/').pop();
    if (endpoint === 'program-config') return route.fulfill({ json: { version: 1, modules: { attendance: true, program: true }, locked_modules: {} } });
    if (endpoint === 'events') return route.fulfill({ json: [{ id: 51, title: 'QR class', status: 'published', timezone: 'Europe/Moscow', starts_at: '2030-11-10T15:30:00Z', ends_at: '2030-11-10T16:30:00Z', event_format: 'offline', location: 'Room', homework_links: [], post_materials: [], attendance_count: 0 }] });
    return route.fulfill({ json: [] });
  });
  await page.route('**/api/accelerators/events/51/attendance', r => r.fulfill({ json: [] }));
}
