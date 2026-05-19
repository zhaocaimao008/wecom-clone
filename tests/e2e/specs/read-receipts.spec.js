/**
 * Read receipts & real-time sync E2E tests
 *
 * TC-R1-01 (P0): Private chat — 已读 appears after receiver opens chat
 * TC-R1-02 (P1): Switch away and back — only the latest message marked read
 * TC-R1-03 (P1): Hidden tab (visibility:hidden) — mark_read NOT sent until tab visible
 * TC-R1-04 (P0): Multiple messages sent — only one mark_read covers all (last unread)
 * TC-R1-05 (P1): Conv switch clears unread badge on the conv-item
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends } = require('../fixtures/api');
const { loginPage, openConv, sendText, waitForMessage } = require('../fixtures/session');

/** Find the read-receipt indicator next to the given message bubble */
async function getReadIndicator(page, msgText) {
  return page.locator('.msg-bubble').filter({ hasText: msgText })
    .locator('..').locator('.msg-read, .read-receipt, [class*="read"]').first();
}

test.describe('Read receipts', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-R1-01: 已读 appears after receiver opens private chat (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('rr1a');
    const { token: tB, user: uB } = await createUser('rr1b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openConv(pageA, uB.display_name);
    const msg = `rr1-${Date.now()}`;
    await sendText(pageA, msg);

    // Before B opens: no 已读
    const indicator = await getReadIndicator(pageA, msg);
    // (indicator might not exist yet — that's fine, just don't assert visible)

    // B opens the conversation
    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msg);

    // A should now see the 已读 indicator
    await expect(indicator).toBeVisible({ timeout: 8_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-R1-02: 已读 NOT sent while B is on a different conversation (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('rr2a');
    const { token: tB, user: uB } = await createUser('rr2b');
    const { token: tC, user: uC } = await createUser('rr2c');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tB, uB, tC, uC);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // B opens a different conversation first (with C)
    await openConv(pageB, uC.display_name);

    // A sends a message to B
    await openConv(pageA, uB.display_name);
    const msg = `rr2-${Date.now()}`;
    await sendText(pageA, msg);

    // Wait a bit — B is NOT on A's conv, so mark_read should NOT fire
    await pageA.waitForTimeout(2_500);
    const indicator = await getReadIndicator(pageA, msg);
    await expect(indicator).not.toBeVisible();

    // Now B switches to A's conversation
    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msg);

    // Now 已读 should appear
    await expect(indicator).toBeVisible({ timeout: 8_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-R1-04: multiple messages — single mark_read covers all (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('rr4a');
    const { token: tB, user: uB } = await createUser('rr4b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openConv(pageA, uB.display_name);
    const ts = Date.now();
    const msgs = [`rr4a-${ts}`, `rr4b-${ts}`, `rr4c-${ts}`];
    // Small delay between sends to avoid UI race conditions
    for (const m of msgs) {
      await sendText(pageA, m);
      await pageA.waitForTimeout(300);
    }

    // B opens and scrolls to bottom
    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msgs[2]);

    // Only the last message gets the 已读 indicator (mark_read emits once for the latest unread)
    await expect(await getReadIndicator(pageA, msgs[2])).toBeVisible({ timeout: 8_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-R1-05: unread badge clears when conv is opened (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('rr5a');
    const { token: tB, user: uB } = await createUser('rr5b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // A sends to B while B is looking elsewhere
    await openConv(pageA, uB.display_name);
    const msg = `badge-${Date.now()}`;
    await sendText(pageA, msg);

    // B's conv-item for A should show an unread badge
    await pageB.locator('.nav-btn').filter({ hasText: '消息' }).first().click();
    const convItem = pageB.locator('.conv-item').filter({ hasText: uA.display_name }).first();
    const badge = convItem.locator('.conv-badge, .unread-badge, .badge').first();
    await expect(badge).toBeVisible({ timeout: 8_000 });

    // B opens the conversation
    await convItem.click();
    await waitForMessage(pageB, msg);

    // Badge should be gone
    await expect(badge).not.toBeVisible({ timeout: 5_000 });

    await ctxA.close(); await ctxB.close();
  });
});
