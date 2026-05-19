/**
 * TC-J1-01: Registration UI flow
 * TC-J1-02: Login with correct / wrong credentials
 */

const { test, expect } = require('@playwright/test');
const { createUser } = require('../fixtures/api');

// Navigate from QR page to the form view by clicking the text link
async function goToAccountForm(page) {
  await page.goto('/');
  await page.waitForSelector('.dl-entries', { timeout: 10_000 });
  await page.getByText('账号密码登录').click();
  await page.waitForSelector('.fp-input', { timeout: 5_000 });
}

async function goToRegisterForm(page) {
  await page.goto('/');
  await page.waitForSelector('.dl-entries', { timeout: 10_000 });
  await page.getByText('注册').click();
  await page.waitForSelector('.fp-input', { timeout: 5_000 });
}

test.describe('Auth', () => {
  test('TC-J1-01: register new account via UI', async ({ page }) => {
    // Use an 11-digit fake phone as username (the register form uses phone field)
    const phone = `138${Date.now().toString().slice(-8)}`;
    const displayName = `u${Date.now().toString(36)}`.slice(0, 12);

    await goToRegisterForm(page);

    // fp-input fields in register tab order:
    // 0: phone (reg_phone), 1: display_name, 2: password, 3: confirm, 4: invite_code
    const inputs = page.locator('.fp-input');
    await inputs.nth(0).fill(phone);
    await inputs.nth(1).fill(displayName);
    await inputs.nth(2).fill('Test1234!');
    await inputs.nth(3).fill('Test1234!');
    await inputs.nth(4).fill('TEST_INTEGRATION');

    await page.locator('button.fp-submit').click();

    // After register the app bootstraps to the sidebar
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 12_000 });
  });

  test('TC-J1-02a: login with valid credentials', async ({ page }) => {
    const { user } = await createUser('lgn');

    await goToAccountForm(page);

    const inputs = page.locator('.fp-input');
    await inputs.nth(0).fill(user.username);
    await inputs.nth(1).fill('Test1234!');
    await page.locator('button.fp-submit').click();

    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 12_000 });
  });

  test('TC-J1-02b: login with wrong password shows error', async ({ page }) => {
    const { user } = await createUser('lgne');

    await goToAccountForm(page);

    const inputs = page.locator('.fp-input');
    await inputs.nth(0).fill(user.username);
    await inputs.nth(1).fill('WrongPass999!');
    await page.locator('button.fp-submit').click();

    // Error message should appear in the form
    await expect(page.locator('.fp-error')).toBeVisible({ timeout: 5_000 });

    // Sidebar must NOT appear
    await expect(page.locator('.sidebar')).not.toBeVisible({ timeout: 2_000 });
  });
});
