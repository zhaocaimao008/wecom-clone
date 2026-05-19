# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scroll.spec.js >> Scroll behaviour >> TC-S1-03: scroll to top loads older messages and shows "已加载全部消息" (P1)
- Location: tests/e2e/specs/scroll.spec.js:98:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.load-more-tip').filter({ hasText: '已加载全部消息' })
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('.load-more-tip').filter({ hasText: '已加载全部消息' })

```

```yaml
- text: 6i 50
- button "添加账号":
  - img
- navigation:
  - button "我的":
    - img
    - text: 我的
  - button "消息":
    - img
    - text: 消息
  - button "通讯录":
    - img
    - text: 通讯录
  - button "群组":
    - img
    - text: 群组
  - button "设置":
    - img
    - text: 设置
- img
- textbox "搜索"
- button "发起群聊":
  - img
- text: 0p sc3ampb4s00p 11:38 sc3-1779104321730-50
- button:
  - img
- text: sc3ampb4s00p
- button "语音通话":
  - img
- button "视频通话":
  - img
- text: 今天 0p sc3ampb4s00p sc3-1779104321730-1 11:37 sc3-1779104321730-2 11:37 sc3-1779104321730-3 11:37 sc3-1779104321730-4 11:37 sc3-1779104321730-5 11:37 sc3-1779104321730-6 11:37 sc3-1779104321730-7 11:37 sc3-1779104321730-8 11:37 sc3-1779104321730-9 11:37 sc3-1779104321730-10 11:37 sc3-1779104321730-11 11:37 sc3-1779104321730-12 11:37 sc3-1779104321730-13 11:37 sc3-1779104321730-14 11:37 sc3-1779104321730-15 11:37 sc3-1779104321730-16 11:37 sc3-1779104321730-17 11:37 sc3-1779104321730-18 11:37 sc3-1779104321730-19 11:37 sc3-1779104321730-20 11:37 sc3-1779104321730-1 11:37 sc3-1779104321730-2 11:37 sc3-1779104321730-3 11:37 sc3-1779104321730-4 11:37 sc3-1779104321730-5 11:37 sc3-1779104321730-6 11:37 sc3-1779104321730-7 11:37 sc3-1779104321730-8 11:37 sc3-1779104321730-9 11:37 sc3-1779104321730-10 11:37 sc3-1779104321730-11 11:37 sc3-1779104321730-12 11:37 sc3-1779104321730-13 11:37 sc3-1779104321730-14 11:37 sc3-1779104321730-15 11:37 sc3-1779104321730-16 11:37 sc3-1779104321730-17 11:37 sc3-1779104321730-18 11:37 sc3-1779104321730-19 11:37 sc3-1779104321730-20 11:37 sc3-1779104321730-21 11:37 sc3-1779104321730-22 11:37 sc3-1779104321730-23 11:37 sc3-1779104321730-24 11:37 sc3-1779104321730-25 11:37 sc3-1779104321730-26 11:37 sc3-1779104321730-27 11:37 sc3-1779104321730-28 11:37 sc3-1779104321730-29 11:37 sc3-1779104321730-30 11:37 sc3-1779104321730-31 11:38 sc3-1779104321730-32 11:38 sc3-1779104321730-33 11:38 sc3-1779104321730-34 11:38 sc3-1779104321730-35 11:38 sc3-1779104321730-36 11:38 sc3-1779104321730-37 11:38 sc3-1779104321730-38 11:38 sc3-1779104321730-39 11:38 sc3-1779104321730-40 11:38 sc3-1779104321730-41 11:38 sc3-1779104321730-42 11:38 sc3-1779104321730-43 11:38 sc3-1779104321730-44 11:38 sc3-1779104321730-45 11:38 sc3-1779104321730-46 11:38 sc3-1779104321730-47 11:38 sc3-1779104321730-48 11:38 sc3-1779104321730-49 11:38 sc3-1779104321730-50 11:38
- button:
  - img
- textbox "发消息"
- button:
  - img
- button:
  - img
