import { expect, test, type Page } from '@playwright/test';
import { eventInputToUtc, eventLocalInput, utcDate } from '../lib/acceleratorDates';

test.use({ timezoneId: 'America/Los_Angeles' });

async function auth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  });
  await page.route('**/me', r => r.fulfill({ json: { id: 1, name: 'QR test', is_admin: true, is_active: true, email_verified: true } }));
  await page.route('**/api/accelerators/me/memberships', r => r.fulfill({ json: { memberships: [], effective_quotas: {} } }));
  await page.route('**/api/accelerators/notifications**', r => r.fulfill({ json: { items: [], count: 0, unread_count: 0 } }));
}

async function manager(page: Page) {
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

test('cohort wall-clock conversions are independent of browser timezone', () => {
  expect(eventInputToUtc('2030-11-10T18:30', 'Europe/Moscow')).toBe('2030-11-10T15:30:00.000Z');
  expect(eventLocalInput('2030-11-10T15:30:00Z', 'Europe/Moscow')).toBe('2030-11-10T18:30');
  expect(eventInputToUtc('2030-11-10T18:30', 'America/New_York')).toBe('2030-11-10T23:30:00.000Z');
  expect(() => eventInputToUtc('2026-03-08T02:30', 'America/New_York')).toThrow();
  expect(utcDate('2030-11-10T15:30:00').getTime()).toBe(utcDate('2030-11-10T15:30:00Z').getTime());
});

test('check-in shows cohort time and expired/manual errors instead of success', async ({ page }) => {
  await auth(page);
  let rejected = false;
  await page.route('**/api/accelerators/attendance/check-in/**', route => route.fulfill(rejected ? { status: 409, json: { detail: 'Посещаемость уже отмечена преподавателем' } } : { json: { checked_in: true, event: { title: 'QR class', starts_at: '2030-11-10T15:30:00Z', timezone: 'Europe/Moscow' } } }));
  await page.goto('/accelerator/check-in/q1.test');
  await expect(page.getByRole('heading', { name: 'Посещение отмечено', exact: true })).toBeVisible();
  await expect(page.getByText(/18:30/)).toBeVisible();
  rejected = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Отметка не сохранена' })).toBeVisible();
  await expect(page.getByText('Посещаемость уже отмечена преподавателем', { exact: true })).toBeVisible();
});

test('organizer QR refreshes and uses one session for image and copied URL', async ({ page }) => {
  await manager(page);
  let sessions = 0;
  await page.route('**/api/accelerators/events/51/check-in-session', route => {
    sessions++;
    const url = `https://pitchy.pro/accelerator/check-in/q1.session-${sessions}`;
    return route.fulfill({ json: { checkin_url: url, expires_at: new Date(Date.now() + (sessions === 1 ? 31000 : 600000)).toISOString(), qr_svg: `<svg xmlns="http://www.w3.org/2000/svg"><text>${url}</text></svg>` } });
  });
  await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
  await expect(page.getByText(/18:30:00/)).toBeVisible();
  await page.getByRole('button', { name: 'Посещение', exact: true }).click();
  await page.getByRole('button', { name: 'QR-код и ссылка', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'QR-код и ссылка', exact: true });
  await expect.poll(() => sessions).toBeGreaterThanOrEqual(2);
  await expect(dialog.getByText('https://pitchy.pro/accelerator/check-in/q1.session-2', { exact: true })).toBeVisible();
  const image = await dialog.getByRole('img', { name: 'QR-код для отметки' }).getAttribute('src');
  expect(Buffer.from(image!.split(',')[1], 'base64').toString()).toContain('q1.session-2');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
});

test('reschedule uses cohort timezone when the browser is in Los Angeles', async ({ page }) => {
  await manager(page);
  let saved = false;
  await page.route('**/api/accelerators/events/51/reschedule', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ starts_at: '2030-11-11T15:30:00.000Z', ends_at: '2030-11-11T16:30:00.000Z' });
    saved = true; await route.fulfill({ json: { id: 51 } });
  });
  await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
  await page.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByLabel('Новое начало')).toHaveValue('2030-11-10T18:30');
  await page.getByLabel('Новое начало').fill('2030-11-11T18:30');
  await page.getByLabel('Новое окончание').fill('2030-11-11T19:30');
  await page.getByLabel('Причина', { exact: true }).fill('Перенос тестового занятия');
  await page.getByRole('button', { name: 'Сохранить перенос', exact: true }).click();
  await expect.poll(() => saved).toBe(true);
});

test('organizer fills published event logistics without changing its schedule', async ({ page }) => {
  await manager(page);
  let meetingUrl: string | null = null;
  await page.route('**/api/accelerators/cohorts/12/events', r => r.fulfill({ json: [{ id: 51, title: 'QR class', status: 'published', timezone: 'Europe/Moscow', starts_at: '2030-11-10T15:30:00Z', ends_at: '2030-11-10T16:30:00Z', event_format: 'online', meeting_url: meetingUrl, homework_links: [], post_materials: [], attendance_count: 0 }] }));
  await page.route('**/api/accelerators/events/51/details', async r => {
    const body = r.request().postDataJSON();
    expect(r.request().method()).toBe('PATCH');
    expect(body).not.toHaveProperty('starts_at');
    expect(body).not.toHaveProperty('ends_at');
    expect(body.host_name).toBe('Леонид Чернигов');
    meetingUrl = body.meeting_url;
    await r.fulfill({ json: { id: 51 } });
  });
  await page.goto('/accelerator?context=staff&section=attendance&accelerator=7&cohort=12');
  await page.getByRole('heading', { name: 'QR class', exact: true }).click();
  await expect(page.getByText('Ссылка на подключение появится позже.')).toBeVisible();
  await page.getByRole('button', { name: 'Уточнить данные', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Уточнить данные мероприятия', exact: true });
  await dialog.getByLabel('Спикер', { exact: true }).fill('Леонид Чернигов');
  await dialog.getByLabel('Ссылка на подключение', { exact: true }).fill('https://example.com/session');
  await dialog.getByRole('button', { name: 'Сохранить данные', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть подключение', exact: true })).toHaveAttribute('href', 'https://example.com/session');
});
