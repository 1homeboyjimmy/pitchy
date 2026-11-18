import passportConfig from './fixtures/passport-fields.json';
import { expect, test, type Page } from '@playwright/test';

async function resident(page: Page, loggedIn = true, hasLinkedProject = true) {
  await page.addInitScript((hasSession) => {
    if (hasSession) localStorage.setItem('vi_auth_state', 'cookie-session');
    localStorage.setItem('pitchy_cookie_consent_v2', JSON.stringify({ choice: 'necessary', updatedAt: new Date().toISOString() }));
  }, loggedIn);
  let selected: number | null = hasLinkedProject ? 501 : null;
  const projects = [{ id: 501, name: 'Первая идея' }, ...(hasLinkedProject ? [{ id: 502, name: 'Вторая идея' }] : [])];
  const membership = () => ({
    membership_id: 101, application_id: null, status: 'enrolled', accepted_at: '2026-10-13T10:00:00', enrolled_at: '2026-10-13T10:00:00',
    accelerator: { id: 7, name: 'МТУСИ 2026', status: 'active' },
    cohort: { id: 12, name: 'МТУСИ 2026', status: 'active', timezone: 'Europe/Moscow' },
    project: selected === null ? null : { id: selected, name: selected === 501 ? 'Первая идея' : 'Вторая идея', readiness_index: 35, status: 'active', can_edit_passport: true,
      description: selected === 501 ? 'Описание первой идеи.' : 'Описание второй идеи.' },
    participant_profile: { institute: "МТУСИ" },
    modules: {},
  });
  await page.route('**/api/accelerators', route => route.fulfill({ json: [{ id: 7, name: 'МТУСИ 2026', status: 'active', access_role: 'resident' }] }));
  await page.route('**/me', route => route.fulfill({ json: { id: 18, email: null, username: 'sample_user', name: '@sample_user', is_admin: false, is_active: true, email_verified: false, created_at: '2026-10-13T10:00:00' } }));
  await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [membership()], effective_quotas: {} } }));
  await page.route('**/api/accelerators/memberships/101/project-options', route => route.fulfill({ json: { project_id: selected, projects } }));
  await page.route('**/api/accelerators/memberships/101/project', route => { selected = route.request().postDataJSON().project_id; return route.fulfill({ json: { membership_id: 101, project_id: selected } }); });
  await page.route('**/api/accelerators/notifications**', route => route.fulfill({ json: { items: [], unread_count: 0, next_cursor: null } }));
  await page.route('**/api/accelerators/memberships/101/today', route => route.fulfill({ status: 503, json: { detail: 'Нет событий' } }));
  await page.route('**/api/accelerators/memberships/101/project-recommendations', route => route.fulfill({ json: { recommendations: [], dismissed_recommendations: [] } }));
}

