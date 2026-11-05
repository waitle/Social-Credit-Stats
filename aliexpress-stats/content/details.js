// 알리 주문 통계 - 주문 상세에서 예상 배송일 가져오기
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/* ---------------------------- 주문 상세에서 예상 배송일 가져오기 ---------------------------- */
// 1) 저장된/학습된 API 요청 형식이 있으면 탭 없이 직접 호출 (빠름)
// 2) 없으면 첫 주문만 백그라운드 탭으로 열어 요청 형식을 학습 → 검증 후 나머지는 직접 호출
// 3) 실패한 주문은 백그라운드 탭으로 처리 (느리지만 확실)
function applyDetail(id, res) {
  const o = { id, source: 'detail', detailAt: Date.now(), detailRaw: { relevant: (res.apiLines || []).filter((l) => /\d/.test(l) && /(배송|도착|예상|예정|결제|운송장|송장|delivery|deliver|arriv|estimat|payment|tracking)/i.test(l)).slice(0, 25), head: [] } };
  if (res.eta) { o.eta = res.eta; o.etaSrc = 'detail'; }
  if (res.tracking) o.track = res.tracking;
  o.payAt = Date.now();                                  // 결제수단을 찾아봤다는 표시 (못 찾아도 하루 동안은 다시 열지 않는다)
  if (res.payment) o.payment = res.payment;
  if (res.protectEnd) o.protectEnd = res.protectEnd;
  if (res.items && res.items.length) o.items = res.items.map((i) => ({ id: i.id, eta: i.eta }));
  if (state.orders[id]) ingest([o]);
}

async function replayDetail(tpls, fromId, toId) {
  const caps = [];
  for (const t of tpls) {
    const dataStr = dataToStr(t.opts.data).split(fromId).join(toId);
    let opts;
    try { opts = { ...t.opts, data: strToData(t.opts.data, dataStr) }; } catch (_) { return { ok: false, why: 'data-parse' }; }
    const r = await libCall(opts);
    if (!r.ok || !isOk(r.json)) { const why = errText(r); return { ok: false, why, captcha: AES.isCaptcha(why + ' ' + JSON.stringify((r.json && r.json.data) || '').slice(0, 300)) || why === 'timeout' }; }
    caps.push({ url: 'lib:' + t.api, text: JSON.stringify(r.json) });
  }
  return { ok: true, res: AES.extractDetail(toId, [], caps, { ref: new Date() }) };
}

function tabFetch(ids, kind) {
  return new Promise((resolve) => {
    state.tabResolve = resolve;
    try { chrome.runtime.sendMessage({ type: 'fetchDetails', orderIds: ids, kind: kind || 'detail' }); } catch (e) { state.tabResolve = null; resolve(); }
  });
}

async function fetchDetails(force) {
  if (state.detail || state.detailBusy) { state.detailRerun = true; return; }     // 진행 중이면 끝난 뒤 새로 발견된 주문도 이어서 처리
  state.cancelDetail = false; state.detailBusy = true;
  try {
    do { state.detailRerun = false; state.detailMiss = 0; await fetchDetailsOnce(force); if (!state.cancelDetail) await fetchTrackingOnce(force); force = false; } while (state.detailRerun && !state.cancelDetail);
  } finally {
    state.detailBusy = false;
    const miss = state.detailMiss || 0;
    state.progressDetail = state.cancelDetail ? '배송 현황 새로고침 중단됨' : `배송 현황 새로고침 완료${miss ? ` (상세에 날짜가 없는 주문 ${miss}건)` : ''}`;
    render();
  }
}

