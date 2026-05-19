/**
 * Scroll behaviour & pagination E2E tests
 *
 * TC-S1-01 (P0): Incoming message auto-scrolls the conversation to bottom
 * TC-S1-02 (P1): Scroll-to-bottom button appears when scrolled up, vanishes after click
 * TC-S1-03 (P1): Loading older messages shows "已加载全部消息"
 */

const { test, expect } = require('@playwright/test');
const { createUser, makeFriends, bulkInsertMessages } = require('../fixtures/api');
const { loginPage, openConv, sendText, waitForMessage } = require('../fixtures/session');

/**
 * Programmatically scroll .messages-area to scrollTop=0 and fire a synthetic
 * scroll event so React's onScroll handler processes it.
 * More reliable than mouse.wheel in headless mode because it targets the
 * specific DOM element directly.
 */
async function scrollMsgAreaToTop(page) {
  // Wait for the messages container to exist
  await page.locator('.messages-area').waitFor({ timeout: 8_000 });
  await page.evaluate(() => {
    const el = document.querySelector('.messages-area');
    if (!el) return;
    el.scrollTop = 0;
    // React 17+ attaches onScroll directly to the element — a native event fires
    el.dispatchEvent(new Event('scroll'));
  });
  // Allow React state updates (setLoadingMore, setHasMore) to settle
  await page.waitForTimeout(500);
}

test.describe('Scroll behaviour', () => {

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-S1-01: incoming message auto-scrolls to bottom (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('sc1a');
    const { token: tB, user: uB } = await createUser('sc1b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    // B opens the conversation — wait for the chat window to be ready
    await openConv(pageB, uA.display_name);
    await pageB.locator('.messages-area').waitFor({ timeout: 8_000 });

    // A sends a message
    await openConv(pageA, uB.display_name);
    const msg = `sc1-${Date.now()}`;
    await sendText(pageA, msg);

    // B should see A's message without any manual scroll (auto-scroll fires)
    await waitForMessage(pageB, msg);
    await expect(pageB.locator('.msg-bubble').filter({ hasText: msg }).first())
      .toBeVisible({ timeout: 8_000 });

    // Confirm B is at the bottom — scroll-to-bottom button must NOT be visible
    await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 3_000 });

    await ctxA.close(); await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-S1-02: scroll-to-bottom button appears when scrolled up, click returns to bottom (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('sc2a');
    const { token: tB, user: uB } = await createUser('sc2b');
    await makeFriends(tA, uA, tB, uB);

    // Pre-populate 50 messages so the area is definitely scrollable
    bulkInsertMessages(uA.id, uB.id, 50, `sc2-${Date.now()}`);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);

    // B opens conv → wait for messages to render (auto-scrolled to bottom)
    await openConv(pageB, uA.display_name);
    await expect(pageB.locator('.msg-bubble').first()).toBeVisible({ timeout: 10_000 });
    await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 5_000 });

    // Scroll to top
    await scrollMsgAreaToTop(pageB);

    // Scroll button should appear (distFromBottom > 200)
    await expect(pageB.locator('.msg-scroll-btn')).toBeVisible({ timeout: 5_000 });

    // Click the button → scrolls to bottom → button disappears
    await pageB.locator('.msg-scroll-btn').click();
    await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 5_000 });

    await ctxB.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  test('TC-S1-03: scroll to top loads older messages and shows "已加载全部消息" (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('sc3a');
    const { token: tB, user: uB } = await createUser('sc3b');
    await makeFriends(tA, uA, tB, uB);

    // Insert exactly 50 messages (= 1 full page).
    // Initial fetch loads all 50 → loadMoreMessages returns [] → hasMore=false
    const prefix = `sc3-${Date.now()}`;
    bulkInsertMessages(uA.id, uB.id, 50, prefix);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);

    // Open conversation and wait for last message (50th) to be at bottom
    await openConv(pageB, uA.display_name);
    await expect(
      pageB.locator('.msg-bubble').filter({ hasText: `${prefix}-50` }).first()
    ).toBeVisible({ timeout: 10_000 });

    // Scroll to top → triggers loadMoreMessages() → returns 0 → "已加载全部消息"
    await scrollMsgAreaToTop(pageB);

    await expect(
      pageB.locator('.load-more-tip').filter({ hasText: '已加载全部消息' })
    ).toBeVisible({ timeout: 10_000 });

    await ctxB.close();
  });
});
