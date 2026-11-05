// 알리 주문 통계 - 주문 상세·배송 조회 정보 가져오기
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/* ---------------------------- 주문 상세·배송 조회 API 직접 호출 ---------------------------- */
// 상세·배송 조회 페이지는 HTML 의 window._page_config_.prefetch 로 API 를 부른다. 같은 형식으로 현재 페이지의 lib.mtop 에서 호출하므로 탭이 필요 없다.
// 호출이 실패하거나 응답에서 값을 읽지 못한 주문만 백그라운드 탭으로 처리한다 (느리지만 화면까지 읽을 수 있음).
function aepCookie(key) {
  const c = document.cookie.match(/(?:^|;\s*)aep_usuc_f=([^;]*)/);
  const m = c && c[1].match(new RegExp('(?:^|&)' + key + '=([^&]*)'));
  return m ? m[1] : '';
}
const shipCountry = () => { const r = aepCookie('region') || 'US'; return r === 'CN' ? 'US' : r; };
function gmtOffset() {
  const min = -new Date().getTimezoneOffset(), abs = Math.abs(min);
  return `GMT${min >= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
function detailOpts(id) {
  const tz = new Date().toString().match(/([A-Z]+[+-][0-9]+)/);
  return {
    api: 'mtop.aliexpress.trade.buyer.order.detail', method: 'GET', v: '1.0', needLogin: true, timeout: 15000, dataType: 'originaljsonp',
    data: { tradeOrderId: id, clientPlatform: 'pc', shipToCountry: shipCountry(), _lang: aepCookie('b_locale') || 'en_US', timeZone: tz ? tz[1] : undefined }
  };
}
function trackOpts(id) {
  const language = (aepCookie('b_locale') || '').split('_')[0] || 'en';
  return {
    api: 'mtop.ae.ld.querydetail', type: 'GET', v: '1.0', needLogin: true, timeout: 15000, dataType: 'originaljsonp',
    data: { tradeOrderId: id, terminalType: 'PC', needPageDisplayInfo: true, timeZone: gmtOffset(), __inline: 'true', _lang: `${language}_${shipCountry()}`, _currency: aepCookie('c_tp') || 'USD' }
  };
}

async function callDirect(id, track) {
  const opts = track ? trackOpts(id) : detailOpts(id);
  const r = await libCall(opts);
  if (!r.ok || !isOk(r.json)) { const why = errText(r); return { ok: false, why, captcha: AES.isCaptcha(why + ' ' + JSON.stringify((r.json && r.json.data) || '').slice(0, 300)) || (why === 'timeout' && captchaVisible()) }; }   // 인증 창 없는 시간 초과는 5분을 기다리지 않고 탭으로 넘긴다
  const caps = [{ url: 'lib:' + opts.api, text: JSON.stringify(r.json) }];
  return { ok: true, opts, res: AES.extractDetail(id, [], caps, { ref: new Date(), track: !!track }) };
}

/** 호출 1회. 보안 인증이면 끝날 때까지 기다렸다가 다시 시도한다 */
async function directOne(id, track) {
  let r = null;
  try { r = await callDirect(id, track); } catch (_) {}
  if (!r || r.ok || !r.captcha || state.cancelDetail) return r;
  const w = await waitCaptcha(async () => { const x = await callDirect(id, track); return x.ok ? { json: x, ok: true } : x; }, 'detail');
  return { ...(w.json || r), sawCaptcha: true };
}

/**
 * 주문들을 직접 호출로 읽는다. 첫 호출로 API 가 동작하는지 확인하고, 실패하면 나머지는 부르지 않는다.
 * 값을 읽은 주문만 반영해 시각을 남기므로, 나머지는 탭으로 읽지 못해도 다음 갱신 때 다시 시도한다.
 * 반환: rest(탭으로 넘길 주문), captcha(보안 인증을 만남 → 탭을 열지 않고 다음 갱신 때 다시 받는다)
 */
async function runDirect(kind, ids, usable, apply, bump) {
  if (AES.EXTRA.flags.disableFastDetail) { state.fast[kind] = 'tabs:disabled'; return { rest: ids.slice(), captcha: false }; }
  if (state.captchaOut) return { rest: ids.slice(), captcha: true };           // 이번 갱신에서 이미 인증을 기다리다 포기함
  await refreshLibInfo();
  if (!state.libInfo || !state.libInfo.hooked) { state.fast[kind] = 'fail:no-lib'; return { rest: ids.slice(), captcha: false }; }
  const rest = [];
  let captcha = false;
  const one = async (id) => {
    if (state.captchaOut) { rest.push(id); return null; }
    const r = await directOne(id, kind === 'track');
    if (r && r.sawCaptcha) { captcha = true; if (!r.ok) state.captchaOut = true; }
    if (!r || !r.ok) { rest.push(id); return r ? r.why : 'exception'; }
    if (usable(id, r.res)) { apply(id, r); bump(); } else rest.push(id);
    return null;
  };
  const failure = await one(ids[0]);
  if (failure) { state.fast[kind] = `fail:first(${String(failure).slice(0, 40)})`; return { rest: ids.slice(), captcha }; }
  await pool(ids.slice(1), 6, async (id) => { await one(id); });
  state.fast[kind] = rest.length ? `direct(${ids.length - rest.length}/${ids.length})` : 'direct';
  return { rest, captcha };
}

function applyDetail(id, res) {
  const o = { id, source: 'detail', detailAt: Date.now(), detailRaw: { relevant: (res.apiLines || []).filter((l) => /\d/.test(l) && /(배송|도착|예상|예정|결제|운송장|송장|delivery|deliver|arriv|estimat|payment|tracking)/i.test(l)).slice(0, 25), head: [] } };
  if (res.eta) { o.eta = res.eta; o.etaSrc = 'detail'; }
  if (res.tracking) o.track = res.tracking;
  o.payAt = Date.now();                                  // 결제수단을 찾아봤다는 표시 (못 찾아도 하루 동안은 다시 읽지 않는다)
  if (res.payment) o.payment = res.payment;
  if (res.protectEnd) o.protectEnd = res.protectEnd;
  if (res.items && res.items.length) o.items = res.items.map((i) => ({ id: i.id, eta: i.eta }));
  if (state.orders[id]) ingest([o]);
}

function tabFetch(ids, kind) {
  return new Promise((resolve) => {
    state.detail.base = state.detail.done;
    state.tabResolve = resolve;
    try { chrome.runtime.sendMessage({ type: 'fetchDetails', orderIds: ids, kind: kind || 'detail' }); } catch (e) { state.tabResolve = null; resolve(); }
  });
}

async function fetchDetails(force) {
  if (state.detail || state.detailBusy) { state.detailRerun = true; return; }     // 진행 중이면 끝난 뒤 새로 발견된 주문도 이어서 처리
  state.cancelDetail = false; state.detailBusy = true;
  try {
    do { state.detailRerun = false; state.detailMiss = 0; state.captchaOut = false; await fetchDetailsOnce(force); if (!state.cancelDetail) await fetchTrackingOnce(force); force = false; } while (state.detailRerun && !state.cancelDetail);
  } finally {
    state.detailBusy = false;
    const miss = state.detailMiss || 0;
    state.progressDetail = state.cancelDetail ? '배송 현황 새로고침 중단됨' : `배송 현황 새로고침 완료${miss ? ` (상세에 날짜가 없는 주문 ${miss}건)` : ''}`;
    render();
  }
}

async function fetchDetailsOnce(force) {
  const s = AES.computeStats(state.orders, {});
  const ids = [...new Set(s.inProgress.map((r) => r.orderId))].filter((id) => force || !(state.orders[id] && state.orders[id].detailAt && Date.now() - state.orders[id].detailAt < 6 * 3600 * 1000));
  // 환불 진행·완료 주문은 결제수단만 보려고 한 번 읽는다 (탭을 열어서까지 읽지는 않는다)
  const extra = new Set();
  if (!AES.EXTRA.flags.disableFastDetail) for (const r of s.refunds) if (r.state !== 'none' && !ids.includes(r.orderId)) { const o = state.orders[r.orderId]; if (o && !o.payment && !(o.payAt && Date.now() - o.payAt < 24 * 3600 * 1000)) { ids.push(r.orderId); extra.add(r.orderId); } }
  const mainTotal = ids.length - extra.size;
  if (!ids.length) { if (force) { state.progressDetail = '새로고침할 배송 대기·진행 주문이 없습니다'; render(); } return; }
  const total = ids.length;
  state.detail = { done: 0, total, running: true, base: 0 };
  const bump = () => { state.detail.done++; state.progressDetail = `배송 현황 새로고침 중… ${state.detail.done}/${total}`; scheduleRender(); };
  state.progressDetail = `배송 현황 새로고침 중… 0/${total}`; render();
  try {
    // 환불 주문은 결제수단이 없어도 한 번 읽은 것으로 친다 (탭을 열지 않으므로)
    const { rest, captcha } = await runDirect('detail', ids, (id, res) => extra.has(id) || !!res.eta, (id, r) => applyDetail(id, r.res), bump);
    const tabs = rest.filter((id) => !extra.has(id));
    for (const id of rest) if (extra.has(id)) { bump(); if (!captcha) ingest([{ id, source: 'detail', payAt: Date.now() }]); }   // 호출이 실패해도 목록 페이지마다 다시 부르지 않게 시각을 남긴다
    if (tabs.length && !state.cancelDetail && !captcha) await tabFetch(tabs);
  } finally {
    state.detail = null;
    const miss = AES.computeStats(state.orders, {}).etaMissingOrders.length;
    noteHealth('detail', { total: mainTotal, found: mainTotal - Math.min(mainTotal, miss) });
    state.detailMiss = miss;
    state.progressDetail = state.cancelDetail ? '배송 현황 새로고침 중단됨' : '예상 배송일 확인 완료';      // 이어서 운송장 조회가 있으므로 임시 문구
    render();
  }
}

/** 배송 조회는 구조를 아직 다 몰라서, 진단용으로 화면 줄·응답 문구·호출한 API 를 조금 남긴다 (디버그 파일에서 확인) */
function trackDiagOf(res, reqs) {
  return {
    lines: res.rawLines.slice(0, 80).map((l) => String(l).slice(0, 120)),
    api: res.apiLines.filter((l) => /(배송|배달|완료|도착|운송장|통관|출고|delivered|deliver|tracking|logistic|status)/i.test(l)).slice(0, 60).map((l) => String(l).slice(0, 160)),
    reqs: reqs.map((r) => ({ api: r.api, data: (() => { try { return JSON.stringify(r.opts.data).slice(0, 200); } catch (_) { return ''; } })() })).slice(0, 12)
  };
}

/** 배송 조회 결과 반영: 운송장 번호와 배송 이벤트. 못 읽어도 시각은 남겨 같은 주문을 계속 다시 읽지 않는다 */
function applyTracking(id, res, via) {
  const o = { id, source: 'detail', trackAt: Date.now(), trackV: 2, trackVia: via };
  if (res.tracking) o.track = res.tracking;
  if (res.raw) o.trackRaw = res.raw;
  if (res.payment) o.payment = res.payment;
  if (state.orders[id]) ingest([o]);
}

const TRACK_FRESH_MS = 3 * 3600 * 1000, TRACK_FRESH_TAB_MS = 6 * 3600 * 1000;   // 탭으로만 읽히면 부담이 커서 간격을 늘린다
const trackFreshMs = (o) => (o.trackVia === 'tab' ? TRACK_FRESH_TAB_MS : TRACK_FRESH_MS);
/** 배송 중인 주문의 운송장 번호와 최신 배송 이벤트를 읽는다 (합배송 묶기, 도착 여부 판단에 사용) */
async function fetchTrackingOnce(force) {
  const s = AES.computeStats(state.orders, {});
  const ids = [...new Set(s.inProgress.filter((r) => r.status === 'shipping').map((r) => r.orderId))]
    .filter((id) => { const o = state.orders[id]; return force || !(o && o.trackV === 2 && o.trackAt && Date.now() - o.trackAt < trackFreshMs(o)); });
  if (!ids.length) return;
  const total = ids.length;
  state.detail = { done: 0, total, running: true, base: 0 };
  const bump = () => { state.detail.done++; state.progressDetail = `운송장·배송 조회 중… ${state.detail.done}/${total}`; scheduleRender(); };
  state.progressDetail = `운송장·배송 조회 중… 0/${total}`; render();
  try {
    const applyDirect = (id, r) => applyTracking(id, { tracking: r.res.tracking, payment: r.res.payment, raw: trackDiagOf(r.res, [{ api: r.opts.api, opts: r.opts }]) }, 'direct');
    const { rest, captcha } = await runDirect('track', ids, (id, res) => !!(res.tracking && (res.tracking.no || res.tracking.delivered)), applyDirect, bump);
    if (!rest.length || state.cancelDetail || captcha) return;
    // 탭 대체: 최대 3건까지 읽어 보고, 어느 주문에서도 운송장을 못 읽으면 나머지 주문의 탭은 열지 않는다
    if (force) state.trackTabsDead = false;                                 // 사용자가 새로고침을 누르면 다시 시도
    state.trackGot = 0;
    const queue = rest.slice();
    for (let i = 0; i < 3 && queue.length && !state.cancelDetail && !state.trackGot && !state.trackTabsDead; i++) await tabFetch([queue.shift()], 'track');
    if (!state.trackGot) {
      state.trackTabsDead = true;                                           // 목록 페이지마다 다시 불려도 이 접속에서는 또 탭을 열지 않는다
      state.fast.track += ' → fail:no-tracking';
      if (!state.cancelDetail) for (const id of queue) applyTracking(id, {}, 'tab');   // 다음 접속에서도 간격을 두도록 시각을 남긴다
    } else if (queue.length && !state.cancelDetail) await tabFetch(queue, 'track');
  } finally {
    state.detail = null;
    render();
  }
}

/** background 와의 메시지 (상세 탭 결과/진행률) */
function initDetailsMessages() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'detail' && msg.kind === 'track') {
      // 배송 조회 화면 탭의 결과: 운송장·배송 이벤트만 반영
      if (msg.tracking && (msg.tracking.no || msg.tracking.delivered)) state.trackGot = (state.trackGot || 0) + 1;
      applyTracking(msg.orderId, { tracking: msg.tracking, payment: msg.payment, raw: msg.raw }, 'tab');
    } else if (msg.type === 'detail') {
      const o = { id: msg.orderId, source: 'detail', detailAt: Date.now(), detailRaw: msg.raw || null };
      if (msg.eta) { o.eta = msg.eta; o.etaSrc = 'detail'; }
      if (msg.tracking) o.track = msg.tracking;
      o.payAt = Date.now();
      if (msg.payment) o.payment = msg.payment;
      if (msg.protectEnd) o.protectEnd = msg.protectEnd;
      if (msg.items && msg.items.length) o.items = msg.items.map((i) => ({ id: i.id, eta: i.eta }));
      if (state.orders[msg.orderId]) ingest([o]);
    } else if (msg.type === 'detailProgress') {
      if (state.detail) { state.detail.done = (state.detail.base || 0) + msg.done; state.progressDetail = `배송 현황 새로고침 중… ${state.detail.done}/${state.detail.total}`; scheduleRender(); }
    } else if (msg.type === 'detailDone') {
      const f = state.tabResolve; state.tabResolve = null; if (f) f();
    }
  });
}