async function fetchDetailsOnce(force) {
  const s = AES.computeStats(state.orders, {});
  let ids = [...new Set(s.inProgress.map((r) => r.orderId))].filter((id) => force || !(state.orders[id] && state.orders[id].detailAt && Date.now() - state.orders[id].detailAt < 6 * 3600 * 1000));
  // 환불 진행·완료 주문은 결제수단만 보려고 한 번 읽는다 (이미 배송 대기·진행 주문이 있어 요청 형식을 배우는 중이거나, 저장된 형식이 있을 때만; 탭을 새로 열지는 않는다)
  const tplReady = !!(state.settings.detailTpl && state.settings.detailTpl.valid && !AES.EXTRA.flags.disableFastDetail);
  const extra = new Set();
  if (ids.length || tplReady) for (const r of s.refunds) if (r.state !== 'none' && !ids.includes(r.orderId)) { const o = state.orders[r.orderId]; if (o && !o.payment && !(o.payAt && Date.now() - o.payAt < 24 * 3600 * 1000)) { ids.push(r.orderId); extra.add(r.orderId); } }
  const mainTotal = ids.length - extra.size;
  if (!ids.length) { if (force) { state.progressDetail = '새로고침할 배송 대기·진행 주문이 없습니다'; render(); } return; }
  const total = ids.length;
  state.detail = { done: 0, total, running: true, base: 0 };
  const bump = () => { state.detail.done++; state.progressDetail = `배송 현황 새로고침 중… ${state.detail.done}/${total}`; scheduleRender(); };
  state.progressDetail = `배송 현황 새로고침 중… 0/${total}`; render();
  try {
    let tpl = state.settings.detailTpl && state.settings.detailTpl.valid && !AES.EXTRA.flags.disableFastDetail ? state.settings.detailTpl : null;
    if (!tpl) {
      // 학습: 첫 주문은 탭으로 열어 결과와 API 요청 형식을 얻는다
      state.detailTplCand = null;
      const first = ids.shift();
      await tabFetch([first]); bump();
      const cand = state.detailTplCand;
      if (cand && cand.eta) {
        const v = await replayDetail(cand.tpls, cand.orderId, cand.orderId);
        const same = v.ok && v.res && v.res.eta && v.res.eta.start === cand.eta.start && v.res.eta.end === cand.eta.end;
        state.fast.detail = same ? 'learned' : 'fail:mismatch' + (v.ok ? '' : '(' + v.why + ')');
        if (same) { tpl = { tpls: cand.tpls, orderId: cand.orderId, valid: true }; state.settings.detailTpl = tpl; store.save(); }
      } else state.fast.detail = cand ? 'fail:no-eta' : 'fail:no-template';
    } else state.fast.detail = 'saved';

    let failed = [], sawCaptcha = false;
    if (tpl && ids.length) {
      await pool(ids, 6, async (id) => {
        let r = null;
        try { r = await replayDetail(tpl.tpls, tpl.orderId, id); } catch (_) {}
        if (r && !r.ok && r.captcha && !state.cancelDetail) {                       // 보안 인증이면 기다렸다가 다시 (탭으로 넘기지 않는다)
          sawCaptcha = true;
          const w = await waitCaptcha(async () => { const x = await replayDetail(tpl.tpls, tpl.orderId, id); return x.ok ? { json: x, ok: true } : x; }, 'detail');
          r = w.json || (w.ok ? w : r);
        }
        if (r && r.ok) { applyDetail(id, r.res); bump(); } else if (extra.has(id)) bump(); else failed.push(id);
      });
      if (failed.length && failed.length === ids.length - extra.size && !sawCaptcha) { state.settings.detailTpl = null; store.save(); state.fast.detail += ' → 직접 호출 실패, 탭으로 전환'; }
    } else failed = ids.filter((id) => !extra.has(id));
    if (failed.length && !state.cancelDetail && !sawCaptcha) {      // 보안 인증 때문에 못 받은 주문은 탭으로 넘기지 않고 다음 갱신 때 다시 받는다
      state.detail.base = state.detail.done;
      await tabFetch(failed);
    }
  } finally {
    state.detail = null;
    const miss = AES.computeStats(state.orders, {}).etaMissingOrders.length;
    noteHealth('detail', { total: mainTotal, found: mainTotal - Math.min(mainTotal, miss) });
    state.detailMiss = miss;
    state.progressDetail = state.cancelDetail ? '배송 현황 새로고침 중단됨' : '예상 배송일 확인 완료';      // 이어서 운송장 조회가 있으므로 임시 문구
    render();
  }
}

/** 배송 조회 화면의 결과 반영: 운송장 번호와 배송 이벤트. 못 읽어도 시각은 남겨 같은 주문을 계속 다시 열지 않는다 */
function applyTracking(id, res) {
  const o = { id, source: 'detail', trackAt: Date.now() };
  if (res.tracking) o.track = res.tracking;
  if (res.payment) o.payment = res.payment;
  if (state.orders[id]) ingest([o]);
}

