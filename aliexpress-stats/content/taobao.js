// 타오바오 주문 통계 - 목록·상세 수집 (페이지의 lib.mtop 클라이언트를 알리와 같은 방식으로 재사용)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 알리에서는 아무것도 호출되지 않는다.
// 배송 조회(운송장·이벤트) API 는 진행 중인 주문이 있는 계정에서 아직 확인하지 못해 구현하지 않았다. (README "알려진 한계")
'use strict';

const TB_FAIL_CAPTCHA = /RGV587|FAIL_SYS_USER_VALIDATE|punish|nocaptcha|被挤爆|哎哟喂/i;

/* ---------------------------- 응답 수집 (페이지 훅) ---------------------------- */
/** 주문 목록 응답이면 상태에 반영하고 주문 배열을 돌려준다. 다른 응답은 무시 */
function tbOnHook(url, text) {
  if (typeof text !== 'string' || text.indexOf('shopInfo_') < 0) return [];
  const json = AES.parseResponseText(text);
  if (!json) return [];
  const r = AES.taobao.parseList(json);
  if (!r.ok || !r.orders.length) return [];
  let page = null;
  try { const m = decodeURIComponent(String(url)).match(/"page"\s*:\s*"?(\d+)/); if (m) page = +m[1]; } catch (_) {}
  tbApplyPage(r, page || (r.nextPage ? r.nextPage - 1 : null));
  return r.orders;
}

/** 파싱한 한 페이지를 상태에 반영. 불러오는 중에는 직접 호출 쪽이 meta 를 관리하므로 훅이 덮어쓰지 않는다 */
function tbApplyPage(r, page) {
  if (!state.loading) {
    state.meta = { hasMore: r.hasMore, pageIndex: page || (state.meta && state.meta.pageIndex) || 1 };
    state.lastPageOrders = r.orders;
  }
  state.listAt = Date.now();
  for (const o of r.orders) state.sessionIds.add(o.id);
  ingest(r.orders);
}

/* ---------------------------- 목록 불러오기 ---------------------------- */
/** 목록 1페이지를 페이지 자신의 mtop 클라이언트로 요청 → { os, parsed } | { why, captcha } */
async function tbFetchPage(n) {
  const r = await libCall(AES.taobao.listRequest(n));
  if (!r.ok || !isOk(r.json)) {
    const why = errText(r);
    const detail = why + ' ' + JSON.stringify((r.json && (r.json.data || r.json.ret)) || '').slice(0, 300);
    return { why: 'api:' + why, captcha: AES.isCaptcha(detail) || TB_FAIL_CAPTCHA.test(detail) || why === 'timeout' };
  }
  const parsed = AES.taobao.parseList(r.json);
  if (!parsed.ok) return { why: 'parse' };
  state.meta = { hasMore: parsed.hasMore, pageIndex: n };
  state.lastPageOrders = parsed.orders;
  state.listAt = Date.now();
  for (const o of parsed.orders) state.sessionIds.add(o.id);
  ingest(parsed.orders);
  return { os: parsed.orders, parsed };
}

/** 일시 오류는 몇 번 다시 시도하고, 보안 인증이면 끝날 때까지 기다린다 */
async function tbFetchPageRetry(n) {
  if (captchaVisible()) { const w = await waitCaptcha(async () => ({ ok: true }), 'list'); if (w.why) return w; }
  let r = await tbFetchPage(n);
  for (let k = 0; !r.os && !r.captcha && k < 2 && !state.cancel; k++) { await sleep(1500 * (k + 1)); r = await tbFetchPage(n); }
  if (!r.os && r.captcha && !state.cancel) r = await waitCaptcha(() => tbFetchPage(n).then((x) => (x.os ? { json: x, ok: true, ...x } : x)), 'list');
  return r;
}

/** 페이지를 하나 받을 때마다: 이어받기 지점 저장 + 저장 범위를 그만큼 넓힘 (최신 주문부터 차례로 받으므로 끊김 없음) */
function tbAfterPage(pageNo, pageOrders) {
  if (state.meta && state.meta.hasMore === false) { state.settings.resume = null; store.save(); return; }
  const dates = (pageOrders || []).map((o) => (o.date || '').slice(0, 10)).filter(Boolean).sort();
  const oldest = dates[0] || null;
  state.settings.resume = { pageNo, oldest, at: Date.now() };
  if (oldest) mergeCoverage(addDaysISO(oldest, 1));
  store.save();
}

/** 반환: 'done' | 'cancel' | 'paused:사유' (받은 것은 유지, 이어서 불러오기 가능) | 'fail:사유' */
async function tbPages() {
  let progressed = false;
  const fail = (why) => (progressed ? 'paused:' + why : 'fail:' + why);
  // 1페이지는 항상 새로 받는다 (열 때 받은 것이 오래됐을 수 있음). 방금 받은 것이면 그대로 쓴다
  const fresh = state.listAt && Date.now() - state.listAt < 45000 && state.meta && state.meta.pageIndex === 1 && (state.lastPageOrders || []).length;
  if (!fresh) {
    const r = await tbFetchPageRetry(1);
    if (!r.os) return state.cancel ? 'cancel' : fail(r.why);
  }
  progressed = true;
  const rs = state.settings.resume;                    // tbAfterPage 가 덮어쓰기 전에 저장된 이어받기 지점을 읽는다
  tbAfterPage(1, state.lastPageOrders);
  state.progress = `목록 불러오는 중… ${Object.keys(state.orders).length}건`; scheduleRender();
  let w = shouldStop(state.lastPageOrders);
  if (w) { state.endReason = w; return 'done'; }
  let page = 1;
  // 저장된 이어받기 지점: 새 주문을 모두 받았고(= 첫 페이지가 아는 주문뿐) 저장 범위 밖이 필요하면 그 지점부터 이어서 (사이에 새 주문이 끼어도 겹칠 뿐 빠지지 않는다)
  if (!state.cut.covered && rs && rs.pageNo > 1 && state.lastPageOrders.every((o) => state.knownAtStart.has(o.id))) page = rs.pageNo - 1;
  for (let i = 0; i < 800 && state.meta.hasMore && !state.cancel; i++) {
    const next = page + 1;
    const r = await tbFetchPageRetry(next);
    if (!r.os) {
      if (state.cancel) return 'cancel';
      if (page > 1 && page === (rs && rs.pageNo - 1) && !r.captcha) { state.settings.resume = null; store.save(); page = 1; continue; }   // 저장 지점이 어긋났으면 버리고 차례대로
      return fail(r.why);
    }
    page = next;
    tbAfterPage(page, r.os);
    state.progress = `목록 불러오는 중… ${Object.keys(state.orders).length}건`; scheduleRender();
    fetchDetails(false);                    // 새로 받은 주문의 원화 결제액·배송 정보 조회를 목록 로딩과 동시에 진행
    w = shouldStop(r.os);
    if (w) { state.endReason = w; return 'done'; }
    await sleep(250);                       // 요청 사이에 간격을 둔다 (타오바오 봇 감지 완화)
  }
  return state.cancel ? 'cancel' : 'done';
}

async function tbLoadAll(opts = {}) {
  if (state.loading) return;
  releaseHold();
  let key = state.settings.period || '1w';
  if (opts.background && needsConfirm(key)) key = '1w';
  else if (!opts.confirmed && needsConfirm(key) && !confirmHeavy(periodInfo(key)[1])) {
    if (!opts.auto) { state.progress = '취소됨'; render(); return; }
    state.settings.period = key = '1w'; store.save();
  }
  const info = periodInfo(key), cutoff = cutoffOf(key), covered = coversCutoff(cutoff);
  state.cut = { cutoff, covered };
  state.loading = true; state.cancel = false; state.endReason = '';
  const rs = state.settings.resume;
  state.progress = covered ? `${info[1]} · 저장된 내역 이후 추가분 확인 중…` : rs && rs.oldest ? `${info[1]} 주문 목록 이어서 불러오는 중… (${rs.oldest} 이전부터)` : `${info[1]} 주문 목록 불러오는 중…`;
  render();
  let res = 'fail:no-lib';
  try {
    await refreshLibInfo();
    if (state.libInfo && state.libInfo.hooked) res = await tbPages();
    else res = 'fail:no-lib(' + (state.libInfo ? `lib=${state.libInfo.hasLib} mtop=${state.libInfo.hasMtop} request=${state.libInfo.requestType}` : 'noinfo') + ')';
  } catch (e) { res = 'fail:exception ' + e.message; }
  state.fast.list = res;
  state.loading = false; state.paused = null;
  const paused = /^paused:/.test(res), failed = /^fail:/.test(res);
  const finishedOk = !state.cancel && res === 'done';
  if (finishedOk) updateCoverage(state.endReason);
  await store.flush();
  const nSaved = Object.keys(state.orders).length, r2 = state.settings.resume;
  if (paused) {
    const reason = TB_FAIL_CAPTCHA.test(res) || /captcha/i.test(res) ? '보안 인증이 필요합니다. 타오바오 페이지에서 인증을 완료한 뒤 "이어서 불러오기"를 누르세요' : `오류로 멈췄습니다 (${res.slice(7, 70)}). "이어서 불러오기"로 계속할 수 있습니다`;
    state.progress = `${reason} · ${nSaved}건 저장됨${r2 && r2.oldest ? `, ${r2.oldest}까지` : ''}`;
  } else if (failed) {
    state.progress = `목록을 불러오지 못했습니다 (${res.slice(5, 80)}). 로그인 상태와 페이지를 확인하고 다시 시도하세요 · ${nSaved}건 저장됨`;
  } else if (state.cancel) {
    state.progress = `중단됨 · ${nSaved}건 저장됨${r2 && r2.oldest ? `, ${r2.oldest}까지` : ''} — "이어서 불러오기"로 계속할 수 있습니다`;
  } else state.progress = `${info[1]} ${state.endReason === 'incremental' ? '추가분 확인' : '목록'} 완료 · 총 ${nSaved}건 저장됨`;
  render();
  if (!state.cancel && !opts.noDetails) fetchDetails(false);
}

/* ---------------------------- 상세: 원화 결제액 · 결제/발송 시각 · 배송 방식 ---------------------------- */
const TB_DETAIL_FRESH_MS = 6 * 3600 * 1000;

function tbDetailTargets(force) {
  const since = cutoffOf(state.settings.period || '1w');
  const rows = [];
  for (const o of Object.values(state.orders)) {
    if (!o || !o.id) continue;
    const inProg = o.status === 'pending_ship' || o.status === 'shipping';
    const refunded = o.refund && (o.refund.state === 'done' || o.refund.state === 'processing');
    if (!inProg && (o.status === 'unpaid' || o.status === 'event' || (o.status === 'cancelled' && !refunded))) continue;   // 결제 전 취소는 결제액이 없다. 환불된 주문은 원화 결제액(= 환불 금액 기준)을 읽는다
    const inPeriod = !since || !o.date || String(o.date).slice(0, 10) >= since;
    if (!inProg && !inPeriod) continue;
    const stale = !o.detailAt || (inProg && Date.now() - o.detailAt > TB_DETAIL_FRESH_MS);
    if (!force && !stale) continue;
    rows.push(o);
  }
  rows.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));
  return rows.map((o) => o.id);
}

