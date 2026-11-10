import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() })));
  await page.route('**/me', route => route.fulfill({ json: { id: 101, name: 'Участник', is_active: true, email_verified: true } }));
});

test('invitation link sets password without exposing token in URL', async ({ page }) => {
  await page.route('**/auth/set-invitation-password', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'student@example.test', token: 'a'.repeat(43), new_password: 'NewPassword12!' });
    await route.fulfill({ json: { status: 'ok' } });
  });
  await page.goto('/set-password#email=student%40example.test&token=' + 'a'.repeat(43));
  await expect(page.getByText('student@example.test')).toBeVisible();
  await expect(page).toHaveURL(/\/set-password$/);
  await page.screenshot({ path: test.info().outputPath('set-password.png'), fullPage: true });
  await page.getByLabel('Новый пароль', { exact: true }).fill('NewPassword12!');
  await page.getByLabel('Повторите пароль', { exact: true }).fill('NewPassword12!');
  await page.getByRole('button', { name: 'Установить пароль', exact: true }).click();
  await expect(page.getByText('Пароль установлен.', { exact: false })).toBeVisible();
});

test('first login requires employment and preserves imported study fields', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('vi_auth_state', 'cookie-session'));
  let complete = false;
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [{ membership_id: 101, registration_required: !complete, participant_profile: { study_group: 'ИВБО-20-25', education_direction: 'БАК', education_course: 'БАК-2' }, cohort: { name: 'Преакселератор РТУ МИРЭА 2026' } }] } }));
  await page.route('**/api/accelerators/memberships/101/participant-profile', async route => {
    expect(route.request().postDataJSON()).toEqual({ study_group: 'ИВБО-20-25', education_direction: 'БАК', education_course: 'БАК-2', employment: 'not_working' });
    complete = true; await route.fulfill({ json: { status: 'ok' } });
  });
  await page.goto('/terms');
  const gate = page.getByRole('dialog', { name: 'Завершение регистрации' });
  await expect(gate).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('participant-registration.png'), fullPage: true });
  await expect(gate.getByLabel('Учебная группа')).toHaveValue('ИВБО-20-25');
  await gate.getByRole('button', { name: 'Сохранить', exact: true }).click();
  expect(complete).toBe(false);
  await gate.getByLabel('Занятость').selectOption('not_working');
  await gate.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(gate).toHaveCount(0);
});
