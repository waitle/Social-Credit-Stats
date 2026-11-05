// 알리 주문 통계 - 목록 불러오기: 빠른 모드(페이지 mtop 클라이언트 재사용) / 화면 방식 대체
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/* ---------------------------- 네트워크 직접 호출 (페이지의 lib.mtop 클라이언트 이용) ---------------------------- */
const pendingCalls = new Map();
let callSeq = 0;
/** 페이지의 lib.mtop.request 를 opts 그대로 호출 → { ok, json } (서명/토큰/보안 처리는 페이지 클라이언트가 수행) */
function libCall(opts) {
  return new Promise((resolve) => {
    const id = ++callSeq;
    const timer = setTimeout(() => { pendingCalls.delete(id); resolve({ ok: false, json: { error: 'timeout' } }); }, 25000);
    pendingCalls.set(id, (d) => { clearTimeout(timer); pendingCalls.delete(id); resolve(d); });
    window.postMessage({ source: 'aes-mtop', id, opts }, '*');
  });
}
const isOk = (j) => !!(j && Array.isArray(j.ret) && /^SUCCESS/i.test(j.ret[0] || ''));
const errText = (r) => { const j = r && r.json; return (j && j.ret && j.ret[0]) || (j && j.error) || (j && j.message) || 'no-response'; };
async function pool(list, n, fn) {
  const q = list.slice();
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length && !state.cancelDetail) await fn(q.shift()); }));
}

/** 페이지의 lib.mtop 후킹 상태를 즉시 확인 (최대 3초 대기) */
async function refreshLibInfo() {
  for (let i = 0; i < 60; i++) {
    state.libInfo = null;
    window.postMessage({ source: 'aes-libinfo-req' }, '*');
    for (let w = 0; w < 10 && !state.libInfo; w++) await sleep(10);
    if (state.libInfo && state.libInfo.hooked) return;
    await sleep(50);                            // lib 가 아직 로드되지 않았을 수 있으니 잠깐씩 재확인
  }
}
const hookOrders = (json) => onHook('fast:list', JSON.stringify(json));
const dataToStr = (d) => (typeof d === 'string' ? d : JSON.stringify(d));
const strToData = (like, str) => (typeof like === 'string' ? str : JSON.parse(str));
function tokensOf(json) {
  const out = {};
  const lk = json && json.data && json.data.linkage;
  (function walk(n, p, d) {
    if (n == null || d > 6) return;
    if (typeof n === 'string') { if (n.length >= 6) out[p] = n; }
    else if (typeof n === 'object') for (const k of Object.keys(n)) walk(n[k], p + '/' + k, d + 1);
  })(lk, '', 0);
  return out;
}
const esc1 = (x) => JSON.stringify(x).slice(1, -1);
function replaceTokens(data, a, b) {
  for (const p of Object.keys(a)) {
    if (b[p] == null || b[p] === a[p]) continue;
    for (const f of [(x) => x, esc1, (x) => esc1(esc1(x))]) data = data.split(f(a[p])).join(f(b[p]));
  }
  return data;
}
const bumpPage = (data) => data.replace(/(pageIndex\\*"\s*:\s*\\*"?)(\d+)/g, (m, p, n) => p + (parseInt(n, 10) + 1));
const listReqs = () => state.reqLog.filter((r) => /order\.list/i.test(r.api));
const orderIdsOf = (json) => { try { return AES.extractFromJson(json, { ref: new Date() }).map((o) => o.id); } catch (_) { return []; } };

/** 알리 보안 확인(캡차) 창이 화면에 떠 있는가 (baxia/nocaptcha 계열 요소, 정확한 이름은 확인되지 않아 여러 후보를 본다) */
const captchaVisible = () => !!document.querySelector('#baxia-dialog-content, .baxia-dialog, #nocaptcha, .nc-container, iframe[src*="punish"], iframe[src*="captcha"], [id^="sufei-dialog"]');

