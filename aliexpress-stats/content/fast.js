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
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length && !state.cancel && !state.cancelDetail) await fn(q.shift()); }));
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

/** 화면 조작/이미지 로딩 없이 다음 페이지들을 페이지 자신의 mtop 클라이언트로 직접 요청. 성공 시 'done', 실패 시 사유 문자열 */
async function loadAllFast() {
  if (!(state.meta && state.meta.hasMore)) return 'done';
  if (AES.EXTRA.flags.disableFastList) return 'fail:disabled-by-config';
  const early0 = shouldStop(state.lastPageOrders);               // 첫 페이지만으로 충분하면 추가 요청 없이 종료
  if (early0) { state.endReason = early0; return 'done'; }
  await refreshLibInfo();
  if (!state.libInfo || !state.libInfo.hooked) return 'fail:no-lib(' + (state.libInfo ? `lib=${state.libInfo.hasLib} mtop=${state.libInfo.hasMtop} request=${state.libInfo.requestType}` : 'noinfo') + ')';

  // 요청 1회 + 새 주문 확인. 성공하면 응답 JSON, 실패하면 null
  async function callList(opts) {
    const known = new Set(state.sessionIds);          // 이번 접속에서 목록 응답으로 받은 주문 (저장소의 이전 데이터와 무관하게 판단)
    const r = await libCall(opts);
    if (!r.ok || !isOk(r.json)) { state.fast.listWhy = 'api:' + errText(r); return null; }
    const os = hookOrders(r.json);
    if (!os.some((o) => !known.has(o.id))) { state.fast.listWhy = 'norepeat'; return null; }
    return r.json;
  }

  let tpl = null, dataCur = '', prev = null, cur = null, learnPrevTokens = null, saveAfter = false;
  state.endReason = '';
  const early = shouldStop(state.lastPageOrders);               // 첫 페이지만으로 충분하면 추가 요청 없이 종료
  if (early) { state.endReason = early; return 'done'; }

  // (0) 같은 접속에서 이전에 이어받던 체인이 있으면 이어서 계속 (기간을 늘렸을 때)
  if (state.chain && state.meta.hasMore) ({ tpl, dataCur, prev, cur } = state.chain);

  // (1) 저장된 요청 형식이 있으면 "주문 더 보기" 클릭 없이 바로 2페이지 요청 (1페이지 응답의 토큰으로 갱신)
  const saved = state.settings.listTpl;
  if (!tpl && saved && saved.opts && saved.prevTokens && state.meta.pageIndex <= 1 && state.listResps.length) {
    const first = state.listResps[state.listResps.length - 1];
    const dataFirst = replaceTokens(dataToStr(saved.opts.data), saved.prevTokens, tokensOf(first));
    let json = null;
    try { json = await callList({ ...saved.opts, data: strToData(saved.opts.data, dataFirst) }); } catch (_) {}
    if (json) { tpl = saved.opts; dataCur = dataFirst; prev = first; cur = json; state.fast.listTpl = 'saved'; state.lastPageOrders = hookOrders(json); }
    else { state.settings.listTpl = null; store.save(); state.fast.listTpl = 'saved-failed(' + state.fast.listWhy + ')'; }
    if (json) { const w = shouldStop(state.lastPageOrders); if (w) { state.endReason = w; state.chain = { tpl, dataCur, prev, cur }; return 'done'; } }
  }

  // (2) 없으면 "주문 더 보기"를 딱 한 번만 눌러 2페이지 요청 형식을 학습
  if (!tpl) {
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
    tpl = reqs[reqs.length - 1].opts;
    dataCur = dataToStr(tpl.data);
    prev = state.listResps[state.listResps.length - 2]; cur = state.listResps[state.listResps.length - 1];
    learnPrevTokens = tokensOf(prev); saveAfter = true; state.fast.listTpl = 'learned';
    state.settings.listTpl = { opts: tpl, prevTokens: learnPrevTokens }; store.save();   // 바로 저장 (다음 접속에서 실패하면 자동으로 지우고 재학습)
    const w = shouldStop(state.lastPageOrders);
    if (w) { state.endReason = w; state.chain = { tpl, dataCur, prev, cur }; return 'done'; }
  }

  // (3) 나머지 페이지: 응답마다 토큰을 갱신하며 이어서 요청 (기간/저장된 범위에 도달하면 중단)
  for (let i = 0; i < 500 && state.meta.hasMore && !state.cancel; i++) {
    const dataNext = bumpPage(replaceTokens(dataCur, tokensOf(prev), tokensOf(cur)));
    let optsNext;
    try { optsNext = { ...tpl, data: strToData(tpl.data, dataNext) }; } catch (e) { return 'fail:data-parse'; }
    const json = await callList(optsNext);
    if (!json) return 'fail:' + state.fast.listWhy;
    state.lastPageOrders = hookOrders(json);
    if (saveAfter) { state.settings.listTpl = { opts: tpl, prevTokens: learnPrevTokens }; store.save(); saveAfter = false; }  // 한 번 검증된 형식만 저장
    prev = cur; cur = json; dataCur = dataNext;
    state.chain = { tpl, dataCur, prev, cur };
    state.progress = `목록 불러오는 중(빠른 모드)… ${Object.keys(state.orders).length}건`;
    scheduleRender();
    fetchDetails(false);                          // 새로 발견된 배송 대기·진행 주문의 예상 배송일 조회를 목록 로딩과 동시에 진행
    const why = shouldStop(state.lastPageOrders);
    if (why) { state.endReason = why; return 'done'; }
  }
  return state.cancel ? 'cancel' : 'done';
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
  let key = state.settings.period || '1w';
  if (opts.background && needsConfirm(key)) key = '1w';                // 백그라운드 갱신: 경고창 없이 저장된 범위의 추가분만
  else if (!opts.confirmed && needsConfirm(key) && !confirmHeavy(periodInfo(key)[1])) {
    if (!opts.auto) { state.progress = '취소됨'; render(); return; }
    state.settings.period = key = '1w'; store.save();              // 자동 실행에서 거절하면 기본값(1주일)으로 진행
  }
  const info = periodInfo(key), cutoff = cutoffOf(key), covered = coversCutoff(cutoff);
  state.cut = { cutoff, covered };
  state.loading = true; state.cancel = false; state.endReason = '';
  state.progress = covered ? `${info[1]} · 저장된 내역 이후 추가분 확인 중…` : `${info[1]} 주문 목록 불러오는 중…`; render();
  for (let i = 0; i < 30 && !state.counts; i++) await sleep(50);   // 배송 중 주문 수(알리 집계)가 필요한 판단이 있어 잠깐 대기
  let stall = 0, why = '완료';
  let fastRes = 'skip';
  try { fastRes = await loadAllFast(); } catch (e) { fastRes = 'fail:exception ' + e.message; }
  state.fast.list = fastRes;
  noteHealth('list', { code: fastRes });
  if (fastRes === 'done') why = '완료(빠른 모드)';
  else if (fastRes !== 'cancel') { state.progress = `빠른 모드 실패(${fastRes}) → 화면 방식으로 전환`; render(); }
  for (let i = 0; i < 400 && !state.cancel && fastRes !== 'done' && fastRes !== 'cancel'; i++) {
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
  state.loading = false;
  if (fastRes !== 'done') window.scrollTo(0, 0);
  const finishedOk = !state.cancel && (fastRes === 'done' || why === '완료' || (state.meta && state.meta.hasMore === false) || state.endReason);
  if (finishedOk) updateCoverage(state.endReason);
  store.flush();
  state.progress = state.cancel ? '중단됨' : `${info[1]} ${state.endReason === 'incremental' ? '추가분 확인' : '목록'} ${why} · 총 ${Object.keys(state.orders).length}건 저장됨`;
  render();
  if (!state.cancel) fetchDetails(false);
}
