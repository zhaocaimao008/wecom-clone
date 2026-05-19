/**
 * Group management E2E tests
 *
 * TC-G2-01 (P1): Group message read receipt — owner sees "已读 N" after member reads
 * TC-G2-02 (P1): Read receipts popup — click "已读 1" shows reader's name
 * TC-G2-03 (P1): Group rename — owner renames via API, chat header updates for both
 * TC-G2-04 (P1): Admin promotion — promoted admin can kick a regular member
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends, createGroup, setMemberRole, renameGroup, kickMember } = require('../fixtures/api');
const { loginPage, sendText, waitForMessage } = require('../fixtures/session');

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

test.describe('Group management', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G2-01: group read receipt — owner sees "已读 1" after member reads (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('grd1a');
    const { token: tB, user: uB } = await createUser('grd1b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `rr-grp-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // A (owner) sends a message in the group
    await openGroupConv(pageA, grp.name);
    const msg = `grp-rr-${Date.now()}`;
    await sendText(pageA, msg);
    await waitForMessage(pageA, msg);

    // B opens group (mark_read fires for A's message)
    await openGroupConv(pageB, grp.name);
    await waitForMessage(pageB, msg);

    // A (owner) should see "已读 1" on the message
    const readBadge = pageA.locator('.msg-bubble')
      .filter({ hasText: msg })
      .locator('..') // .msg-content → .msg-time
      .locator('.msg-read-group')
      .first();
    await expect(readBadge).toBeVisible({ timeout: 8_000 });
    await expect(readBadge).toContainText('已读');

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G2-02: read receipts popup — click "已读 1" shows reader\'s display name (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('grd2a');
    const { token: tB, user: uB } = await createUser('grd2b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `rr2-grp-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openGroupConv(pageA, grp.name);
    const msg = `grp-rr2-${Date.now()}`;
    await sendText(pageA, msg);
    await waitForMessage(pageA, msg);

    await openGroupConv(pageB, grp.name);
    await waitForMessage(pageB, msg);

    // Wait for "已读 1" badge on A's side
    const readBadge = pageA.locator('.msg-bubble')
      .filter({ hasText: msg })
      .locator('..')
      .locator('.msg-read-group')
      .first();
    await expect(readBadge).toBeVisible({ timeout: 8_000 });

    // Click to open popup
    await readBadge.click();
    const popup = pageA.locator('.receipts-popup');
    await expect(popup).toBeVisible({ timeout: 5_000 });

    // Popup lists B as a reader
    await expect(popup.locator('.receipts-name').filter({ hasText: uB.display_name }))
      .toBeVisible({ timeout: 5_000 });

    // Close popup via the ✕ button (overlay has stopPropagation on the inner popup)
    await popup.locator('.receipts-header button').click();
    await expect(popup).not.toBeVisible({ timeout: 3_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G2-03: group rename — chat header updates in real time (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('grn3a');
    const { token: tB, user: uB } = await createUser('grn3b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `ren-grp-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // Both open the group
    await openGroupConv(pageA, grp.name);
    await openGroupConv(pageB, grp.name);

    // A renames the group via API
    const newName = `renamed-${Date.now().toString(36)}`;
    await renameGroup(tA, grp.id, newName);

    // Both sides should reflect new name in the chat header
    await expect(pageA.locator('.chat-header .chat-name'))
      .toHaveText(newName, { timeout: 8_000 });
    await expect(pageB.locator('.chat-header .chat-name'))
      .toHaveText(newName, { timeout: 8_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G2-04: admin promotion — admin can kick regular member (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gad4a');
    const { token: tB, user: uB } = await createUser('gad4b');
    const { token: tC, user: uC } = await createUser('gad4c');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tA, uA, tC, uC);
    const grp = await createGroup(tA, `adm-grp-${Date.now().toString(36)}`, [uB.id, uC.id]);

    const ctxC = await browser.newContext();
    const pageC = await ctxC.newPage();
    await loginPage(pageC, tC, uC);

    // C opens the group to be active in it
    await openGroupConv(pageC, grp.name);

    // Owner A promotes B to admin
    await setMemberRole(tA, grp.id, uB.id, 'admin');

    // Admin B kicks C
    await kickMember(tB, grp.id, uC.id);

    // C receives "已退出群聊" toast
    await expect(
      pageC.locator('.toast-item, .toast').filter({ hasText: '已退出群聊' }).first()
    ).toBeVisible({ timeout: 8_000 });

    // C's group view should close (activeConv cleared)
    await expect(pageC.locator('.chat-header').filter({ hasText: grp.name }))
      .not.toBeVisible({ timeout: 5_000 });

    await ctxC.close();
  });
});
