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
const stored = async (ctx) => (await swOf(ctx)).evaluate(() => chrome.storage.local.get(['orders', 'settings', 'counts']));
async function waitText(page, re, ms = 20000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (re.test(t)) return t; } catch (_) {} await page.waitForTimeout(100); }
  throw new Error(`패널에 ${re} 가 나타나지 않음\n${t.slice(-500)}`);
}
const busy = (t) => /불러오는 중|확인 중…|조회 중…|새로고침 중…|이어서 불러오는 중|보안 인증이 필요합니다 — /.test(t);
async function waitIdle(page, ms = 25000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (!busy(t) && /저장됨|완료|중단/.test(t)) return t; } catch (_) {} await page.waitForTimeout(100); }
  throw new Error('로딩이 끝나지 않음\n' + t.slice(-400));
}

/** 새 프로필로 확장을 띄우고 설정(전체 조회, 짧은 인증 대기)을 미리 넣는다 */
async function fresh(name, extra = {}) {
  const ctx = await launch(path.join(TMP, name));
  const w = await swOf(ctx);
  await w.evaluate((x) => chrome.storage.local.set({ settings: Object.assign({ auto: true, defaultsV: 1, period: 'all', captchaPollMs: 100, captchaTimeoutMs: 1500 }, x) }), extra);
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
  const reset = () => { Object.assign(ctl, { captchaFailsPage3: 0, delayMs: 0, directFail: false, trackEmpty: false, trackNone: false, detailCaptcha: false, detailUnknown: false, detailNoEta: false }); stats.trackTabs = 0; stats.trackPosts = 0; stats.detailTabs = 0; stats.detailPosts = 0; stats.pages = {}; stats.captchaHits = 0; stats.listPosts = 0; };

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

  await step('초기화: 진행 중이던 조회를 멈추고 주문·집계·범위·이어받기·알림 기준선까지 모두 지운다', async () => {
    reset(); ctl.delayMs = 1200;
    const ctx = await fresh('p5c', { auto: false }); const page = await open(ctx);
    const w = await swOf(ctx);
    await w.evaluate(async () => { globalThis.__rm = []; chrome.storage.onChanged.addListener((c) => __rm.push(...Object.keys(c).filter((k) => c[k].newValue === undefined))); await chrome.storage.local.set({ notifyState: { orders: {}, sig: 'x' } }); });
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    const spinning = () => page.evaluate(() => !!document.getElementById('aes-host').shadowRoot.querySelector('.tools .spin')).catch(() => false);
    for (let i = 0; i < 60 && !(await spinning()); i++) await page.waitForTimeout(100);
    assert.ok(await spinning(), '조회가 진행 중이어야 함');
    await clickShadow(page, '[data-act="more"]');
    await clickShadow(page, '[data-act="clear"]');                       // confirm 은 자동 수락
    await page.waitForEvent('load');
    await page.waitForTimeout(3500);                                     // 멈추지 않았다면 이 사이 계속 받아 저장했을 것
    assert.ok(!(await spinning()), '초기화 뒤에는 조회가 돌고 있으면 안 됨');
    const st = await stored(ctx);
    const removed = await w.evaluate(() => __rm);
    for (const k of ['orders', 'counts', 'notifyState']) assert.ok(removed.includes(k), `${k} 가 삭제돼야 함: ${removed}`);
    assert.strictEqual(Object.keys(st.orders || {}).length, 0, '초기화 직후에는 새 페이지의 1페이지 내용도 저장·표시되지 않아야 함');
    assert.ok(!st.counts, '알리 집계(배송 중·배송 전)도 비어야 함');
    { const t0 = await panelText(page); assert.match(t0, /수집된 주문이 없습니다/); assert.match(t0, /수집된 주문 0건/); assert.doesNotMatch(t0, /알리 집계/); }
    assert.strictEqual(st.settings.coverage, null);
    assert.ok(!st.settings.resume, '이어받기 지점이 남으면 "이어서 불러오기"로 보인다');
    assert.ok(!st.settings.listTpl && !st.settings.detailTpl);
    const t = await panelText(page);
    assert.ok(/불러오기/.test(t) && !/이어서 불러오기/.test(t), '버튼은 "불러오기"여야 함');
    assert.strictEqual(st.settings.auto, false, '자동 실행은 꺼진 채로');
    // 다시 불러오기 → 처음부터 전부
    reset();
    await clickShadow(page, '[data-act="loadall"]');
    await waitIdle(page);
    { const a = await stored(ctx); assert.strictEqual(Object.keys(a.orders).length, ALL.length); assert.ok(a.counts && a.counts.shipped === 6, '조회를 시작하면 잡아 둔 집계도 채워짐: ' + JSON.stringify(a.counts)); }
    assert.ok(stats.listPosts >= 1);
    await ctx.close();
  });

  await step('설정: 주문 페이지에서 패널 자동 펼치기 끄고 켜기', async () => {
    reset();
    const ctx = await fresh('p5e', { auto: false }); let page = await open(ctx);
    const isOpen = (pg) => pg.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('.panel').classList.contains('open'));
    await page.waitForTimeout(800);
    assert.strictEqual(await isOpen(page), true, '기본값은 자동으로 펼침');
    await clickShadow(page, '[data-act="more"]');
    await page.evaluate(() => { const el = document.getElementById('aes-host').shadowRoot.querySelector('[data-input="autoOpen"]'); el.checked = false; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(600);
    await page.reload(); await page.waitForTimeout(800);
    assert.strictEqual(await isOpen(page), false, '끄면 접힌 채로 열림');
    await clickShadow(page, '.fab');
    assert.strictEqual(await isOpen(page), true, '버튼을 누르면 열림');
    await ctx.close();
  });

  await step('직접 호출이 실패해도, 탭으로 예상 배송일과 모든 배송 중 주문의 운송장·도착 여부를 읽는다', async () => {
    reset(); ctl.directFail = true;
    const ctx = await fresh('p5f', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitIdle(page);
    await page.waitForTimeout(500);
    stats.trackTabs = 0; stats.trackPosts = 0;                               // 목록을 불러오며 이미 일부를 읽었으니, 버튼으로 전부 다시 읽는 횟수만 센다
    await clickShadow(page, '[data-act="details"]');
    await waitText(page, /배송 현황 새로고침 완료/, 90000);
    const ships = ALL.filter((o) => o.n % 5 === 0 || o.n % 5 === 3).length;
    assert.strictEqual(stats.trackTabs, ships - 1, `도착한 1건을 뺀 배송 중 주문마다 탭으로 읽어야 함 (${stats.trackTabs}/${ships - 1})`);   // 이미 도착한 주문은 다시 읽지 않는다
    assert.strictEqual(stats.trackPosts, ships - 1, '탭 안에서 호출됨');
    const orders = (await stored(ctx)).orders;
    const withNo = Object.values(orders).filter((o) => o.track && o.track.no).length;
    assert.strictEqual(withNo, ships, '운송장을 모두 읽음');
    const arrived = Object.values(orders).filter((o) => o.track && /Delivered/.test(o.track.last && o.track.last.text || ''));
    assert.strictEqual(arrived.length, 1, '위치·상태가 따로 있는 이벤트에서도 도착을 인식: ' + JSON.stringify(arrived.map((o) => o.track)));
    assert.ok(stats.detailTabs > 0, '상세도 탭으로 읽음');
    assert.ok(Object.values(orders).some((o) => o.eta && o.etaSrc === 'detail'), '탭에서 예상 배송일을 읽음');
    await ctx.close();
  });

  await step('직접 호출 응답에서 운송장을 못 읽으면 탭으로 읽는다 (상세는 탭을 열지 않음)', async () => {
    reset(); ctl.trackEmpty = true;
    const ctx = await fresh('p5g', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitIdle(page);
    await waitText(page, /배송 현황 새로고침 완료/, 90000);
    assert.ok(stats.trackTabs > 0, '탭으로 대체');
    assert.strictEqual(stats.detailTabs, 0, '상세는 직접 호출로 충분하므로 탭을 열지 않음');
    assert.ok(Object.values((await stored(ctx)).orders).some((o) => o.track && o.track.no && o.trackVia === 'tab'), '탭에서 운송장을 읽음');
    await ctx.close();
  });

  await step('상세 응답에 예상 배송일이 없는 주문은 탭을 열지 않는다', async () => {
    reset(); ctl.detailNoEta = true;
    const ctx = await fresh('p5n', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /배송 현황 새로고침 완료/, 90000);
    await page.waitForTimeout(800);
    assert.ok(stats.detailPosts > 0, '직접 호출함');
    assert.strictEqual(stats.detailTabs, 0, '탭을 열지 않음: ' + stats.detailTabs);
    const orders = Object.values((await stored(ctx)).orders).filter((o) => o.detailAt);
    assert.ok(orders.length > 0, '읽은 시각을 남겨 바로 다시 읽지 않음');
    assert.ok(orders.every((o) => !o.eta || o.etaSrc !== 'detail'), '없는 날짜를 만들어 내지 않음');
    assert.ok(orders.some((o) => o.payment), '같은 응답의 결제수단은 반영');
    await ctx.close();
  });

  await step('상세 응답 구조가 바뀌면 탭으로 읽는다', async () => {
    reset(); ctl.detailUnknown = true;
    const ctx = await fresh('p5u', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /배송 현황 새로고침 완료/, 90000);
    await page.waitForTimeout(800);
    assert.ok(stats.detailTabs > 0, '탭으로 대체');
    assert.ok(Object.values((await stored(ctx)).orders).some((o) => o.eta && o.etaSrc === 'detail'), '탭에서 예상 배송일을 읽음');
    await ctx.close();
  });

  await step('어느 주문에서도 운송장을 못 읽으면 탭은 3개까지만, 이후 갱신에서도 다시 열지 않는다', async () => {
    reset(); ctl.trackNone = true;
    const ctx = await fresh('p5h', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /배송 현황 새로고침 완료/, 90000);              // 탭마다 내용을 기다리므로 waitIdle 시간으로는 부족하다
    await page.waitForTimeout(800);
    assert.strictEqual(stats.trackTabs, 3, '탭 3개에서 멈춤: ' + stats.trackTabs);
    await page.reload(); await page.waitForTimeout(800);
    await clickShadow(page, '[data-act="loadall"]');
    await page.waitForTimeout(3000);
    assert.strictEqual(stats.trackTabs, 3, '다시 열어도 탭을 또 열지 않음: ' + stats.trackTabs);
    await ctx.close();
  });

  await step('상세 직접 호출에 보안 인증이 뜨면 탭을 열지 않고 기다렸다가 이어서 읽는다', async () => {
    reset(); ctl.detailCaptcha = true;
    const ctx = await fresh('p5i', { auto: false, captchaPollMs: 300, captchaTimeoutMs: 30000 }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitText(page, /보안 인증이 필요합니다/, 20000);
    assert.strictEqual(stats.detailTabs, 0, '인증 대기 중에는 탭을 열지 않음');
    ctl.detailCaptcha = false;
    await waitText(page, /배송 현황 새로고침 완료/, 30000);
    assert.strictEqual(stats.detailTabs, 0);
    assert.doesNotMatch(await panelText(page), /보안 인증이 필요합니다/);
    await page.waitForTimeout(800);
    assert.ok(Object.values((await stored(ctx)).orders).some((o) => o.eta && o.etaSrc === 'detail'), '인증 뒤 예상 배송일을 읽음');
    await ctx.close();
  });

  await step('이미 불러온 범위에서 "불러오기"를 누르면 아무 일도 안 하는 대신 최신 주문을 다시 확인한다', async () => {
    reset();
    const ctx = await fresh('p5d', { auto: false }); const page = await open(ctx);
    await page.waitForTimeout(600);
    await clickShadow(page, '[data-act="loadall"]');
    await waitIdle(page);                                               // 전체 범위를 불러옴 → 이후 어떤 기간이든 저장 범위 안
    const loads = stats.indexLoads;
    await clickShadow(page, '[data-act="loadall"]');
    await page.waitForEvent('load');
    const t = await waitText(page, /(추가분 확인|목록) 완료.*저장됨/, 15000);
    assert.ok(stats.indexLoads > loads, '페이지를 새로 열어 최신 목록을 받아야 함');
    assert.match(t, /\d+건 저장됨/);
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
