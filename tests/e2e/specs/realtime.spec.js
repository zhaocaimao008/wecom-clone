/**
 * R1: Fast conversation switch — no cross-contamination between convs
 * R2: Message deduplication — rapid sends don't produce duplicate bubbles
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends } = require('../fixtures/api');
const { loginPage, openConv, sendText } = require('../fixtures/session');

test.describe('Real-time edge cases', () => {
  test('R1: fast conv switch — messages land in correct conversation', async ({ browser }) => {
    // A is friends with both B and C
    const { token: tA, user: uA } = await createUser('r1a');
    const { token: tB, user: uB } = await createUser('r1b');
    const { token: tC, user: uC } = await createUser('r1c');
    await makeFriends(tA, uA, tB, uB);
    await makeFriends(tA, uA, tC, uC);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const ctxC = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();
    await loginPage(pageA, tA, uA);
    await loginPage(pageB, tB, uB);
    await loginPage(pageC, tC, uC);

    // B and C each send a unique message to A
    await openConv(pageB, uA.display_name);
    const msgFromB = `from-b-${Date.now()}`;
    await sendText(pageB, msgFromB);

    await openConv(pageC, uA.display_name);
    const msgFromC = `from-c-${Date.now()}`;
    await sendText(pageC, msgFromC);

    // A rapidly switches: open B's conv, then immediately open C's conv
    await openConv(pageA, uB.display_name);
    await pageA.waitForTimeout(200);
    await openConv(pageA, uC.display_name);

    // After settling, C's message should be in C's conv
    await expect(pageA.locator('.msg-bubble').filter({ hasText: msgFromC }).first())
      .toBeVisible({ timeout: 8_000 });

    // B's message must NOT appear in C's conversation view
    await expect(pageA.locator('.msg-bubble').filter({ hasText: msgFromB }))
      .not.toBeVisible();

    // Verify B's message is in B's conv
    await openConv(pageA, uB.display_name);
    await expect(pageA.locator('.msg-bubble').filter({ hasText: msgFromB }).first())
      .toBeVisible({ timeout: 8_000 });

    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  });

  test('R2: rapid send — no duplicate bubbles', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('r2a');
    const { token: tB, user: uB } = await createUser('r2b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await loginPage(pageA, tA, uA);
    await openConv(pageA, uB.display_name);

    const msg = `dedup-${Date.now()}`;
    const textarea = pageA.locator('textarea').first();

    // Send same message text twice — wait > 300ms between to clear the send debounce
    await textarea.fill(msg);
    await textarea.press('Enter');
    await pageA.waitForTimeout(400);
    await textarea.fill(msg);
    await textarea.press('Enter');

    // Give time for sockets to settle
    await pageA.waitForTimeout(2_000);

    // Count occurrences — should be exactly 2 (one per send), not 3 or 4
    const count = await pageA.locator('.msg-bubble').filter({ hasText: msg }).count();
    expect(count).toBe(2);

    await ctxA.close();
  });
});