async function tbDetailOne(id) {
  let r = await libCall(AES.taobao.detailRequest(id));
  if ((!r.ok || !isOk(r.json)) && !state.cancelDetail) {
    const why = errText(r);
    if (AES.isCaptcha(why) || TB_FAIL_CAPTCHA.test(why + JSON.stringify((r.json && r.json.data) || '').slice(0, 300)) || why === 'timeout') {
      const w = await waitCaptcha(async () => { const x = await libCall(AES.taobao.detailRequest(id)); return x.ok && isOk(x.json) ? { json: x.json, ok: true } : { why: errText(x), captcha: true }; }, 'detail');
      if (w.json) r = { ok: true, json: w.json };
      else return { ok: false, why: w.why || 'captcha', captcha: true };
    }
  }
  if (!r.ok || !isOk(r.json)) return { ok: false, why: errText(r) };
  const det = AES.taobao.parseDetail(r.json, id);
  if (!det) return { ok: false, why: 'parse' };
  const patch = AES.taobao.detailPatch(det);
  if (state.orders[id]) ingest([patch]);
  return { ok: true, det };
}

async function tbDetailsOnce(force) {
  const ids = tbDetailTargets(force);
  if (!ids.length) { if (force) { state.progressDetail = '새로 읽을 주문이 없습니다'; render(); } return; }
  await refreshLibInfo();
  if (!state.libInfo || !state.libInfo.hooked) { state.fast.detail = 'fail:no-lib'; state.progressDetail = '페이지와 연결하지 못해 상세를 읽지 못했습니다'; render(); return; }
  const total = ids.length;
  state.detail = { done: 0, total, running: true, base: 0 };
  const bump = () => { state.detail.done++; state.progressDetail = `원화 결제액·배송 정보 불러오는 중… ${state.detail.done}/${total}`; scheduleRender(); };
  state.progressDetail = `원화 결제액·배송 정보 불러오는 중… 0/${total}`; render();
  let okN = 0, failN = 0, firstWhy = '';
  try {
    const first = await tbDetailOne(ids[0]);
    bump();
    if (!first.ok) { state.fast.detail = `fail:first(${String(first.why).slice(0, 40)})`; state.progressDetail = `상세를 읽지 못했습니다 (${String(first.why).slice(0, 40)})`; return; }
    okN++;
    await pool(ids.slice(1), 3, async (id) => {
      const r = await tbDetailOne(id);
      if (r.ok) okN++; else { failN++; firstWhy = firstWhy || String(r.why); }
      bump();
      await sleep(150);
    });
    state.fast.detail = failN ? `direct(${okN}/${total})` : 'direct';
  } finally {
    state.detail = null;
    if (state.fast.detail && !/^fail/.test(state.fast.detail)) {
      state.progressDetail = state.cancelDetail ? '새로고침 중단됨' : `원화 결제액·배송 정보 ${okN}건 반영${failN ? ` (${failN}건 실패: ${firstWhy.slice(0, 30)})` : ''}`;
    }
    render();
  }
}