test('login accepts a Telegram username without browser email validation', async ({ page }) => {
  await resident(page, false);
  let submitted: Record<string, string> | undefined;
  await page.route('**/auth/login', route => { submitted = route.request().postDataJSON(); return route.fulfill({ json: { access_token: 'test-cookie-session' } }); });
  await page.goto('/login?next=/accelerator/my/101');
  await page.getByLabel('Логин', { exact: true }).fill('@Sample_user');
  await page.locator('#password').fill('Password123!');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/accelerator\/my\/101(?:[?#]|$)/);
  await expect.poll(() => submitted).toEqual({ email: '@Sample_user', password: 'Password123!' });
});

test('enrolled resident sees a project description and can select another idea', async ({ page }) => {
  await resident(page);
  await page.goto('/accelerator/my/101');
  await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
  await expect(page.getByText('Описание первой идеи.', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Основной проект в акселераторе' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/501');
  await expect(page.getByText('Подтвердить участие', { exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Основной проект в акселераторе' }).selectOption('502');
  await page.getByRole('button', { name: 'Выбрать проект', exact: true }).click();
  await expect(page.getByText('Описание второй идеи.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/502');
  await page.screenshot({ path: '../private_imports/mtusi-2026/resident-project-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Описание второй идеи.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '../private_imports/mtusi-2026/resident-project-mobile.png', fullPage: true });
});

test('resident can link their only Pitchy project to an existing enrollment', async ({ page }) => {
  await resident(page, true, false);
  await page.goto('/accelerator/my/101');
  await page.getByRole('button', { name: 'Мой профиль', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Основной проект в акселераторе' })).toHaveValue('501');
  await page.getByRole('button', { name: 'Выбрать проект', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Открыть паспорт', exact: true })).toHaveAttribute('href', '/passport/501');
});

test('resident sees a confirmation after saving their profile', async ({ page }) => {
  await resident(page);
  await page.route('**/api/accelerators/memberships/101/participant-profile', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ institute: 'РТУ МИРЭА' });
    await route.fulfill({ json: { profile: { institute: 'РТУ МИРЭА' } } });
  });

  await page.goto('/accelerator/my/101');
  await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
  await expect(page.getByLabel('Университет')).toHaveValue('МТУСИ');
  await page.getByLabel('Университет').fill('РТУ МИРЭА');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Профиль участника сохранён', { exact: true })).toBeVisible();
});

test('resident fills every passport field, saves and reopens persisted values', async ({ page }) => {
  await resident(page);
  const config = passportConfig;
  let failSave = true;
  let saved: Record<string, unknown> = {};
  let passport: Record<string, unknown> = {};
  await page.route('**/projects/501/passport', route => {
    if (route.request().method() === 'PATCH') {
      if (failSave) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      saved = route.request().postDataJSON().fields;
      passport = {};
      for (const [path, value] of Object.entries(saved)) {
        const [group, field] = path.split('.');
        if (field) passport[group] ||= {};
        if (field) (passport[group] as Record<string, unknown>)[field] = value;
        else passport[group] = value;
      }
    }
    return route.fulfill({ json: { can_edit: true, team_managed: false, passport, readiness_index: Object.keys(saved).length ? 100 : 0, missing_sections: [], readiness_config: config } });
  });
  await page.goto('/accelerator/my/101');
  await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
  await page.getByRole('button', { name: 'Заполнить паспорт', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Паспорт · Первая идея' });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const field of config.fields) {
    await editor.locator(`[id="passport-501-${field.path}"]`).fill(field.list ? 'Первый пункт\nВторой пункт' : `Данные: ${field.label}`);
  }
  await page.screenshot({ path: '../output/fixes/passport.png', fullPage: true });
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  failSave = false;
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(Object.keys(saved).length).toBe(config.fields.length);
  for (const field of config.fields) expect(saved[field.path]).toEqual(field.list ? ['Первый пункт', 'Второй пункт'] : `Данные: ${field.label}`);
  await page.getByRole('button', { name: 'Заполнить паспорт', exact: true }).click();
  for (const field of config.fields) await expect(editor.locator(`[id="passport-501-${field.path}"]`)).toHaveValue(field.list ? 'Первый пункт\nВторой пункт' : `Данные: ${field.label}`);
});

test('resident browser and site Back restore the previous view and close passport', async ({ page }) => {
  await resident(page);
  await page.route('**/projects/501/passport', r => r.fulfill({ json: { can_edit: true, team_managed: false, passport: {}, readiness_index: 0, missing_sections: [], readiness_config: passportConfig } }));
  await page.goto('/accelerator/my/101');
  await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
  await page.getByRole('button', { name: 'Заполнить паспорт', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Паспорт · Первая идея' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Описание первой идеи.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← Назад', exact: true }).click();
  await expect(page.getByText('Описание первой идеи.', { exact: true })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByText('Описание первой идеи.', { exact: true })).toBeVisible();
});

for (const canEdit of [true, false]) {
  for (const theme of ['light', 'dark']) {
    test(`passport uses automatic roster with ${canEdit ? 'owner editing' : 'member viewing'} in ${theme}`, async ({ page }) => {
      await resident(page);
      await page.addInitScript(value => localStorage.setItem('pitchy_accelerator_theme', value), theme);
      await page.route('**/api/accelerators/me/memberships', route => route.fulfill({ json: { memberships: [{
        membership_id: 101, status: 'enrolled', accelerator: { id: 7, name: 'Тест', status: 'active' },
        cohort: { id: 12, name: 'Тест', status: 'active' }, modules: {},
        project: { id: 501, name: 'Первая идея', status: 'active', readiness_index: 35, can_edit_passport: canEdit },
      }], effective_quotas: {} } }));
      let patches = 0;
      await page.route('**/projects/501/passport', route => {
        if (route.request().method() === 'PATCH') patches++;
        return route.fulfill({ json: { can_edit: canEdit, team_managed: true, passport: {
          core: { name: 'Первая идея' }, team: ['Анна — Руководитель команды', 'Борис — Участник команды'],
        }, readiness_index: 35, missing_sections: [], readiness_config: passportConfig } });
      });
      await page.goto('/accelerator/my/101');
      await page.getByRole('button', { name: 'Мой проект', exact: true }).click();
      await page.getByRole('button', { name: canEdit ? 'Заполнить паспорт' : 'Посмотреть паспорт', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('region', { name: 'Состав команды' })).toContainText('Анна — Руководитель команды');
      await expect(dialog.getByRole('region', { name: 'Состав команды' })).toContainText('Борис — Участник команды');
      for (const path of ['team', 'metrics.mrr', 'legal.entity_type']) {
        await expect(dialog.locator(`[id="passport-501-${path}"]`)).toHaveCount(0);
      }
      await page.screenshot({ path: `../output/passport-${canEdit ? 'owner' : 'member'}-${theme}.png`, fullPage: true });
      const name = dialog.getByLabel('Название', { exact: true });
      if (canEdit) {
        await expect(name).toBeEnabled();
        await name.fill('Новое название');
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
        expect(patches).toBe(1);
      } else {
        await expect(name).toBeDisabled();
        await expect(dialog.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Мастер заполнения' })).toHaveCount(0);
        expect(patches).toBe(0);
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
      }
    });
  }
}