/** 보안 인증 대기: 사용자가 인증을 마칠 때까지 간격을 늘려 가며 같은 요청을 다시 시도. again() → {json} | {why, captcha} */
async function waitCaptcha(again, label) {
  const poll = state.settings.captchaPollMs || null;                       // 테스트용으로 줄일 수 있음
  const limit = state.settings.captchaTimeoutMs || 5 * 60 * 1000;
  const steps = poll ? [poll] : [3000, 3000, 5000, 5000, 10000, 10000, 15000, 20000];
  const t0 = Date.now();
  const isDetail = label === 'detail';                                     // 상세 조회는 목록과 중단 버튼·진행 문구가 따로 있다
  const stopped = () => (isDetail ? state.cancelDetail : state.cancel);
  state.paused = { kind: 'captcha', since: t0 };
  try {
    for (let k = 0; Date.now() - t0 < limit && !stopped(); k++) {
      const left = Math.max(0, Math.round((limit - (Date.now() - t0)) / 1000));
      const msg = `보안 인증이 필요합니다 — 알리 페이지에서 인증을 완료하면 자동으로 이어집니다 (${left}초)`;
      if (isDetail) state.progressDetail = msg; else state.progress = msg;
      scheduleRender();
      await sleep(captchaVisible() ? Math.min(1500, steps[0]) : steps[Math.min(k, steps.length - 1)]);
      if (captchaVisible()) continue;                                      // 인증 창이 떠 있는 동안은 요청을 보내지 않는다
      const r = await again();
      if (r.json || r.ok) return r;
      if (!r.captcha) return r;                                            // 다른 종류의 실패로 바뀌었으면 호출한 쪽이 판단
    }
  } finally { state.paused = null; }
  return { why: 'captcha-timeout', captcha: true };
}

/** 화면 조작/이미지 로딩 없이 다음 페이지들을 페이지 자신의 mtop 클라이언트로 직접 요청.
 *  반환: 'done' | 'cancel' | 'paused:사유'(이미 받은 것을 유지한 채 멈춤, 이어서 불러오기 가능) | 'fail:사유'(처음부터 안 됨 → 화면 방식으로 전환) */