const TRACK_FRESH_MS = 3 * 3600 * 1000;
/**
 * 배송 중인 주문의 "배송 조회" 화면에서 운송장 번호와 최신 배송 이벤트를 읽는다 (합배송 묶기, 도착 여부 판단에 사용).
 * 요청 형식을 한 번 배우면(배송 조회 화면을 백그라운드 탭으로 열어 호출을 관찰) 나머지는 탭 없이 직접 호출한다.
 */
async function fetchTrackingOnce(force) {
  const s = AES.computeStats(state.orders, {});
  const ids = [...new Set(s.inProgress.filter((r) => r.status === 'shipping').map((r) => r.orderId))]
    .filter((id) => force || !(state.orders[id] && state.orders[id].trackAt && Date.now() - state.orders[id].trackAt < TRACK_FRESH_MS));
  if (!ids.length) return;
  const total = ids.length;
  state.detail = { done: 0, total, running: true, base: 0 };
  const bump = () => { state.detail.done++; state.progressDetail = `운송장·배송 조회 중… ${state.detail.done}/${total}`; scheduleRender(); };
  state.progressDetail = `운송장·배송 조회 중… 0/${total}`; render();
  try {
    let tpl = state.settings.trackTpl && state.settings.trackTpl.valid && !AES.EXTRA.flags.disableFastDetail ? state.settings.trackTpl : null;
    let rest = ids.slice();
    if (!tpl) {
      // 학습: 운송장이 읽히는 주문을 만날 때까지 최대 3건을 탭으로 열어 결과와 요청 형식을 얻는다
      let learned = null;
      for (let i = 0; i < 3 && rest.length && !state.cancelDetail && !learned; i++) {
        state.trackTplCand = null;
        const id = rest.shift();
        await tabFetch([id], 'track'); bump();
        if (state.trackTplCand) learned = state.trackTplCand;
      }
      if (!learned) { state.fast.track = 'fail:no-tracking'; rest = []; }          // 어느 주문에서도 운송장을 못 읽으면 나머지 주문의 탭을 열지 않는다
      else {
        const v = await replayDetail(learned.tpls, learned.orderId, learned.orderId);
        const same = v.ok && v.res && v.res.tracking && v.res.tracking.no === learned.no;
        state.fast.track = same ? 'learned' : 'fail:mismatch' + (v.ok ? '' : '(' + v.why + ')');
        if (same) { tpl = { tpls: learned.tpls, orderId: learned.orderId, valid: true }; state.settings.trackTpl = tpl; store.save(); }
      }
    } else state.fast.track = 'saved';

    if (rest.length && tpl) {
      const failed = []; let sawCaptcha = false;
      await pool(rest, 6, async (id) => {
        let r = null;
        try { r = await replayDetail(tpl.tpls, tpl.orderId, id); } catch (_) {}
        if (r && !r.ok && r.captcha && !state.cancelDetail) {
          sawCaptcha = true;
          const w = await waitCaptcha(async () => { const x = await replayDetail(tpl.tpls, tpl.orderId, id); return x.ok ? { json: x, ok: true } : x; }, 'detail');
          r = w.json || (w.ok ? w : r);
        }
        if (r && r.ok) { applyTracking(id, r.res); bump(); } else failed.push(id);
      });
      if (failed.length === rest.length && !sawCaptcha) { state.settings.trackTpl = null; store.save(); state.fast.track += ' → 직접 호출 실패, 탭으로 전환'; }
      if (failed.length && !state.cancelDetail && !sawCaptcha) { state.detail.base = state.detail.done; await tabFetch(failed, 'track'); }
    } else if (rest.length && !state.cancelDetail) {
      state.detail.base = state.detail.done; await tabFetch(rest, 'track');         // 직접 호출 형식을 못 배웠어도 운송장이 읽히면 탭으로 계속
    }
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
      if (msg.tpls && msg.tpls.length && msg.tracking && msg.tracking.no && !state.trackTplCand) state.trackTplCand = { tpls: msg.tpls, orderId: msg.orderId, no: msg.tracking.no };
      applyTracking(msg.orderId, { tracking: msg.tracking, payment: msg.payment, raw: msg.raw });
    } else if (msg.type === 'detail') {
      if (msg.tpls && msg.tpls.length && msg.eta && !state.detailTplCand) state.detailTplCand = { tpls: msg.tpls, orderId: msg.orderId, eta: msg.eta };
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
