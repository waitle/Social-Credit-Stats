// E2E: 보안 인증(캡차), 중단/이어서 불러오기, 로딩 애니메이션, 설정 입력 중 알림 폭주 방지
// 실행: node tests/e2e/resume.cjs   (run.cjs 와 같은 환경)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startMockAli, ALL } = require('./mock-ali.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'aliexpress-stats');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aes-resume-'));
const PORT = 8443;
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(1); console.log(`PASS  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push(0); console.log(`FAIL  ${name}\n      ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); }
};

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'k.pem'), '-out', path.join(TMP, 'c.pem'), '-days', '2',
  '-subj', '/CN=www.aliexpress.com', '-addext', 'subjectAltName=DNS:www.aliexpress.com,DNS:acs.aliexpress.com'], { stdio: 'ignore' });

const launch = (profile) => chromium.launchPersistentContext(profile, {
  headless: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 },
  args: ['--no-sandbox', '--headless=new', '--ignore-certificate-errors', '--no-proxy-server',
    `--host-resolver-rules=MAP *.aliexpress.com 127.0.0.1:${PORT}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
});
const swOf = async (ctx) => ctx.serviceWorkers()[0] || ctx.waitForEvent('serviceworker');
const panelText = (page) => page.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('.panel').innerText);
const shadow = (page, fn, arg) => page.evaluate(fn, arg);
const clickShadow = (page, sel) => page.evaluate((s) => { const e = document.getElementById('aes-host').shadowRoot.querySelector(s); if (e) e.click(); return !!e; }, sel);
const clicks = (page) => page.evaluate(() => page - 1);                // 가짜 페이지에서 "주문 더 보기" 클릭으로 로드된 페이지 수
const stored = async (ctx) => (await swOf(ctx)).evaluate(() => chrome.storage.local.get(['orders', 'settings']));
async function waitText(page, re, ms = 20000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (re.test(t)) return t; } catch (_) {} await page.waitForTimeout(100); }
  throw new Error(`패널에 ${re} 가 나타나지 않음\n${t.slice(-500)}`);
}
const busy = (t) => /불러오는 중|확인 중…|조회 중…|이어서 불러오는 중|보안 인증이 필요합니다 — /.test(t);
async function waitIdle(page, ms = 25000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (!busy(t) && /저장됨|완료|중단/.test(t)) return t; } catch (_) {} await page.waitForTimeout(100); }
  throw new Error('로딩이 끝나지 않음\n' + t.slice(-400));
}

/** 새 프로필로 확장을 띄우고 설정(전체 조회, 짧은 인증 대기)을 미리 넣는다 */
async function fresh(name, extra = {}) {
  const ctx = await launch(path.join(TMP, name));
  const w = await swOf(ctx);
  await w.evaluate((x) => chrome.storage.local.set({ settings: Object.assign({ period: 'all', captchaPollMs: 100, captchaTimeoutMs: 1500 }, x) }), extra);
  return ctx;
}
const open = async (ctx) => {
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());                                 // "2달 이상" 경고
  await page.goto('https://www.aliexpress.com/p/order/index.html');
  return page;
};

(async () => {
  const mock = await startMockAli({ key: fs.readFileSync(path.join(TMP, 'k.pem')), cert: fs.readFileSync(path.join(TMP, 'c.pem')), port: PORT });
  const { srv, stats, ctl } = mock;
  const reset = () => { Object.assign(ctl, { captchaFailsPage3: 0, delayMs: 0 }); stats.pages = {}; stats.captchaHits = 0; stats.listPosts = 0; };

  await step('보안 인증이 떠도 빠른 모드를 유지하고, 인증이 풀리면 이어서 끝까지', async () => {
    reset(); ctl.captchaFailsPage3 = 3;
    const ctx = await fresh('p1'); const page = await open(ctx);
    const t = await waitIdle(page);
    assert.match(t, /\(빠른 모드\)/, '화면 방식으로 전환되지 않았어야 함');
    assert.strictEqual(await clicks(page), 1, '더 보기 클릭은 형식 학습용 1번뿐');
    assert.strictEqual(stats.pages[2], 1, '2페이지를 다시 훑으면 안 됨');
    assert.strictEqual(stats.pages[3], 1);
    assert.strictEqual(stats.captchaHits, 3);
    assert.strictEqual(Object.keys((await stored(ctx)).orders).length, ALL.length);
    await ctx.close();
  });

  await step('인증이 계속되면 일시정지(화면 방식으로 바꾸지 않음) → 인증 후 이어서 불러오기', async () => {
    reset(); ctl.captchaFailsPage3 = -1;
    const ctx = await fresh('p2'); const page = await open(ctx);
    const t = await waitText(page, /보안 인증이 필요합니다\. 알리 페이지에서/, 25000);
    await waitIdle(page);
    assert.strictEqual(await clicks(page), 1, '일시정지 때 화면 방식으로 바뀌면 클릭이 늘어난다');
    assert.strictEqual(stats.pages[2], 1);
    assert.ok(!stats.pages[3], '3페이지는 아직 못 받음');
    const st1 = await (async () => { await page.waitForTimeout(500); return stored(ctx); })();
    assert.ok(st1.settings.resume && st1.settings.resume.oldest, '이어받기 지점이 저장돼야 함');
    assert.match(await panelText(page), /이어서 불러오기/);
    ctl.captchaFailsPage3 = 0;                                          // 사용자가 인증을 마침
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /목록 완료\(빠른 모드\)/, 20000);
    assert.strictEqual(stats.pages[2], 1, '이어서 할 때 2페이지를 다시 받으면 안 됨');
    assert.strictEqual(stats.pages[3], 1);
    assert.strictEqual(await clicks(page), 1);
    await page.waitForTimeout(600);
    const st2 = await stored(ctx);
    assert.strictEqual(Object.keys(st2.orders).length, ALL.length);
    assert.strictEqual(st2.settings.resume, null, '다 받으면 이어받기 지점은 지워짐');
    assert.strictEqual(st2.settings.coverage.from, 'all');
    await ctx.close();
  });

  await step('접속을 닫았다가 다시 열면 저장된 지점부터 이어서 (처음부터 다시 훑지 않음)', async () => {
    reset(); ctl.captchaFailsPage3 = -1;
    const ctx = await fresh('p3'); let page = await open(ctx);
    await waitText(page, /보안 인증이 필요합니다\. 알리 페이지에서/, 25000);
    await waitIdle(page);
    await page.waitForTimeout(500);
    const mid = await stored(ctx);
    assert.ok(mid.settings.resume);
    assert.ok(Object.keys(mid.orders).length < ALL.length);
    await page.close();
    ctl.captchaFailsPage3 = 0;
    page = await open(ctx);                                             // 새 접속
    await waitText(page, /목록 완료\(빠른 모드\)/, 25000);
    assert.strictEqual(stats.pages[2], 1, '2페이지는 첫 접속에서 한 번만');
    assert.strictEqual(stats.pages[3], 1);
    assert.strictEqual(await clicks(page), 0, '두 번째 접속에서는 더 보기 클릭이 없어야 함');
    await page.waitForTimeout(600);
    const st = await stored(ctx);
    assert.strictEqual(Object.keys(st.orders).length, ALL.length);
    assert.strictEqual(st.settings.coverage.from, 'all');
    await ctx.close();
  });

  await step('인증 대기 중 "중단" → 중단 지점이 남고, 다시 누르면 거기서 이어서', async () => {
    reset(); ctl.captchaFailsPage3 = -1;
    const ctx = await fresh('p4', { captchaTimeoutMs: 60000 });          // 인증 대기를 길게 해서 그 사이에 중단
    const page = await open(ctx);
    await waitText(page, /보안 인증이 필요합니다 — /, 20000);
    await clickShadow(page, '[data-act="stop"]');
    const t = await waitText(page, /중단됨 · \d+건 저장됨/, 15000);
    assert.match(t, /이어서 불러오기/);
    assert.strictEqual(await clicks(page), 1, '중단 후에도 화면 방식으로 바뀌지 않음');
    assert.ok(!stats.pages[3]);
    ctl.captchaFailsPage3 = 0;
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /목록 완료\(빠른 모드\)/, 20000);
    assert.strictEqual(stats.pages[2], 1, '이어서 할 때 2페이지를 다시 받지 않음');
    assert.strictEqual(stats.pages[3], 1);
    await page.waitForTimeout(500);
    assert.strictEqual(Object.keys((await stored(ctx)).orders).length, ALL.length);
    await ctx.close();
  });

  await step('불러오는 동안 로딩 애니메이션 표시, 끝나면 사라짐', async () => {
    reset(); ctl.delayMs = 1800;
    const ctx = await fresh('p5'); const page = await open(ctx);
    const probe = () => page.evaluate(() => { const r = document.getElementById('aes-host').shadowRoot; return { spin: !!r.querySelector('.tools .spin'), bar: !!r.querySelector('.lbar.on'), fab: r.querySelector('.fab').classList.contains('busy') }; });
    let seen = null;
    for (let i = 0; i < 60 && !(seen && seen.spin && seen.bar); i++) { await page.waitForTimeout(100); try { seen = await probe(); } catch (_) {} }
    assert.ok(seen && seen.spin && seen.bar, '로딩 중에는 스피너와 진행 막대가 보여야 함: ' + JSON.stringify(seen));
    await waitIdle(page);
    await page.waitForTimeout(400);
    assert.deepStrictEqual(await probe(), { spin: false, bar: false, fab: false });
    await ctx.close();
  });

  await step('불러오는 동안 기간 드롭다운에 포커스가 있으면 화면을 갈아 끼우지 않는다 (열린 목록이 닫히지 않음)', async () => {
    reset(); ctl.delayMs = 1800;
    const ctx = await fresh('p5b'); const page = await open(ctx);
    const sel = () => page.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('[data-input="period"]') !== null);
    const spinning = () => page.evaluate(() => !!document.getElementById('aes-host').shadowRoot.querySelector('.tools .spin')).catch(() => false);
    for (let i = 0; i < 80 && !((await sel().catch(() => false)) && (await spinning())); i++) await page.waitForTimeout(100);
    await page.evaluate(() => { const r = document.getElementById('aes-host').shadowRoot; const el = r.querySelector('[data-input="period"]'); window.__sel = el; el.focus(); });
    assert.ok(await page.evaluate(() => !!document.getElementById('aes-host').shadowRoot.querySelector('.tools .spin')), '아직 불러오는 중이어야 함: ' + (await panelText(page)).slice(-200));
    await page.waitForTimeout(1500);                                      // 이 사이 진행 갱신이 여러 번 일어난다
    const same = await page.evaluate(() => { const r = document.getElementById('aes-host').shadowRoot; return r.querySelector('[data-input="period"]') === window.__sel && r.activeElement === window.__sel; });
    assert.ok(same, '드롭다운 요소가 그대로이고 포커스가 유지돼야 함: ' + JSON.stringify(await page.evaluate(() => { const r = document.getElementById('aes-host').shadowRoot; return { sameEl: r.querySelector('[data-input="period"]') === window.__sel, active: r.activeElement && r.activeElement.tagName, spin: !!r.querySelector('.tools .spin') }; })));
    await page.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('[data-input="period"]').blur());
    await waitIdle(page);                                                  // 포커스가 빠지면 밀린 갱신이 반영된다
    assert.match(await panelText(page), /저장됨|완료/);
    await ctx.close();
  });

  await step('초기화하면 저장 범위·이어받기 지점도 지워져, 다시 불러오기가 처음부터 받는다', async () => {
    reset();
    const ctx = await fresh('p5c'); const page = await open(ctx);
    await waitIdle(page);
    let st = await stored(ctx);
    assert.strictEqual(Object.keys(st.orders).length, ALL.length);
    assert.ok(st.settings.coverage, '불러온 뒤에는 저장 범위가 있어야 함');
    await clickShadow(page, '[data-act="more"]');
    await clickShadow(page, '[data-act="clear"]');                       // confirm 은 자동 수락
    reset();                                                            // 이후 요청 수만 센다
    // 초기화하면 페이지가 새로 열리고(자동 실행) 처음부터 전부 다시 받는다
    await page.waitForEvent('load');
    await waitIdle(page);
    { const a = await stored(ctx); assert.strictEqual(Object.keys(a.orders).length, ALL.length, '초기화 후 다시 전부 받아야 함: ' + JSON.stringify({ n: Object.keys(a.orders).length, cov: a.settings.coverage, posts: stats.listPosts })); }
    assert.ok(stats.listPosts >= 1, '서버에 목록 요청을 실제로 보내야 함');
    await ctx.close();
  });

  await step('환율/관세 한도를 입력하는 동안 알림이 쏟아지지 않는다', async () => {
    reset();
    const ctx = await fresh('p6', { period: '1w' }); const page = await open(ctx);
    await waitIdle(page); await page.waitForTimeout(4500);                // 상세 조회 결과가 들어오고 서비스 워커의 자동 점검(2초 지연)까지 끝나길 기다림
    const w = await swOf(ctx);
    await w.evaluate(() => checkNotifications());                         // 현재 상태로 기준점 확정
    await w.evaluate(() => { self.__n = []; const o = chrome.notifications.create.bind(chrome.notifications); chrome.notifications.create = (id, opt, cb) => { self.__n.push(opt.title + ' | ' + opt.message); return o(id, opt, cb); }; });
    await w.evaluate(() => checkNotifications());                       // 기준점
    const before = Object.keys(await w.evaluate(() => chrome.notifications.getAll())).length;

    // 1) 글자를 칠 때마다 저장되지 않는다 (입력 중에는 설정이 그대로)
    await clickShadow(page, '[data-act="more"]');
    const fx = page.locator('input[data-input="fx"]');
    await fx.click();
    for (const ch of '1400') { await page.keyboard.type(ch); await page.waitForTimeout(120); }
    await page.waitForTimeout(500);
    assert.strictEqual((await stored(ctx)).settings.usdRate == null, true, '입력 도중에는 저장되지 않아야 함');
    assert.strictEqual(await fx.inputValue(), '1400', '입력 중인 값이 유지돼야 함');
    // 2) 입력을 마치면 한 번만 반영
    await fx.evaluate((e) => e.blur());
    await page.waitForTimeout(500);
    assert.strictEqual((await stored(ctx)).settings.usdRate, 1400);
    // 3) 범위를 벗어난 값은 거부
    await clickShadow(page, '[data-act="more"]'); await clickShadow(page, '[data-act="more"]');
    await fx.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('7');
    await fx.evaluate((e) => e.blur()); await page.waitForTimeout(400);
    assert.strictEqual((await stored(ctx)).settings.usdRate, 1400);
    assert.match(await panelText(page), /환율은 300~5000/);

    // 4) 환율/한도가 바뀌어도 알림은 0개 (서비스 워커가 기준점을 다시 잡음)
    for (const rate of [1, 14, 140, 1400, 1407, 1300]) {
      await w.evaluate(async (r) => { const { settings } = await chrome.storage.local.get('settings'); settings.usdRate = r; await chrome.storage.local.set({ settings }); return checkNotifications(); }, rate);
    }
    for (const lim of [1, 15, 150, 15, 150]) {
      await w.evaluate(async (l) => { const { settings } = await chrome.storage.local.get('settings'); settings.customsLimit = l; await chrome.storage.local.set({ settings }); return checkNotifications(); }, lim);
    }
    const after = Object.keys(await w.evaluate(() => chrome.notifications.getAll())).length;
    assert.strictEqual(after, before, `설정을 바꿔서 알림이 ${after - before}개 생김: ` + JSON.stringify(await w.evaluate(() => self.__n)));

    // 5) 데이터가 정말 바뀐 경우에는 최대 3개 + 요약 1개
    const n = await w.evaluate(async () => {
      const { orders } = await chrome.storage.local.get('orders');
      for (const o of Object.values(orders)) { if (o.status === 'shipping' || o.status === 'pending_ship') { o.status = 'delivered'; o.statusText = '완료'; } }
      await chrome.storage.local.set({ orders });
      return checkNotifications();
    });
    assert.ok(n >= 1 && n <= 3, `개별 알림은 3개 이하여야 함 (${n})`);
    await ctx.close();
  });

  srv.close();
  const fail = results.filter((r) => !r).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
