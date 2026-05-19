/**
 * TC-J5-01: Blocked user — messages silently dropped (P0 regression test)
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends } = require('../fixtures/api');
const { loginPage, openConv } = require('../fixtures/session');

test.describe('Permissions', () => {
  test('TC-J5-01: blocked sender messages are silently dropped', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { token: tA, user: uA } = await createUser('blk1a');
    const { token: tB, user: uB } = await createUser('blk1b');
    await makeFriends(tA, uA, tB, uB);

    await Promise.all([
      loginPage(pageA, tA, uA),
      loginPage(pageB, tB, uB),
    ]);

    // First, verify messaging works before block
    await openConv(pageA, uB.display_name);
    const preMsg = `pre-block-${Date.now()}`;
    await pageA.locator('textarea').first().fill(preMsg);
    await pageA.locator('textarea').first().press('Enter');

    await openConv(pageB, uA.display_name);
    await pageB.locator('.msg-bubble').filter({ hasText: preMsg }).first()
      .waitFor({ timeout: 8_000 });

    // B blocks A via contact detail
    await pageB.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    await pageB.locator('.contact-item').filter({ hasText: uA.display_name }).first().click();
    await pageB.getByRole('button', { name: /拉黑|屏蔽/ }).first().click();
    const confirmBtn = pageB.getByRole('button', { name: /确认|确定/ }).last();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    // Small pause to let server update
    await pageB.waitForTimeout(500);

    // A sends another message (should be silently dropped)
    await openConv(pageA, uB.display_name);
    const blockedMsg = `blocked-${Date.now()}`;
    await pageA.locator('textarea').first().fill(blockedMsg);
    await pageA.locator('textarea').first().press('Enter');

    // A's own message still appears in A's view (sender sees it optimistically or not — either way verify B doesn't)
    // Wait 3s to confirm delivery has had time to arrive or not
    await pageB.waitForTimeout(3_000);

    // Navigate B back to the chat
    await openConv(pageB, uA.display_name);
    await expect(
      pageB.locator('.msg-bubble').filter({ hasText: blockedMsg })
    ).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
