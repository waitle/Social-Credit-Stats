// 확장 프로그램 E2E 테스트: 가짜 알리(HTTPS) + 실제 중앙 서버(Go) + Chromium 에 확장 로드
// 실행: node tests/e2e/run.cjs   (playwright 필요: npm i -D playwright && npx playwright install chromium)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { chromium } = require('playwright');
const { startMockAli, ALL } = require('./mock-ali.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'aliexpress-stats');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aes-e2e-'));
const ALI_PORT = 8443, SRV_PORT = 18091;
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log(`PASS  ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0, e.message]); console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
};

function certs() {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(TMP, 'key.pem'), '-out', path.join(TMP, 'cert.pem'), '-days', '2',
    '-subj', '/CN=www.aliexpress.com', '-addext', 'subjectAltName=DNS:www.aliexpress.com,DNS:acs.aliexpress.com'], { stdio: 'ignore' });
  return { key: fs.readFileSync(path.join(TMP, 'key.pem')), cert: fs.readFileSync(path.join(TMP, 'cert.pem')) };
}

async function startGoServer() {
  try { execFileSync('go', ['version'], { stdio: 'ignore' }); } catch (_) { return null; }
  const bin = path.join(TMP, 'aes-server');
  execFileSync('go', ['build', '-o', bin, '.'], { cwd: path.join(ROOT, 'server'), stdio: 'inherit' });
  fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({ latestVersion: '0.0.1', flags: {}, parser: { etaLabels: ['도착\\s*보장'] } }));
  const p = spawn(bin, [], { env: { ...process.env, ADDR: `127.0.0.1:${SRV_PORT}`, DATA_DIR: path.join(TMP, 'srv'), CONFIG_FILE: path.join(TMP, 'config.json'), ADMIN_TOKEN: 'e2e', RATE_PER_MIN: '100000' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${SRV_PORT}/healthz`)).ok) return p; } catch (_) {} await new Promise((r) => setTimeout(r, 100)); }
  p.kill(); throw new Error('Go 서버가 뜨지 않음');
}