async function loadAllFast() {
  if (!(state.meta && state.meta.hasMore)) return 'done';
  if (AES.EXTRA.flags.disableFastList) return 'fail:disabled-by-config';
  state.endReason = '';
  const early0 = shouldStop(state.lastPageOrders);               // 첫 페이지만으로 충분하면 추가 요청 없이 종료
  if (early0) { state.endReason = early0; return 'done'; }
  await refreshLibInfo();
  if (!state.libInfo || !state.libInfo.hooked) return 'fail:no-lib(' + (state.libInfo ? `lib=${state.libInfo.hasLib} mtop=${state.libInfo.hasMtop} request=${state.libInfo.requestType}` : 'noinfo') + ')';

  /** 요청 1회 + 새 주문 확인 → { json, os } | { why, captcha } */
  async function callList(opts) {
    const known = new Set(state.sessionIds);          // 이번 접속에서 목록 응답으로 받은 주문 (저장소의 이전 데이터와 무관하게 판단)
    const r = await libCall(opts);
    if (!r.ok || !isOk(r.json)) {
      const why = errText(r);
      const detail = why + ' ' + JSON.stringify((r.json && (r.json.data || r.json.ret)) || '').slice(0, 300);
      state.fast.listWhy = 'api:' + why;
      return { why: 'api:' + why, captcha: AES.isCaptcha(detail) || why === 'timeout' };   // 시간 초과도 인증 창이 응답을 붙잡고 있는 경우가 많다
    }
    const os = hookOrders(r.json);
    if (!os.some((o) => !known.has(o.id))) { state.fast.listWhy = 'norepeat'; return { why: 'norepeat' }; }
    return { json: r.json, os };
  }

  /** 일시 오류는 몇 번 다시 시도하고, 보안 인증이면 끝날 때까지 기다린다 */
  async function fetchPage(opts) {
    if (captchaVisible()) { const w = await waitCaptcha(async () => ({ ok: true }), 'list'); if (w.why) return w; }
    let r = await callList(opts);
    for (let k = 0; !r.json && !r.captcha && r.why !== 'norepeat' && k < 2 && !state.cancel; k++) { await sleep(1500 * (k + 1)); r = await callList(opts); }
    if (!r.json && r.captcha && !state.cancel) r = await waitCaptcha(() => callList(opts), 'list');
    return r;
  }

  const mkChain = (tpl, dataCur, prev, cur) => ({ tpl, dataCur, prevT: tokensOf(prev), curT: tokensOf(cur) });
  let chain = null, progressed = false, learned = null, resumed = false;
  const fail = (why) => (progressed || resumed || state.chain ? 'paused:' + why : 'fail:' + why);

  /** 체인의 다음 페이지 1개 요청 → { json, os, dataNext } | { why, captcha } */
  async function step(use) {
    const dataNext = bumpPage(replaceTokens(use.dataCur, use.prevT, use.curT));
    let opts;
    try { opts = { ...use.tpl, data: strToData(use.tpl.data, dataNext) }; } catch (e) { return { why: 'data-parse' }; }
    const r = await fetchPage(opts);
    return r.json ? { ...r, dataNext } : r;
  }
  /** 받은 페이지를 상태에 반영하고 새 체인을 돌려준다 */
  function advance(use, r) {
    state.lastPageOrders = r.os; progressed = true;
    const next = { tpl: use.tpl, dataCur: r.dataNext, prevT: use.curT, curT: tokensOf(r.json) };
    state.chain = next;
    afterPage(next, r.os);
    state.progress = `목록 불러오는 중(빠른 모드)… ${Object.keys(state.orders).length}건`;
    scheduleRender();
    fetchDetails(false);                          // 새로 발견된 배송 대기·진행 주문의 예상 배송일 조회를 목록 로딩과 동시에 진행
    return next;
  }

  // 저장된 이어받기 지점(중단/인증 대기/기간 확장)으로 건너뛸 수 있는가:
  // 기간을 넓혀 더 오래된 내역이 필요하고, 새 주문을 모두 받았고(= 지금 페이지가 이미 아는 주문뿐), 저장 지점이 더 뒤에 있을 때
  let jumpTried = false;
  const resumePoint = () => { const rs = state.settings.resume; return rs && rs.tpl && rs.dataCur && rs.prevT && rs.curT ? rs : null; };
  const canJump = () => {
    const rs = resumePoint(); if (!rs || jumpTried) return false;
    if (state.cut.covered) return false;           // 저장된 범위 안(추가분 확인)에서는 건너뛰지 않는다: 사이에 있는 배송 중 주문의 상태도 갱신해야 하고, 더 오래된 내역은 필요 없다
    const pg = state.lastPageOrders || [];
    return pg.length > 0 && pg.every((o) => state.knownAtStart.has(o.id)) && rs.pageNo > (state.meta.pageIndex || 0);
  };
  const useOfResume = () => { const rs = resumePoint(); return { tpl: rs.tpl, dataCur: rs.dataCur, prevT: rs.prevT, curT: rs.curT }; };

  // (0) 같은 접속에서 이전에 이어받던 체인이 있으면 그대로 이어서 (기간을 늘렸거나 중단했다가 다시 시작)
  if (state.chain && state.meta.hasMore) chain = state.chain;

  // (0b) 이전 접속에서 중단된 지점이 저장돼 있으면 처음부터 다시 훑지 않고 그 지점부터 이어서
  if (!chain && canJump()) {
    jumpTried = true; resumed = true;
    const use = useOfResume();
    const r = await step(use);
    if (r.json) {
      state.fast.resumeJump = 'ok(p' + state.meta.pageIndex + ')';
      chain = advance(use, r);
      const w = shouldStop(state.lastPageOrders);
      if (w) { state.endReason = w; return 'done'; }
    } else if (state.cancel) return 'cancel';
    else if (r.captcha) return fail(r.why);                       // 인증이 필요한 것이지 지점이 틀린 게 아님 → 지점 유지
    else { state.settings.resume = null; store.save(); state.fast.resumeJump = 'failed(' + r.why + ')'; resumed = false; }   // 토큰이 만료됐으면 버리고 처음부터
  }

  // (1) 저장된 요청 형식이 있으면 "주문 더 보기" 클릭 없이 바로 2페이지 요청 (1페이지 응답의 토큰으로 갱신)
  const saved = state.settings.listTpl;
  if (!chain && saved && saved.opts && saved.prevTokens && state.meta.pageIndex <= 1 && state.listResps.length) {
    const first = state.listResps[state.listResps.length - 1];
    const dataFirst = replaceTokens(dataToStr(saved.opts.data), saved.prevTokens, tokensOf(first));
    let r = { why: 'exception' };
    try { r = await fetchPage({ ...saved.opts, data: strToData(saved.opts.data, dataFirst) }); } catch (_) {}
    if (r.json) { chain = mkChain(saved.opts, dataFirst, first, r.json); state.fast.listTpl = 'saved'; state.lastPageOrders = r.os; progressed = true; afterPage(chain, r.os); }
    else if (r.captcha || state.cancel) return state.cancel ? 'cancel' : fail(r.why);          // 템플릿이 틀린 게 아니라 인증이 필요한 것 → 템플릿 유지
    else { state.settings.listTpl = null; store.save(); state.fast.listTpl = 'saved-failed(' + r.why + ')'; }
    if (r.json) { const w = shouldStop(state.lastPageOrders); if (w) { state.endReason = w; state.chain = chain; return 'done'; } }
  }

  // (2) 없으면 "주문 더 보기"를 딱 한 번만 눌러 2페이지 요청 형식을 학습
  if (!chain) {
    let reqs = listReqs();
    if (reqs.length < 2) {
      const before = reqs.length;
      const btn = findMoreButton();
      if (!btn) return 'fail:button';
      const at = state.listAt;
      btn.scrollIntoView({ block: 'center' }); btn.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 12000 && state.listAt === at) await sleep(40);
      await sleep(80);
      reqs = listReqs();
      if (reqs.length <= before) return 'fail:learn(요청 ' + reqs.length + '개)';
    }
    if (state.listResps.length < 2) return 'fail:resps';
    const tpl = reqs[reqs.length - 1].opts;
    const prev = state.listResps[state.listResps.length - 2], cur = state.listResps[state.listResps.length - 1];
    chain = mkChain(tpl, dataToStr(tpl.data), prev, cur);
    learned = { opts: tpl, prevTokens: tokensOf(prev) }; state.fast.listTpl = 'learned';
    state.settings.listTpl = learned; store.save();   // 바로 저장 (다음 접속에서 실패하면 자동으로 지우고 재학습)
    progressed = true; afterPage(chain, state.lastPageOrders);
    const w = shouldStop(state.lastPageOrders);
    if (w) { state.endReason = w; state.chain = chain; return 'done'; }
  }

  // (3) 나머지 페이지: 응답마다 토큰을 갱신하며 이어서 요청 (기간/저장된 범위에 도달하면 중단)
  for (let i = 0; i < 800 && state.meta.hasMore && !state.cancel; i++) {
    let use = chain, jumping = false;
    if (canJump()) { jumpTried = true; use = useOfResume(); jumping = true; }   // 새 주문을 다 받아 아는 페이지에 닿았으면 저장 지점으로 건너뜀
    const r = await step(use);
    if (!r.json) {
      if (state.cancel) return 'cancel';
      if (jumping && !r.captcha) { state.settings.resume = null; store.save(); state.fast.resumeJump = 'failed(' + r.why + ')'; continue; }   // 저장 지점이 만료됐으면 버리고 차례대로 계속
      return fail(r.why);
    }
    if (jumping) state.fast.resumeJump = 'ok(p' + state.meta.pageIndex + ')';
    chain = advance(use, r);
    if (learned) { state.settings.listTpl = learned; learned = null; }
    const why = shouldStop(state.lastPageOrders);
    if (why) { state.endReason = why; return 'done'; }
  }
  return state.cancel ? 'cancel' : 'done';
}