async function tbFetchDetails(force) {
  if (state.detail || state.detailBusy) { state.detailRerun = true; return; }
  state.cancelDetail = false; state.detailBusy = true;
  try {
    do { state.detailRerun = false; state.captchaOut = false; await tbDetailsOnce(force); force = false; } while (state.detailRerun && !state.cancelDetail);
  } finally {
    state.detailBusy = false;
    render();
  }
}

/** 새로고침: 최근 주문 목록 + 상세를 모두 다시 읽는다 (페이지를 다시 열 필요 없음) */
async function tbRefresh() {
  releaseHold();
  if (!state.loading) await loadAll({ auto: true, noDetails: true });
  if (!state.cancel) tbFetchDetails(true);
}

/** 요약 상단 안내: 원화 환산(추정) 여부 */
function tbNote() {
  if (!IS_TB) return '';
  const n = AES.taobao.estimatedCount(state.orders);
  if (!n) return '';
  const set = state.settings.cnyRate > 0 ? +state.settings.cnyRate : null;
  const auto = AES.taobao.estimateCnyKrw(state.orders);
  const rate = set || auto;
  const msg = rate
    ? `위안으로만 표시된 주문 ${n}건은 환율 ${rate.toFixed(1)}원(${set ? '설정값' : '결제 내역 기반 추정'})으로 환산한 추정치입니다. 새로고침을 누르면 원화 결제액을 읽어 정확하게 바꿉니다.`
    : `원화 결제액을 아직 읽지 못한 주문 ${n}건은 위안(¥)으로 표시됩니다. 새로고침을 누르면 원화 결제액을 읽어 옵니다.`;
  return `<div class="note" style="margin:-6px 0 12px;color:var(--wa)">${esc(msg)}</div>`;
}