```

# Test source

```ts
  23  |     const el = document.querySelector('.messages-area');
  24  |     if (!el) return;
  25  |     el.scrollTop = 0;
  26  |     // React 17+ attaches onScroll directly to the element — a native event fires
  27  |     el.dispatchEvent(new Event('scroll'));
  28  |   });
  29  |   // Allow React state updates (setLoadingMore, setHasMore) to settle
  30  |   await page.waitForTimeout(500);
  31  | }
  32  | 
  33  | test.describe('Scroll behaviour', () => {
  34  | 
  35  |   // ─────────────────────────────────────────────────────────────────────────
  36  |   test('TC-S1-01: incoming message auto-scrolls to bottom (P0)', async ({ browser }) => {
  37  |     const { token: tA, user: uA } = await createUser('sc1a');
  38  |     const { token: tB, user: uB } = await createUser('sc1b');
  39  |     await makeFriends(tA, uA, tB, uB);
  40  | 
  41  |     const ctxA = await browser.newContext();
  42  |     const ctxB = await browser.newContext();
  43  |     const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  44  |     await Promise.all([loginPage(pageA, tA, uA), loginPage(pageB, tB, uB)]);
  45  | 
  46  |     // B opens the conversation — wait for the chat window to be ready
  47  |     await openConv(pageB, uA.display_name);
  48  |     await pageB.locator('.messages-area').waitFor({ timeout: 8_000 });
  49  | 
  50  |     // A sends a message
  51  |     await openConv(pageA, uB.display_name);
  52  |     const msg = `sc1-${Date.now()}`;
  53  |     await sendText(pageA, msg);
  54  | 
  55  |     // B should see A's message without any manual scroll (auto-scroll fires)
  56  |     await waitForMessage(pageB, msg);
  57  |     await expect(pageB.locator('.msg-bubble').filter({ hasText: msg }).first())
  58  |       .toBeVisible({ timeout: 8_000 });
  59  | 
  60  |     // Confirm B is at the bottom — scroll-to-bottom button must NOT be visible
  61  |     await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 3_000 });
  62  | 
  63  |     await ctxA.close(); await ctxB.close();
  64  |   });
  65  | 
  66  |   // ─────────────────────────────────────────────────────────────────────────
  67  |   test('TC-S1-02: scroll-to-bottom button appears when scrolled up, click returns to bottom (P1)', async ({ browser }) => {
  68  |     const { token: tA, user: uA } = await createUser('sc2a');
  69  |     const { token: tB, user: uB } = await createUser('sc2b');
  70  |     await makeFriends(tA, uA, tB, uB);
  71  | 
  72  |     // Pre-populate 50 messages so the area is definitely scrollable
  73  |     bulkInsertMessages(uA.id, uB.id, 50, `sc2-${Date.now()}`);
  74  | 
  75  |     const ctxB = await browser.newContext();
  76  |     const pageB = await ctxB.newPage();
  77  |     await loginPage(pageB, tB, uB);
  78  | 
  79  |     // B opens conv → wait for messages to render (auto-scrolled to bottom)
  80  |     await openConv(pageB, uA.display_name);
  81  |     await expect(pageB.locator('.msg-bubble').first()).toBeVisible({ timeout: 10_000 });
  82  |     await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 5_000 });
  83  | 
  84  |     // Scroll to top
  85  |     await scrollMsgAreaToTop(pageB);
  86  | 
  87  |     // Scroll button should appear (distFromBottom > 200)
  88  |     await expect(pageB.locator('.msg-scroll-btn')).toBeVisible({ timeout: 5_000 });
  89  | 
  90  |     // Click the button → scrolls to bottom → button disappears
  91  |     await pageB.locator('.msg-scroll-btn').click();
  92  |     await expect(pageB.locator('.msg-scroll-btn')).not.toBeVisible({ timeout: 5_000 });
  93  | 
  94  |     await ctxB.close();
  95  |   });
  96  | 
  97  |   // ─────────────────────────────────────────────────────────────────────────
  98  |   test('TC-S1-03: scroll to top loads older messages and shows "已加载全部消息" (P1)', async ({ browser }) => {
  99  |     const { token: tA, user: uA } = await createUser('sc3a');
  100 |     const { token: tB, user: uB } = await createUser('sc3b');
  101 |     await makeFriends(tA, uA, tB, uB);
  102 | 
  103 |     // Insert exactly 50 messages (= 1 full page).
  104 |     // Initial fetch loads all 50 → loadMoreMessages returns [] → hasMore=false
  105 |     const prefix = `sc3-${Date.now()}`;
  106 |     bulkInsertMessages(uA.id, uB.id, 50, prefix);
  107 | 
  108 |     const ctxB = await browser.newContext();
  109 |     const pageB = await ctxB.newPage();
  110 |     await loginPage(pageB, tB, uB);
  111 | 
  112 |     // Open conversation and wait for last message (50th) to be at bottom
  113 |     await openConv(pageB, uA.display_name);
  114 |     await expect(
  115 |       pageB.locator('.msg-bubble').filter({ hasText: `${prefix}-50` }).first()
  116 |     ).toBeVisible({ timeout: 10_000 });
  117 | 
  118 |     // Scroll to top → triggers loadMoreMessages() → returns 0 → "已加载全部消息"
  119 |     await scrollMsgAreaToTop(pageB);
  120 | 
  121 |     await expect(
  122 |       pageB.locator('.load-more-tip').filter({ hasText: '已加载全部消息' })
> 123 |     ).toBeVisible({ timeout: 10_000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  124 | 
  125 |     await ctxB.close();
  126 |   });
  127 | });
  128 | 
```