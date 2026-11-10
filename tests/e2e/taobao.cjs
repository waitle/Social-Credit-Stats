// 타오바오 E2E: 가짜 타오바오(HTTPS) + Chromium 에 확장 로드
// 실행: node tests/e2e/taobao.cjs   (playwright 필요)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const { startMockTaobao, ORDERS } = require('./mock-taobao.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'aliexpress-stats');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aes-tb-e2e-'));
const PORT = 8444;
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name]); console.log(`PASS  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push(['FAIL', name]); console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
};

function certs() {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'), '-days', '2',
    '-subj', '/CN=buyertrade.taobao.com', '-addext', 'subjectAltName=DNS:buyertrade.taobao.com,DNS:trade.taobao.com,DNS:h5api.m.taobao.com'], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) };
}
const panelText = (page) => page.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('.panel').innerText);
const shadowClick = (page, sel) => page.evaluate((s) => { const e = document.getElementById('aes-host').shadowRoot.querySelector(s); if (e) e.click(); return !!e; }, sel);
async function waitPanel(page, re, ms = 25000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (re.test(t)) return t; } catch (_) {} await page.waitForTimeout(200); }
  throw new Error(`패널에 ${re} 가 나타나지 않음\n${t.slice(0, 800)}`);
}

(async () => {
  const { srv, stats, ctl } = await startMockTaobao({ ...certs(), port: PORT });
  const ctx = await chromium.launchPersistentContext(path.join(TMP, 'profile'), {
    headless: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--headless=new', '--ignore-certificate-errors', '--no-proxy-server',
      `--host-resolver-rules=MAP *.taobao.com 127.0.0.1:${PORT}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const dialogs = [];
  const open = async () => {
    const page = await ctx.newPage();
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm');
    return { page, errs };
  };
  const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

  await step('패널이 타오바오로 표시되고, 열기만 해서는 조회하지 않는다', async () => {
    const { page } = await open();
    const t = await waitPanel(page, /타오바오 주문 통계/);
    assert.match(t, /수집된 주문|저장됨|건/);
    await page.waitForTimeout(1500);
    assert.strictEqual(stats.detailPosts, 0, '자동으로 상세를 조회하면 안 됨');
    // 강조색은 타오바오 주황, 경고용 빨강은 그대로
    const col = await page.evaluate(() => {
      const r = document.getElementById('aes-host').shadowRoot, w = r.querySelector('.w');
      return { w: w.className, fab: getComputedStyle(r.querySelector('.fab')).backgroundColor, red: getComputedStyle(w).getPropertyValue('--red').trim() };
    });
    assert.strictEqual(col.fab, 'rgb(255, 80, 0)', JSON.stringify(col));
    assert.strictEqual(col.red, '#e62e2e');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    await page.close();
  });

  await step('불러오기: 기간(1주일) 안의 주문 + 원화 결제액·배송 방식 상세', async () => {
    stats.listPosts = 0; stats.detailPosts = 0;
    const { page, errs } = await open();
    await waitPanel(page, /타오바오 주문 통계/);
    await page.waitForTimeout(800);                         // lib.mtop 가 늦게 뜨는 것을 흉내낸 대기
    await shadowClick(page, '[data-act="loadall"]');
    await waitPanel(page, /원화 결제액·배송 정보 \d+건 반영/, 30000);
    assert.ok(stats.listPosts >= 1 && stats.listPosts <= 2, '목록 요청: ' + stats.listPosts);
    assert.strictEqual(stats.pages[2] || 0, 0, '1주일 기간이면 2페이지는 필요 없음');
    assert.ok(stats.detailPosts >= 3, '상세 직접 호출: ' + stats.detailPosts);
    const body = await waitPanel(page, /구매한 상품/);
    assert.match(body, /원/, '원화로 표시');
    assert.doesNotMatch(body, /¥|CNY/, '위안이 남지 않아야 함: ' + body.slice(0, 400));
    assert.deepStrictEqual(errs, []);
    await page.close();
  });

  await step('저장: 타오바오 주문은 tb_ 키에만, 알리 키는 비어 있다', async () => {
    const r = await storage(['orders', 'tb_orders', 'tb_settings']);
    assert.strictEqual(r.orders, undefined, '알리 키에 쓰지 않음');
    const tb = r.tb_orders || {};
    assert.ok(Object.keys(tb).length >= 4, '주문 수: ' + Object.keys(tb).length);
    const o1 = tb[ORDERS[0].id];
    assert.strictEqual(o1.status, 'delivered');
    assert.strictEqual(o1.paidActual.currency, 'KRW');
    assert.strictEqual(o1.paidActual.amount, ORDERS[0].krw);
    assert.strictEqual(o1.total.amount, ORDERS[0].krw, '목록의 위안 금액이 상세의 원화 결제액을 덮어쓰지 않음');
    assert.strictEqual(o1.shipMode, 'forwarder');
    assert.strictEqual(o1.noCustoms, true);
    assert.strictEqual(tb[ORDERS[1].id].shipMode, 'direct');
    assert.strictEqual(tb[ORDERS[3].id].refund.state, 'done');
    assert.ok(!JSON.stringify(tb).includes('7761'), '전화번호가 저장되면 안 됨');
  });

  await step('배송 현황: 배송 전·배송 중 주문이 보인다', async () => {
    const { page } = await open();
    await waitPanel(page, /타오바오 주문 통계/);
    await shadowClick(page, '[data-tab="shipping"]');
    const t = await waitPanel(page, /테스트 상품 2/);
    assert.match(t, /테스트 상품 3/);
    await page.close();
  });

  await step('기간을 3달로 늘리면 2페이지까지 불러온다', async () => {
    const { page } = await open();
    await waitPanel(page, /타오바오 주문 통계/);
    await page.waitForTimeout(800);
    await page.evaluate(() => { const s = document.getElementById('aes-host').shadowRoot.querySelector('[data-input="period"]'); s.value = '3m'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await waitPanel(page, /목록 완료|추가분 확인 완료/, 30000);
    assert.ok(stats.pages[2] >= 1, '2페이지 요청');
    const r = await storage(['tb_orders', 'tb_settings']);
    assert.strictEqual(Object.keys(r.tb_orders).length, ORDERS.length);
    assert.strictEqual(r.tb_settings.coverage && r.tb_settings.coverage.from, 'all');
    assert.ok(dialogs.some((d) => /타오바오에서 봇 인증/.test(d)), '무거운 기간 경고 문구가 타오바오로 표시: ' + dialogs.join('|').slice(0, 200));
    await page.close();
  });

  await step('팝업: 알리·타오바오 전환 (타오바오 주황, 선택 기억)', async () => {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/popup/popup.html`);
    // 알리 주문이 없으면 처음부터 타오바오 화면
    await page.waitForFunction(() => /배송 대기·진행/.test(document.body.innerText), null, { timeout: 10000 });
    const look = () => page.evaluate(() => ({
      text: document.getElementById('body').innerText, open: document.getElementById('open').textContent,
      refreshHidden: document.getElementById('refresh').hidden, on: document.querySelector('.site button.on').dataset.site,
      ac: getComputedStyle(document.getElementById('open')).backgroundColor
    }));
    let v = await look();
    assert.strictEqual(v.on, 'taobao');
    assert.match(v.text, /배송 전/); assert.match(v.text, /환불 진행/);
    assert.doesNotMatch(v.text, /7일 내 도착|합산/);
    assert.strictEqual(v.open, '타오바오 주문');
    assert.strictEqual(v.refreshHidden, true);
    assert.strictEqual(v.ac, 'rgb(255, 80, 0)');
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-popup-tb.png') });
    // 알리로 전환: 알리 화면 + 빨강, 선택은 기억된다
    await page.click('#s-ali');
    await page.waitForFunction(() => /수집된 알리 주문이 없습니다/.test(document.body.innerText), null, { timeout: 5000 });
    v = await look();
    assert.strictEqual(v.on, 'ali'); assert.strictEqual(v.open, '알리 주문'); assert.strictEqual(v.refreshHidden, false);
    assert.strictEqual(v.ac, 'rgb(230, 46, 46)');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.site button.on'), null, { timeout: 5000 });
    assert.strictEqual((await look()).on, 'ali');
    await page.click('#s-taobao');                                     // 다음 단계를 위해 되돌려 둔다
    await page.close();
  });

  await step('배지: 타오바오 배송 대기·진행이 합산된다', async () => {
    const title = await sw.evaluate(async () => { await refreshBadge(); return (await chrome.action.getTitle({})); });
    assert.match(title, /타오바오 배송 전 1 · 배송 중 1/);
    const text = await sw.evaluate(() => chrome.action.getBadgeText({}));
    assert.strictEqual(text, '2');
  });

  await step('목록 API가 실패하면 원인을 보여 주고 저장된 주문은 유지한다', async () => {
    ctl.listFail = true;
    const { page } = await open();
    await waitPanel(page, /타오바오 주문 통계/);
    await page.waitForTimeout(800);
    await page.evaluate(() => { const h = document.getElementById('aes-host').shadowRoot; const s = h.querySelector('[data-input="period"]'); s.value = '1w'; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await shadowClick(page, '[data-act="loadall"]');
    await waitPanel(page, /목록을 불러오지 못했습니다|오류로 멈췄습니다/, 40000);
    const r = await storage(['tb_orders']);
    assert.strictEqual(Object.keys(r.tb_orders).length, ORDERS.length, '실패해도 저장된 주문은 그대로');
    ctl.listFail = false;
    await page.close();
  });

  await step('상품명 번역: 설정이 켜지면 캐시된 번역을 표시 (원문 아래 / 번역으로 대체), 끄면 원문만', async () => {
    const T2 = '테스트 상품 2 LED 조명';
    await sw.evaluate((t) => chrome.storage.local.set({ trSettings: { enabled: true, mode: 'below' }, trCache: { [t]: 'TR-OUT-2' } }), T2);
    const { page } = await open();
    await waitPanel(page, /타오바오 주문 통계/);
    await shadowClick(page, '[data-tab="shipping"]');
    let t = await waitPanel(page, /TR-OUT-2/);
    assert.match(t, /테스트 상품 2/, '원문도 함께 표시');
    await sw.evaluate(() => chrome.storage.local.set({ trSettings: { enabled: true, mode: 'replace' } }));
    const tis = () => page.evaluate(() => [...document.getElementById('aes-host').shadowRoot.querySelectorAll('.row .ti')].map((e) => e.innerText));
    let ti = await tis();
    for (let i = 0; i < 40 && ti.some((x) => /테스트 상품 2/.test(x)); i++) { await page.waitForTimeout(150); ti = await tis(); }
    assert.ok(ti.includes('TR-OUT-2') && !ti.some((x) => /테스트 상품 2/.test(x)), '대체 모드: ' + ti.join('|'));
    await sw.evaluate(() => chrome.storage.local.set({ trSettings: { enabled: false, mode: 'below' } }));
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && /TR-OUT-2/.test(await panelText(page))) await page.waitForTimeout(150);
    assert.doesNotMatch(await panelText(page), /TR-OUT-2/, '끄면 번역이 사라짐');
    await sw.evaluate(() => chrome.storage.local.remove(['trSettings', 'trCache']));
    await page.close();
  });

  await step('설정 페이지: 번역 항목이 저장된다', async () => {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${extId}/options/options.html`);
    await page.check('#trOn');
    assert.strictEqual(await page.inputValue('#trMode'), 'replace', '기본 표시 방식은 번역으로 대체');
    await page.selectOption('#trMode', 'below');
    await page.waitForTimeout(400);
    const r = await storage(['trSettings']);
    assert.deepStrictEqual(r.trSettings, { enabled: true, mode: 'below' });
    await sw.evaluate(() => chrome.storage.local.remove('trSettings'));
    await page.close();
  });

  await ctx.close(); srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
