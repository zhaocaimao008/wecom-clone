/**
 * Group chat E2E tests
 *
 * TC-G1-01 (P1): Create group via UI — group appears in both members' groups panel
 * TC-G1-02 (P0): Group message visible to all members in real time
 * TC-G1-03 (P1): @mention — picker appears, message delivered
 * TC-G1-04 (P0): mute_all → textarea disabled for member (client-side prevention)
 * TC-G1-05 (P1): mute_all → owner textarea NOT disabled, message goes through
 * TC-G1-06 (P1): Quit group — group no longer in groups panel
 * TC-G1-07 (P1): Kicked member no longer receives messages
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends, createGroup, setMuteAll, kickMember } = require('../fixtures/api');
const { loginPage, sendText, waitForMessage } = require('../fixtures/session');

// Open group conversation — tries conv list first (has messages), then groups panel fallback.
// Waits for the chat header to confirm the window is ready.
async function openGroupConv(page, groupName) {
  await page.locator('.nav-btn').filter({ hasText: '消息' }).first().click();
  const convItem = page.locator('.conv-item').filter({ hasText: groupName }).first();
  if (await convItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await convItem.click();
  } else {
    // Fallback: groups tab → contact-item → 发消息 button
    await page.locator('.nav-btn').filter({ hasText: '群组' }).first().click();
    const grpItem = page.locator('.contact-item').filter({ hasText: groupName }).first();
    await grpItem.waitFor({ timeout: 8_000 });
    await grpItem.click();
    await page.locator('.btn-chat').first().click();
  }
  // Wait for chat header to show the group name — confirms ChatWindow is ready
  await page.locator('.chat-header').filter({ hasText: groupName }).first()
    .waitFor({ timeout: 8_000 });
}

test.describe('Group chat', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-01: create group via UI — group appears in both members\' groups panel (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gca');
    const { token: tB, user: uB } = await createUser('gcb');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // A opens the "发起群聊" modal from the conv panel
    await pageA.locator('.nav-btn').filter({ hasText: '消息' }).first().click();
    await pageA.locator('.new-group-btn').click();
    await pageA.locator('.modal-overlay').waitFor({ timeout: 5_000 });

    const groupName = `群-${Date.now().toString(36)}`;
    await pageA.locator('.modal-input').first().fill(groupName);
    const bLabel = pageA.locator('.modal-member-item').filter({ hasText: uB.display_name }).first();
    await bLabel.click();
    await pageA.locator('.btn-modal-confirm').click();

    // A should see the group in the groups panel
    await pageA.locator('.nav-btn').filter({ hasText: '群组' }).first().click();
    await expect(
      pageA.locator('.contact-item').filter({ hasText: groupName })
    ).toBeVisible({ timeout: 8_000 });

    // B should also receive group_created and see it in groups panel
    await pageB.locator('.nav-btn').filter({ hasText: '群组' }).first().click();
    await expect(
      pageB.locator('.contact-item').filter({ hasText: groupName })
    ).toBeVisible({ timeout: 8_000 });

    await ctxA.close();
    await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-02: group message real time — all members receive (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gm2a');
    const { token: tB, user: uB } = await createUser('gm2b');
    const { token: tC, user: uC } = await createUser('gm2c');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tA, uA, tC, uC);
    const grp = await createGroup(tA, `grp2-${Date.now().toString(36)}`, [uB.id, uC.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const [pageA, pageB, pageC] = await Promise.all([ctxA.newPage(), ctxB.newPage(), ctxC.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB), loginPage(pageC, tC, uC)]);

    await openGroupConv(pageA, grp.name);
    const msg = `grp-msg-${Date.now()}`;
    await sendText(pageA, msg);

    await openGroupConv(pageB, grp.name);
    await waitForMessage(pageB, msg);

    await openGroupConv(pageC, grp.name);
    await waitForMessage(pageC, msg);

    await ctxA.close(); await ctxB.close(); await ctxC.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-03: @mention — picker appears, message with @name delivered (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gmt3a');
    const { token: tB, user: uB } = await createUser('gmt3b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `grp3-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openGroupConv(pageA, grp.name);
    const textarea = pageA.locator('textarea').first();

    // Type "@" to trigger the mention picker
    await textarea.fill('@');
    await textarea.dispatchEvent('input');

    await expect(pageA.locator('.mention-picker')).toBeVisible({ timeout: 5_000 });

    // B should be listed
    const bItem = pageA.locator('.mention-picker-item').filter({ hasText: uB.display_name }).first();
    await expect(bItem).toBeVisible({ timeout: 3_000 });
    await bItem.click();

    // Picker should close and input should contain @<B>
    await expect(pageA.locator('.mention-picker')).not.toBeVisible({ timeout: 3_000 });
    const val = await textarea.inputValue();
    expect(val).toContain(`@${uB.display_name}`);

    await textarea.press('Enter');
    const mentionText = `@${uB.display_name}`;

    await waitForMessage(pageA, mentionText);
    await openGroupConv(pageB, grp.name);
    await waitForMessage(pageB, mentionText);

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-04: mute_all — member textarea is disabled, shows "已被禁言" (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gmut4a');
    const { token: tB, user: uB } = await createUser('gmut4b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `grp4-${Date.now().toString(36)}`, [uB.id]);
    await setMuteAll(tA, grp.id, true);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);

    await openGroupConv(pageB, grp.name);

    // Textarea should be disabled with "已被禁言" placeholder
    const textarea = pageB.locator('textarea').first();
    await expect(textarea).toBeDisabled({ timeout: 5_000 });
    await expect(textarea).toHaveAttribute('placeholder', '已被禁言');

    await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-05: mute_all — owner textarea NOT disabled, message goes through (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gmut5a');
    const { token: tB, user: uB } = await createUser('gmut5b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `grp5-${Date.now().toString(36)}`, [uB.id]);
    await setMuteAll(tA, grp.id, true);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openGroupConv(pageA, grp.name);

    // Owner textarea is NOT disabled
    await expect(pageA.locator('textarea').first()).not.toBeDisabled({ timeout: 3_000 });

    const msg = `owner-speaks-${Date.now()}`;
    await sendText(pageA, msg);
    await waitForMessage(pageA, msg);

    // B (member) also receives it
    await openGroupConv(pageB, grp.name);
    await waitForMessage(pageB, msg);

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-06: quit group — group no longer in groups panel (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gqt6a');
    const { token: tB, user: uB } = await createUser('gqt6b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `grp6-${Date.now().toString(36)}`, [uB.id]);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);

    // B opens group and quits via the group manage panel
    await openGroupConv(pageB, grp.name);
    await pageB.locator('.chat-header .icon-btn[title="群详情"]').click();
    await pageB.locator('.modal-overlay').waitFor({ timeout: 5_000 });
    // GroupManagePanel is lazy-loaded — wait for tabs to appear
    await pageB.locator('.gm-tabs').waitFor({ timeout: 8_000 });
    // Switch to the "群管理" (settings) tab where 退出群聊 lives
    await pageB.locator('.gm-tabs button').filter({ hasText: '群管理' }).click();
    const quitBtn = pageB.locator('.btn-dissolve').filter({ hasText: '退出群聊' }).first();
    await quitBtn.waitFor({ timeout: 5_000 });
    await quitBtn.click();
    await pageB.locator('.confirm-btn-ok').click();

    // Group should be gone from B's groups panel
    await pageB.locator('.nav-btn').filter({ hasText: '群组' }).first().click();
    await expect(
      pageB.locator('.contact-item').filter({ hasText: grp.name })
    ).not.toBeVisible({ timeout: 8_000 });

    await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-G1-07: kicked member no longer receives group messages (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gkk7a');
    const { token: tB, user: uB } = await createUser('gkk7b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `grp7-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // B opens group first to confirm it's active
    await openGroupConv(pageB, grp.name);

    // A kicks B via API
    await kickMember(tA, grp.id, uB.id);

    // B's UI should receive group_kicked toast
    await expect(
      pageB.locator('.toast-item, .toast').filter({ hasText: '已退出群聊' }).first()
    ).toBeVisible({ timeout: 8_000 });

    // A sends a new message
    await openGroupConv(pageA, grp.name);
    const postKickMsg = `post-kick-${Date.now()}`;
    await sendText(pageA, postKickMsg);

    // Wait then verify B did NOT receive the message
    await pageB.waitForTimeout(2_000);
    await expect(pageB.locator('.msg-bubble').filter({ hasText: postKickMsg })).not.toBeVisible();

    await ctxA.close(); await ctxB.close();
  });
});
