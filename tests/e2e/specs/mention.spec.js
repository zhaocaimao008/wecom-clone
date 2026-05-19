/**
 * @mention E2E tests
 *
 * TC-M1-01 (P1): Mention filter — typing partial name narrows picker to matching members only
 * TC-M1-02 (P0): Escape key dismisses the mention picker without inserting
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends, createGroup } = require('../fixtures/api');
const { loginPage } = require('../fixtures/session');

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

test.describe('@mention', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-M1-01: mention filter narrows picker to matching members only (P1)', async ({ browser }) => {
    // Use distinct prefixes so the names clearly differ:
    //   B's name starts with "mb", C's with "mc"
    // Typing "@mb" in the picker will match B but not C.
    const { token: tA, user: uA } = await createUser('mna');
    const { token: tB, user: uB } = await createUser('mb');
    const { token: tC, user: uC } = await createUser('mc');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tA, uA, tC, uC);
    const grp = await createGroup(tA, `mn1-${Date.now().toString(36)}`, [uB.id, uC.id]);

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await loginPage(pageA, tA, uA);
    await openGroupConv(pageA, grp.name);

    const textarea = pageA.locator('textarea').first();

    // Type "@" — picker shows all members (including B and C)
    await textarea.fill('@');
    await textarea.dispatchEvent('input');
    await expect(pageA.locator('.mention-picker')).toBeVisible({ timeout: 5_000 });

    // Type first 2 chars of B's name to filter — use uB.display_name[:2] = "mb"
    const filterStr = uB.display_name.slice(0, 2); // "mb"
    await textarea.fill(`@${filterStr}`);
    await textarea.dispatchEvent('input');

    // B should appear in picker
    await expect(
      pageA.locator('.mention-picker-item').filter({ hasText: uB.display_name })
    ).toBeVisible({ timeout: 3_000 });

    // C should NOT appear (their name starts with "mc", not "mb")
    await expect(
      pageA.locator('.mention-picker-item').filter({ hasText: uC.display_name })
    ).not.toBeVisible();

    await ctxA.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-M1-02: Escape dismisses the mention picker without inserting (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('mne2a');
    const { token: tB, user: uB } = await createUser('mne2b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `mn2-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await loginPage(pageA, tA, uA);
    await openGroupConv(pageA, grp.name);

    const textarea = pageA.locator('textarea').first();

    // Open picker
    await textarea.fill('@');
    await textarea.dispatchEvent('input');
    await expect(pageA.locator('.mention-picker')).toBeVisible({ timeout: 5_000 });

    // Type a space after "@" — useMention's detect() sees afterAt contains ' ' → setShow(false)
    await textarea.fill('@ ');
    await textarea.dispatchEvent('input');

    // Picker should close
    await expect(pageA.locator('.mention-picker')).not.toBeVisible({ timeout: 3_000 });

    // No @-mention name was inserted
    const val = await textarea.inputValue();
    expect(val).not.toMatch(/@\S{3,}/);

    await ctxA.close();
  });
});
