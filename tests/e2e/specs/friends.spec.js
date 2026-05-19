/**
 * TC-J1-03: Friend request UI flow (via "ID添加好友")
 * TC-J3-01: Delete friend
 * TC-J3-02: Block friend — blocks server-side delivery
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends } = require('../fixtures/api');
const { loginPage, openConv } = require('../fixtures/session');

test.describe('Friends', () => {
  test('TC-J1-03: A sends friend request via UI, B accepts', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { token: tA, user: uA } = await createUser('fra');
    const { token: tB, user: uB } = await createUser('frb');

    await Promise.all([
      loginPage(pageA, tA, uA),
      loginPage(pageB, tB, uB),
    ]);

    // A: go to contacts → click "+" → ID添加好友 → search by user_code → add
    await pageA.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    await pageA.locator('.new-group-btn').click();                           // "+" add-friend button
    await pageA.locator('.modal-overlay').waitFor({ timeout: 5_000 });
    await pageA.locator('.add-choose-btn').first().click();                  // "ID添加好友"
    await pageA.locator('.modal-input').first().fill(uB.user_code);
    await pageA.locator('.btn-modal-confirm').click();                       // 搜索

    // Result should show B's name
    await expect(pageA.locator('.add-result-name')).toBeVisible({ timeout: 5_000 });
    await pageA.locator('.btn-add-inline').click();                          // 添加
    await expect(pageA.locator('.add-msg-inline.ok')).toBeVisible({ timeout: 5_000 });
    // Close the modal
    await pageA.locator('.modal-close').click();

    // B: go to contacts → 新的好友 → accept
    await pageB.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    const reqEntry = pageB.locator('.friend-req-entry');
    await reqEntry.waitFor({ timeout: 5_000 });
    await reqEntry.click();
    const acceptBtn = pageB.getByRole('button', { name: '接受' }).first();
    await acceptBtn.waitFor({ timeout: 8_000 });
    await acceptBtn.click();

    // A should now see B in contacts list
    await pageA.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    await expect(
      pageA.locator('.contact-item').filter({ hasText: uB.display_name })
    ).toBeVisible({ timeout: 8_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J3-01: delete friend removes from contact list', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();

    const { token: tA, user: uA } = await createUser('dela');
    const { token: tB, user: uB } = await createUser('delb');
    await makeFriends(tA, uA, tB, uB);
    await loginPage(pageA, tA, uA);

    // Navigate to contacts and select B
    await pageA.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    await pageA.locator('.contact-item').filter({ hasText: uB.display_name }).first().click();

    // Click 删除好友 in detail panel
    await pageA.locator('.btn-delete-friend').click();

    // Confirm dialog
    await pageA.locator('.confirm-btn-ok').click();

    // Contact should be gone
    await expect(
      pageA.locator('.contact-item').filter({ hasText: uB.display_name })
    ).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close();
  });

  test('TC-J3-02: block friend — blocked user messages are silently dropped', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { token: tA, user: uA } = await createUser('blka');
    const { token: tB, user: uB } = await createUser('blkb');
    await makeFriends(tA, uA, tB, uB);

    await Promise.all([
      loginPage(pageA, tA, uA),
      loginPage(pageB, tB, uB),
    ]);

    // B blocks A via contact detail
    await pageB.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
    await pageB.locator('.contact-item').filter({ hasText: uA.display_name }).first().click();
    await pageB.locator('.btn-block').click();                       // 拉黑
    await pageB.locator('.confirm-btn-ok').click();                  // confirm

    // Small pause for server to register the block
    await pageB.waitForTimeout(500);

    // A sends a message to B (should be silently dropped by server)
    await openConv(pageA, uB.display_name);
    const blockedMsg = `blocked-${Date.now()}`;
    await pageA.locator('textarea').first().fill(blockedMsg);
    await pageA.locator('textarea').first().press('Enter');

    // Wait for potential delivery
    await pageB.waitForTimeout(3_000);

    // B should NOT see the message
    await openConv(pageB, uA.display_name);
    await expect(
      pageB.locator('.msg-bubble').filter({ hasText: blockedMsg })
    ).not.toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
