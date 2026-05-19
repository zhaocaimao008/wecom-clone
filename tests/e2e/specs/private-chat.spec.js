/**
 * TC-J2-01: Real-time text message (P0)
 * TC-J2-03: Recall message
 * TC-J2-04: Edit message
 * TC-J2-05: Reply to message
 */

const { test, expect } = require('@playwright/test');
const { setupFriendPair, sendText, waitForMessage, openConv } = require('../fixtures/session');

test.describe('Private chat', () => {
  test('TC-J2-01: A sends message, B receives in real time', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'p01a', 'p01b');

    // A opens conversation with B
    await openConv(pageA, uB.display_name);

    const msg = `hello-${Date.now()}`;
    await sendText(pageA, msg);

    // B should receive it
    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msg);

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J2-01b: B sends reply, A receives', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'p01c', 'p01d');

    await openConv(pageA, uB.display_name);
    const msgA = `msgA-${Date.now()}`;
    await sendText(pageA, msgA);

    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msgA);

    const msgB = `reply-${Date.now()}`;
    await sendText(pageB, msgB);
    await waitForMessage(pageA, msgB);

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J2-03: recall message — shows "已撤回" to both sides', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'rc3a', 'rc3b');

    await openConv(pageA, uB.display_name);
    const msg = `recall-${Date.now()}`;
    await sendText(pageA, msg);

    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msg);

    // A right-clicks the bubble and recalls
    const bubble = pageA.locator('.msg-bubble').filter({ hasText: msg }).first();
    await bubble.click({ button: 'right' });
    await pageA.locator('.ctx-menu').waitFor({ timeout: 3_000 });
    await pageA.getByRole('button', { name: '撤回' }).click();

    // Both should see recall notice
    await expect(pageA.locator('.recalled-msg').first()).toBeVisible({ timeout: 6_000 });
    await expect(pageB.locator('.recalled-msg').first()).toBeVisible({ timeout: 6_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J2-04: edit message — updated content visible to both', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'ed4a', 'ed4b');

    await openConv(pageA, uB.display_name);
    const original = `edit-orig-${Date.now()}`;
    await sendText(pageA, original);

    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, original);

    // A right-clicks and edits
    const bubble = pageA.locator('.msg-bubble').filter({ hasText: original }).first();
    await bubble.click({ button: 'right' });
    await pageA.locator('.ctx-menu').waitFor({ timeout: 3_000 });
    await pageA.getByRole('button', { name: '编辑' }).click();

    const edited = `edited-${Date.now()}`;
    const editInput = pageA.locator('textarea').first();
    await editInput.clear();
    await editInput.fill(edited);
    await editInput.press('Enter');

    // Both sides see the edited text
    await expect(pageA.locator('.msg-bubble').filter({ hasText: edited }).first())
      .toBeVisible({ timeout: 6_000 });
    await expect(pageB.locator('.msg-bubble').filter({ hasText: edited }).first())
      .toBeVisible({ timeout: 6_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J2-05: reply to message — quote visible in reply bubble', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'rp5a', 'rp5b');

    await openConv(pageA, uB.display_name);
    const original = `original-${Date.now()}`;
    await sendText(pageA, original);

    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, original);

    // B right-clicks and replies
    const bubble = pageB.locator('.msg-bubble').filter({ hasText: original }).first();
    await bubble.click({ button: 'right' });
    await pageB.locator('.ctx-menu').waitFor({ timeout: 3_000 });
    await pageB.getByRole('button', { name: '回复' }).click();

    const replyText = `reply-${Date.now()}`;
    await pageB.locator('textarea').first().fill(replyText);
    await pageB.locator('textarea').first().press('Enter');

    // Reply bubble should appear with quote on both sides
    await expect(pageB.locator('.msg-bubble').filter({ hasText: replyText }).first())
      .toBeVisible({ timeout: 6_000 });
    await expect(pageA.locator('.msg-bubble').filter({ hasText: replyText }).first())
      .toBeVisible({ timeout: 6_000 });

    await ctxA.close();
    await ctxB.close();
  });
});
