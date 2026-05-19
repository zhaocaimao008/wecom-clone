/**
 * Voice mode UI E2E tests
 * (No actual audio recording — tests UI state only)
 *
 * TC-V1-01 (P1): Voice mode toggle — mic button switches input between textarea and hold-talk
 * TC-V1-02 (P1): Voice mode button is disabled for muted group member
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends, createGroup, setMuteAll } = require('../fixtures/api');
const { loginPage, openConv } = require('../fixtures/session');

async function openGroupConv(page, groupName) {
  await page.locator('.nav-btn').filter({ hasText: '消息' }).first().click();
  const convItem = page.locator('.conv-item').filter({ hasText: groupName }).first();
  if (await convItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await convItem.click();
  } else {
    await page.locator('.nav-btn').filter({ hasText: '群组' }).first().click();
    const grpItem = page.locator('.contact-item').filter({ hasText: groupName }).first();
    await grpItem.waitFor({ timeout: 8_000 });
    await grpItem.click();
    await page.locator('.btn-chat').first().click();
  }
  await page.locator('.chat-header').filter({ hasText: groupName }).first()
    .waitFor({ timeout: 8_000 });
}

/** The voice/keyboard toggle button is the first .wx-ic-btn in .wx-input-row */
const voiceToggleBtn = (page) => page.locator('.wx-input-row .wx-ic-btn').first();

test.describe('Voice mode', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-V1-01: voice mode toggle switches between textarea and hold-talk button (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('vm1a');
    const { token: tB, user: uB } = await createUser('vm1b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await loginPage(pageA, tA, uA);
    await openConv(pageA, uB.display_name);

    // Initial state: textarea visible, hold-talk hidden
    await expect(pageA.locator('textarea').first()).toBeVisible();
    await expect(pageA.locator('.wx-hold-talk')).not.toBeVisible();

    // Click voice toggle → voice mode ON
    await voiceToggleBtn(pageA).click();
    await expect(pageA.locator('.wx-hold-talk')).toBeVisible({ timeout: 3_000 });
    await expect(pageA.locator('textarea')).not.toBeVisible();

    // Click again → voice mode OFF (back to textarea)
    await voiceToggleBtn(pageA).click();
    await expect(pageA.locator('textarea').first()).toBeVisible({ timeout: 3_000 });
    await expect(pageA.locator('.wx-hold-talk')).not.toBeVisible();

    await ctxA.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-V1-02: voice mode toggle is disabled for muted group member (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('vm2a');
    const { token: tB, user: uB } = await createUser('vm2b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `vm2-grp-${Date.now().toString(36)}`, [uB.id]);
    await setMuteAll(tA, grp.id, true);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);
    await openGroupConv(pageB, grp.name);

    // Muted member: both textarea and voice toggle button are disabled
    await expect(pageB.locator('textarea').first()).toBeDisabled({ timeout: 5_000 });
    await expect(voiceToggleBtn(pageB)).toBeDisabled({ timeout: 3_000 });

    await ctxB.close();
  });
});
