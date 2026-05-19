/**
 * Page-level helpers: inject auth token, navigate, wait for app ready.
 */

const { createUser, makeFriends } = require('./api');

/**
 * Log a user into the app by injecting token into localStorage,
 * then reload so the React app picks it up.
 */
async function loginPage(page, token, user) {
  await page.goto('/');
  await page.evaluate(({ token, user }) => {
    const accounts = [{ token, user, active: true }];
    localStorage.setItem('wc_accounts', JSON.stringify(accounts));
    localStorage.setItem('wc_token', token);
  }, { token, user });
  await page.reload();
  // Wait until sidebar is visible — app has bootstrapped
  await page.waitForSelector('.sidebar', { timeout: 10_000 });
}

/**
 * Open the conversation with a given user from the contacts/conversations list.
 * Clicks the conversation item whose display matches the target name.
 */
async function openConv(page, displayName) {
  // Try conversation list first (messages tab)
  await page.locator('.nav-btn').filter({ hasText: '消息' }).first().click();
  const convItem = page.locator('.conv-item').filter({ hasText: displayName }).first();
  if (await convItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await convItem.click();
    return;
  }
  // Fall back: contacts tab → find contact → click 发消息
  await page.locator('.nav-btn').filter({ hasText: '通讯录' }).first().click();
  await page.locator('.contact-item').filter({ hasText: displayName }).first().click();
  await page.locator('button').filter({ hasText: '发消息' }).first().click();
}

/**
 * Send a text message and wait for it to appear in the chat.
 */
async function sendText(page, text) {
  const input = page.locator('textarea').first();
  await input.fill(text);
  await input.press('Enter');
  // Wait for message to appear in the message list
  await page.locator(`.msg-bubble`).filter({ hasText: text }).first().waitFor({ timeout: 8_000 });
}

/**
 * Wait for a specific text to appear anywhere in the message list.
 */
async function waitForMessage(page, text, timeout = 8_000) {
  await page.locator('.msg-bubble').filter({ hasText: text }).first().waitFor({ timeout });
}

/**
 * Create two users, make them friends, and return them with pre-loaded page sessions.
 * pageA / pageB are Playwright Page objects passed in.
 */
async function setupFriendPair(pageA, pageB, prefixA = 'a', prefixB = 'b') {
  const { token: tA, user: uA } = await createUser(prefixA);
  const { token: tB, user: uB } = await createUser(prefixB);
  await makeFriends(tA, uA, tB, uB);
  await Promise.all([
    loginPage(pageA, tA, uA),
    loginPage(pageB, tB, uB),
  ]);
  return { tA, uA, tB, uB };
}

module.exports = { loginPage, openConv, sendText, waitForMessage, setupFriendPair };