const launch = (extDir, profile) => chromium.launchPersistentContext(profile, {
  headless: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 },
  args: ['--no-sandbox', '--headless=new', '--ignore-certificate-errors', '--no-proxy-server',
    `--host-resolver-rules=MAP *.aliexpress.com 127.0.0.1:${ALI_PORT}`, `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
});
const sw = async (ctx) => ctx.serviceWorkers()[0] || ctx.waitForEvent('serviceworker');
const panelText = (page) => page.evaluate(() => document.getElementById('aes-host').shadowRoot.querySelector('.panel').innerText);
const shadowClick = (page, sel) => page.evaluate((s) => { const e = document.getElementById('aes-host').shadowRoot.querySelector(s); if (e) e.click(); return !!e; }, sel);
async function waitPanel(page, re, ms = 20000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (re.test(t)) return t; } catch (_) {} await page.waitForTimeout(200); }
  throw new Error(`패널에 ${re} 가 나타나지 않음\n${t.slice(0, 600)}`);
}
const idle = (t) => /(목록|추가분 확인) (완료|빠른)|취소됨/.test(t) && !/불러오는 중|확인 중…|조회 중…/.test(t);
async function waitIdle(page, ms = 25000) {
  const t0 = Date.now(); let t = '';
  while (Date.now() - t0 < ms) { try { t = await panelText(page); if (idle(t)) return t; } catch (_) {} await page.waitForTimeout(200); }
  throw new Error('로딩이 끝나지 않음\n' + t.slice(-500));
}

(async () => {
  const { srv, stats } = await startMockAli({ ...certs(), port: ALI_PORT });
  let goSrv = null;
  try { goSrv = await startGoServer(); } catch (e) { console.log('Go 서버 건너뜀:', e.message); }
  const profile = path.join(TMP, 'profile');
  let ctx = await launch(EXT, profile);
  let dialogs = [], answer = true;
  const openIndex = async () => {
    const page = await ctx.newPage();
    page.on('dialog', (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('https://www.aliexpress.com/p/order/index.html');
    return { page, errs };
  };
  const clicks = (page) => page.evaluate(() => page - 1);    // 가짜 페이지에서 "주문 더 보기"로 로드된 페이지 수

  await step('첫 접속: 기본 1주일, 클릭 없이 1페이지 + 예상 배송일 직접 호출', async () => {
    const { page, errs } = await openIndex();
    await waitIdle(page);
    await waitPanel(page, /예상 배송일 조회 완료/, 30000);
    assert.strictEqual(stats.listPosts, 1, '목록 요청 1번');
    assert.strictEqual(await clicks(page), 0, '더 보기 클릭 0번');
    assert.strictEqual(stats.detailTabs, 1, '상세 탭은 학습용 1개만');
    assert.ok(stats.detailPosts >= 2, '나머지 상세는 직접 호출');
    assert.deepStrictEqual(errs, []);
    await page.close();
  });

  await step('요약: 보호 기간 임박, 관세 한도(단건·묶음), 상점 통계', async () => {
    const { page } = await openIndex();
    await waitIdle(page);
    const t = await waitPanel(page, /구매자 보호 기간 임박/);
    assert.match(t, /관세 면세 한도 \$150 주의/);
    assert.match(t, /Store A · .* 주문 2건 합계/);
    assert.match(t, /\$179/);                                       // ₩250,000 / 1400
    assert.match(t, /자주 산 상점/);
    await shadowClick(page, '[data-tab="shipping"]');
    const s = await waitPanel(page, /통관 진행 중/);
    assert.match(s, /Cainiao LP0000000000/);
    assert.match(s, /보호 D-3/);
    await page.close();
  });

  await step('3달 선택 → 경고 확인 → 추가 페이지 학습', async () => {
    const { page } = await openIndex();
    await waitIdle(page);
    dialogs = []; const before = stats.listPosts;
    await page.evaluate(() => { const el = document.getElementById('aes-host').shadowRoot.querySelector('[data-input="period"]'); el.value = '3m'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(400);
    await waitIdle(page);
    assert.strictEqual(dialogs.length, 1); assert.match(dialogs[0], /최근 3달/);
    assert.ok(stats.listPosts > before, '추가 페이지 요청');
    await page.close();
  });

  await step('다시 접속: 저장된 범위 → 경고·클릭 없이 추가분만', async () => {
    dialogs = []; const before = stats.listPosts;
    const { page } = await openIndex();
    const t = await waitIdle(page);
    assert.strictEqual(dialogs.length, 0);
    assert.strictEqual(await clicks(page), 0);
    assert.match(t, /추가분 확인 완료|목록 완료/);
    assert.ok(stats.listPosts - before <= 2);
    await page.close();
  });

  await step('전체 선택 → 경고 거절 → 기간 유지, 다시 선택 → 확인 → 27건 저장', async () => {
    const { page } = await openIndex();
    await waitIdle(page);
    const sel = (v) => page.evaluate((v) => { const el = document.getElementById('aes-host').shadowRoot.querySelector('[data-input="period"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    answer = false; dialogs = [];
    await sel('all'); await page.waitForTimeout(400);
    assert.strictEqual(dialogs.length, 1);
    const w = await sw(ctx);
    assert.strictEqual((await w.evaluate(() => chrome.storage.local.get('settings'))).settings.period, '3m');
    answer = true; dialogs = [];
    await sel('all'); await page.waitForTimeout(400); await waitIdle(page);
    await page.waitForTimeout(800);
    const st = await w.evaluate(() => chrome.storage.local.get(['orders', 'settings']));
    assert.strictEqual(Object.keys(st.orders).length, ALL.length);
    assert.strictEqual(st.settings.coverage.from, 'all');
    await page.close();
  });

  await step('목록 클릭 → 주문 상세 새 탭, 분류 직접 수정 저장', async () => {
    const { page } = await openIndex();
    await waitIdle(page);
    await shadowClick(page, '[data-tab="purchases"]');
    await page.waitForTimeout(300);
    const [np] = await Promise.all([ctx.waitForEvent('page'), shadowClick(page, 'a.row')]);
    assert.match(np.url(), /\/p\/order\/detail\.html\?orderId=\d{16}/);
    await np.close();
    await page.evaluate(() => { const el = document.getElementById('aes-host').shadowRoot.querySelector('select[data-cat]'); el.value = '반려동물'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(800);
    const st = await (await sw(ctx)).evaluate(() => chrome.storage.local.get('settings'));
    assert.ok(Object.values(st.settings.catOverrides || {}).includes('반려동물'));
    await page.close();
  });

  await step('툴바 배지 + 팝업 요약', async () => {
    const w = await sw(ctx);
    await w.evaluate(() => refreshBadge());
    const badge = await w.evaluate(() => chrome.action.getBadgeText({}));
    const st = await w.evaluate(() => chrome.storage.local.get('orders'));
    const n = Object.values(st.orders).filter((o) => o.status === 'shipping' || o.status === 'pending_ship').length;
    assert.strictEqual(badge, String(n));
    const id = new URL(w.url()).host;
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${id}/popup/popup.html`);
    await p.waitForTimeout(500);
    const t = await p.evaluate(() => document.body.innerText);
    assert.match(t, /구매자 보호 기간 임박/); assert.match(t, /배송 중/); assert.match(t, /잔여 환불 예정 금액/);
    await p.close();
  });

  await step('알림: 배송 완료로 바뀌면 크롬 알림', async () => {
    const w = await sw(ctx);
    await w.evaluate(() => checkNotifications());                     // 기준점
    const n = await w.evaluate(async () => {
      const { orders } = await chrome.storage.local.get('orders');
      const o = Object.values(orders).find((x) => x.status === 'shipping');
      o.status = 'delivered'; o.statusText = '완료';
      await chrome.storage.local.set({ orders });
      return checkNotifications();
    });
    assert.ok(n >= 1, '알림 1건 이상');
    const all = await w.evaluate(() => chrome.notifications.getAll());
    assert.ok(Object.keys(all).some((k) => k.startsWith('aes|')));
  });

  await step('백그라운드 자동 갱신 (UI 없는 탭)', async () => {
    const before = stats.listPosts;
    const r = await (await sw(ctx)).evaluate(() => runBackgroundRefresh());
    assert.strictEqual(r, 'done');
    assert.ok(stats.listPosts > before, '목록 재요청');
  });

  if (goSrv) {
    const base = `http://127.0.0.1:${SRV_PORT}`;
    await step('중앙 서버: 원격 설정 수신 + 익명 상태 보고', async () => {
      const w = await sw(ctx);
      await w.evaluate(async (b) => { const { settings } = await chrome.storage.local.get('settings'); settings.server = { url: b, telemetry: true }; await chrome.storage.local.set({ settings }); }, base);
      const cfg = await w.evaluate(() => fetchServerConfig());
      assert.strictEqual(cfg.latestVersion, '0.0.1');
      await w.evaluate(async () => { for (let i = 0; i < 3; i++) await queueHealth({ v: '2.0.0', kind: 'list', list: 'done' }); return flushHealth(); });
      const s = await (await fetch(base + '/v1/stats', { headers: { Authorization: 'Bearer e2e' } })).json();
      assert.ok(s.items.some((x) => x.key === 'v=2.0.0|list=done' && x.count === 3));
    });
    await step('중앙 서버: 암호화 백업 → 데이터 삭제 → 복원', async () => {
      const w = await sw(ctx);
      const id = new URL(w.url()).host;
      const p = await ctx.newPage();
      await p.goto(`chrome-extension://${id}/options/options.html`);
      await p.fill('#pass', 'e2e test passphrase');
      await p.click('#bkUp');
      await p.waitForFunction(() => /백업 완료|실패|없습니다/.test(document.getElementById('bkStatus').textContent), null, { timeout: 30000 });
      assert.match(await p.textContent('#bkStatus'), /백업 완료/);
      const files = fs.readdirSync(path.join(TMP, 'srv', 'backups')).flatMap((d) => fs.readdirSync(path.join(TMP, 'srv', 'backups', d)));
      const blob = fs.readFileSync(path.join(TMP, 'srv', 'backups', files.find((f) => f.endsWith('.bin')).slice(0, 2), files.find((f) => f.endsWith('.bin'))));
      assert.ok(!blob.includes(Buffer.from('테스트 상품')), '서버에는 평문이 없어야 함');
      const before = Object.keys((await w.evaluate(() => chrome.storage.local.get('orders'))).orders).length;
      await w.evaluate(() => chrome.storage.local.set({ orders: {} }));
      await p.click('#bkDown');
      await p.waitForFunction(() => /복원 완료|실패|없습니다|다르/.test(document.getElementById('bkStatus').textContent), null, { timeout: 30000 });
      assert.match(await p.textContent('#bkStatus'), /복원 완료/);
      const after = Object.keys((await w.evaluate(() => chrome.storage.local.get('orders'))).orders).length;
      assert.strictEqual(after, before);
      await p.close();
    });
  }
  await ctx.close();

  // 실제 다시 로드(chrome.runtime.reload)는 --load-extension 으로 띄운 테스트 브라우저에서 확장이 복구되지 않아
  // 여기서는 "디스크의 새 버전 감지 → 다시 로드 결정"까지 검증한다.
  await step('자동 업데이트: 디스크의 새 버전 감지 → 다시 로드 결정', async () => {
    const copy = path.join(TMP, 'ext-copy');
    fs.cpSync(EXT, copy, { recursive: true });
    const c2 = await launch(copy, path.join(TMP, 'profile2'));
    const w1 = await sw(c2);
    const v1 = await w1.evaluate(() => chrome.runtime.getManifest().version);
    const mf = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json'), 'utf8'));
    mf.version = v1.split('.').map((x, i) => (i === 2 ? String(+x + 1) : x)).join('.');
    fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(mf, null, 2));
    const r = await w1.evaluate(() => checkSelfReload(true));
    assert.deepStrictEqual({ running: r.running, disk: r.disk, reload: r.reload }, { running: v1, disk: mf.version, reload: true });
    const same = await w1.evaluate(async () => { const m = chrome.runtime.getManifest(); return cmpVersion(m.version, m.version); });
    assert.strictEqual(same, 0);
    await c2.close();
  });

  srv.close();
  if (goSrv) goSrv.kill();
  const fail = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
