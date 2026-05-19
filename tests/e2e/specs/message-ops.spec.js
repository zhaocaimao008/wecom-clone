/**
 * TC-J4-01: Read receipts — sender sees "已读" after receiver views
 * TC-J2-07: Forward message to another contact
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends } = require('../fixtures/api');
const { loginPage, openConv, sendText, waitForMessage } = require('../fixtures/session');
const { setupFriendPair } = require('../fixtures/session');

test.describe('Message operations', () => {
  test('TC-J4-01: read receipts — "已读" appears after receiver opens chat', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    const { uA, uB } = await setupFriendPair(pageA, pageB, 'rd4a', 'rd4b');

    await openConv(pageA, uB.display_name);
    const msg = `receipt-${Date.now()}`;
    await sendText(pageA, msg);

    // B opens the conversation (triggers mark_read)
    await openConv(pageB, uA.display_name);
    await waitForMessage(pageB, msg);

    // A should eventually see 已读 indicator on the sent bubble
    const sentBubble = pageA.locator('.msg-bubble').filter({ hasText: msg }).first();
    const readIndicator = sentBubble.locator('..').locator('.msg-read, .read-receipt, [class*="read"]').first();
    await expect(readIndicator).toBeVisible({ timeout: 8_000 });

    await ctxA.close();
    await ctxB.close();
  });

  test('TC-J2-07: forward message to a third contact', async ({ browser }) => {
    // Setup: A-B friends, A-C friends
    const { token: tA, user: uA } = await createUser('fw7a');
    const { token: tB, user: uB } = await createUser('fw7b');
    const { token: tC, user: uC } = await createUser('fw7c');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tA, uA, tC, uC);

    const ctxA = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageC = await ctxC.newPage();
    await loginPage(pageA, tA, uA);
    await loginPage(pageC, tC, uC);

    // A sends to B
    await openConv(pageA, uB.display_name);
    const msg = `forward-src-${Date.now()}`;
    await sendText(pageA, msg);

    // A right-clicks and forwards to C
    const bubble = pageA.locator('.msg-bubble').filter({ hasText: msg }).first();
    await bubble.click({ button: 'right' });
    await pageA.locator('.ctx-menu').waitFor({ timeout: 3_000 });
    await pageA.getByRole('button', { name: '转发' }).click();

    // Forward modal — find C and confirm
    await pageA.locator('.modal-overlay').waitFor({ timeout: 5_000 });
    const contactEntry = pageA.locator('.modal-member-item').filter({ hasText: uC.display_name }).first();
    await contactEntry.click();
    await pageA.locator('.modal-box').getByRole('button', { name: /确认|发送|转发/ }).last().click();

    // C should receive the forwarded message
    await openConv(pageC, uA.display_name);
    await expect(pageC.locator('.msg-bubble').filter({ hasText: msg }).first())
      .toBeVisible({ timeout: 10_000 });

    await ctxA.close();
    await ctxC.close();
  });
});