/** 페이지를 하나 받을 때마다: 이어받기 지점 저장 + 저장 범위(coverage)를 그만큼 넓힘.
 *  최신 주문부터 차례로 받았으므로 "이 페이지의 가장 오래된 날짜 이후"는 모두 받은 상태다. */
function afterPage(chain, pageOrders) {
  state.chain = chain;
  if (state.meta && state.meta.hasMore === false) { state.settings.resume = null; store.save(); return; }
  const dates = (pageOrders || []).map((o) => (o.date || '').slice(0, 10)).filter(Boolean).sort();
  const oldest = dates[0] || null;
  state.settings.resume = { tpl: chain.tpl, dataCur: chain.dataCur, prevT: chain.prevT, curT: chain.curT, pageNo: state.meta ? state.meta.pageIndex || 0 : 0, oldest, at: Date.now() };
  if (oldest) mergeCoverage(addDaysISO(oldest, 1));
  store.save();
}

/* ---------------------------- "주문 더 보기" 반복 클릭 (느린 방식, 빠른 방식 실패 시 대체) ---------------------------- */
const MORE_RE = /^(더\s?보기|주문\s?더\s?보기|더\s?많은\s?주문.*|view\s?more.*|show\s?more.*|load\s?more.*|see\s?more.*|more orders|view orders)$/i;
function findMoreButton() {
  const exact = state.meta && state.meta.moreText ? state.meta.moreText.trim() : '';
  const cands = [];
  for (const el of document.querySelectorAll('button, [role="button"], a, div, span')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 30) continue;
    if (!(exact && t === exact) && !MORE_RE.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    cands.push({ el, exactHit: !!(exact && t === exact), btn: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' });
  }
  if (!cands.length) return null;
  const pool = cands.some((c) => c.exactHit) ? cands.filter((c) => c.exactHit) : cands;
  return (pool.find((c) => c.btn) || pool[pool.length - 1]).el;
}

/** opts.auto: 페이지를 열 때 자동 실행 / opts.confirmed: 이미 경고를 확인함 */
async function loadAll(opts = {}) {
  if (state.loading) return;
  releaseHold();
  let key = state.settings.period || '1w';
  if (opts.background && needsConfirm(key)) key = '1w';                // 백그라운드 갱신: 경고창 없이 저장된 범위의 추가분만
  else if (!opts.confirmed && needsConfirm(key) && !confirmHeavy(periodInfo(key)[1])) {
    if (!opts.auto) { state.progress = '취소됨'; render(); return; }
    state.settings.period = key = '1w'; store.save();              // 자동 실행에서 거절하면 기본값(1주일)으로 진행
  }
  const info = periodInfo(key), cutoff = cutoffOf(key), covered = coversCutoff(cutoff);
  state.cut = { cutoff, covered };
  state.loading = true; state.cancel = false; state.endReason = '';
  const rs = state.settings.resume;
  state.progress = covered ? `${info[1]} · 저장된 내역 이후 추가분 확인 중…` : rs && rs.oldest ? `${info[1]} 주문 목록 이어서 불러오는 중… (${rs.oldest} 이전부터)` : `${info[1]} 주문 목록 불러오는 중…`; render();
  for (let i = 0; i < 30 && !state.counts; i++) await sleep(50);   // 배송 중 주문 수(알리 집계)가 필요한 판단이 있어 잠깐 대기
  let stall = 0, why = '완료';
  let fastRes = 'skip';
  try { fastRes = await loadAllFast(); } catch (e) { fastRes = 'fail:exception ' + e.message; }
  state.fast.list = fastRes;
  const paused = /^paused:/.test(fastRes);
  if (!paused && fastRes !== 'cancel') noteHealth('list', { code: fastRes });
  if (fastRes === 'done') why = '완료(빠른 모드)';
  else if (paused) why = '일시정지';
  else if (fastRes !== 'cancel') { state.progress = `빠른 모드 실패(${fastRes}) → 화면 방식으로 전환`; render(); }
  // 빠른 모드로 이미 받던 중이면 화면 방식으로 바꾸지 않는다 (같은 페이지를 처음부터 다시 훑게 되므로). 이어서 불러오기로 계속한다.
  for (let i = 0; i < 400 && !state.cancel && fastRes !== 'done' && fastRes !== 'cancel' && !paused; i++) {
    if (state.meta && state.meta.hasMore === false) break;                  // 마지막 페이지까지 로드됨
    const stop = shouldStop(state.lastPageOrders);
    if (stop) { state.endReason = stop; break; }
    const beforeN = Object.keys(state.orders).length, beforeAt = state.listAt;
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(350);
    const btn = findMoreButton();
    if (!btn) {
      if (++stall >= 4) { why = '"주문 더 보기" 버튼을 찾지 못해 중단'; break; }
      await sleep(900); continue;
    }
    btn.scrollIntoView({ block: 'center' }); await sleep(200);
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && state.listAt === beforeAt && !state.cancel) {
      await sleep(250);
      if (Object.keys(state.orders).length > beforeN) break;
    }
    await sleep(600); scanDom();
    const n = Object.keys(state.orders).length;
    state.progress = `주문 목록 불러오는 중… ${n}건 수집`;
    render();
    if (n === beforeN && state.listAt === beforeAt) { if (++stall >= 3) { why = '더 이상 새 주문이 로드되지 않아 중단'; break; } } else stall = 0;
  }
  state.loading = false; state.paused = null;
  if (fastRes !== 'done' && !paused) window.scrollTo(0, 0);
  const finishedOk = !state.cancel && !paused && (fastRes === 'done' || why === '완료' || (state.meta && state.meta.hasMore === false) || state.endReason);
  if (finishedOk) updateCoverage(state.endReason);
  store.flush();
  const nSaved = Object.keys(state.orders).length, r2 = state.settings.resume;
  if (paused) {
    const reason = /captcha/i.test(fastRes) ? '보안 인증이 필요합니다. 알리 페이지에서 인증을 완료한 뒤 "이어서 불러오기"를 누르세요' : `오류로 멈췄습니다 (${fastRes.slice(7, 70)}). "이어서 불러오기"로 다시 시도하세요`;
    state.progress = `${reason} · ${nSaved}건 저장됨${r2 && r2.oldest ? `, ${r2.oldest}까지` : ''}`;
  } else if (state.cancel) {
    state.progress = `중단됨 · ${nSaved}건 저장됨${r2 && r2.oldest ? `, ${r2.oldest}까지` : ''} — "이어서 불러오기"로 계속할 수 있습니다`;
  } else state.progress = `${info[1]} ${state.endReason === 'incremental' ? '추가분 확인' : '목록'} ${why} · 총 ${nSaved}건 저장됨`;
  render();
  if (!state.cancel) fetchDetails(false);
}
