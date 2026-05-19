/**
 * Attachment E2E tests
 *
 * TC-A1-01 (P0): Upload image in private chat — both sides see image bubble
 * TC-A1-02 (P0): Upload file in private chat — both sides see file bubble with filename
 * TC-A1-03 (P1): Upload image in group chat — all members see it
 * TC-A1-04 (P0): Upload image while mute_all active — textarea disabled (client prevention)
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createUser, makeFriends, createGroup, setMuteAll } = require('../fixtures/api');
const { loginPage, openConv } = require('../fixtures/session');

// ── helpers ──────────────────────────────────────────────────────────────────

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
  await page.locator('.chat-header').filter({ hasText: groupName }).first().waitFor({ timeout: 8_000 });
}

/** Open the "+" more panel and click the button with the given label text */
async function clickMoreItem(page, itemLabel) {
  const plusBtn = page.locator('.wx-ic-btn.wx-plus-btn').first();
  await plusBtn.click();
  await page.locator('.wx-more-panel').waitFor({ timeout: 3_000 });
  await page.locator('.wx-more-item').filter({ hasText: itemLabel }).first().click();
}

/** Write a tiny valid PNG to /tmp */
function makeTmpPng(name = 'test.png') {
  const p = path.join(os.tmpdir(), name);
  const buf = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080200000090' +
    '012e00000000c4944415478016360f8cf000001020100d5cdbb8d000000004' +
    '9454e44ae426082',
    'hex'
  );
  fs.writeFileSync(p, buf);
  return p;
}

/** Write a small text file to /tmp */
function makeTmpTxt(name = 'test.txt', content = 'hello e2e') {
  const p = path.join(os.tmpdir(), name);
  fs.writeFileSync(p, content);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Attachments', () => {

  test('TC-A1-01: upload image in private chat — both see image bubble (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('ima1a');
    const { token: tB, user: uB } = await createUser('ima1b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openConv(pageA, uB.display_name);

    // Open "+" more panel → click 相册 → file chooser fires
    const [fileChooser] = await Promise.all([
      pageA.waitForEvent('filechooser'),
      clickMoreItem(pageA, '相册'),
    ]);
    await fileChooser.setFiles(makeTmpPng('att-img-1.png'));

    // A's side: image bubble should appear
    await expect(pageA.locator('.msg-image img, .msg-bubble img').first())
      .toBeVisible({ timeout: 15_000 });

    // B's side
    await openConv(pageB, uA.display_name);
    await expect(pageB.locator('.msg-image img, .msg-bubble img').first())
      .toBeVisible({ timeout: 15_000 });

    await ctxA.close(); await ctxB.close();
  });

  test('TC-A1-02: upload file in private chat — both see file bubble with filename (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('fil2a');
    const { token: tB, user: uB } = await createUser('fil2b');
    await makeFriends(tA, uA, tB, uB);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openConv(pageA, uB.display_name);

    const fileName = `e2e-${Date.now()}.txt`;
    const filePath = makeTmpTxt(fileName);

    const [fileChooser] = await Promise.all([
      pageA.waitForEvent('filechooser'),
      clickMoreItem(pageA, '文件'),
    ]);
    await fileChooser.setFiles(filePath);

    // A's side: file bubble with filename
    await expect(pageA.locator('.msg-bubble, .msg-file').filter({ hasText: fileName }).first())
      .toBeVisible({ timeout: 15_000 });

    // B's side
    await openConv(pageB, uA.display_name);
    await expect(pageB.locator('.msg-bubble, .msg-file').filter({ hasText: fileName }).first())
      .toBeVisible({ timeout: 15_000 });

    await ctxA.close(); await ctxB.close();
  });

  test('TC-A1-03: upload image in group — all members see it (P1)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('gim3a');
    const { token: tB, user: uB } = await createUser('gim3b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `img-grp-${Date.now().toString(36)}`, [uB.id]);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
    await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);

    await openGroupConv(pageA, grp.name);

    const [fileChooser] = await Promise.all([
      pageA.waitForEvent('filechooser'),
      clickMoreItem(pageA, '相册'),
    ]);
    await fileChooser.setFiles(makeTmpPng('grp-img-3.png'));

    await expect(pageA.locator('.msg-image img, .msg-bubble img').first())
      .toBeVisible({ timeout: 15_000 });

    await openGroupConv(pageB, grp.name);
    await expect(pageB.locator('.msg-image img, .msg-bubble img').first())
      .toBeVisible({ timeout: 15_000 });

    await ctxA.close(); await ctxB.close();
  });

  test('TC-A1-04: mute_all — image upload button disabled for muted member (P0)', async ({ browser }) => {
    const { token: tA, user: uA } = await createUser('mut4a');
    const { token: tB, user: uB } = await createUser('mut4b');
    await makeFriends(tA, uA, tB, uB);
    const grp = await createGroup(tA, `mut-grp-${Date.now().toString(36)}`, [uB.id]);
    await setMuteAll(tA, grp.id, true);

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await loginPage(pageB, tB, uB);

    await openGroupConv(pageB, grp.name);

    // When muted, all wx-ic-btn inputs are disabled and textarea is disabled
    await expect(pageB.locator('textarea').first()).toBeDisabled({ timeout: 5_000 });
    // The "+" more button should also be disabled
    await expect(pageB.locator('.wx-ic-btn.wx-plus-btn').first()).toBeDisabled({ timeout: 3_000 });

    await ctxB.close();
  });
});
