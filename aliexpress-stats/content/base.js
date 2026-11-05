// 알리 주문 통계 - 기본 상수, 상태, 조회 기간, 저장소, 주문 병합 반영
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
const DETAIL_PATH = /\/p\/order\/detail/i.test(location.pathname);
const TRACK_PATH = /\/p\/tracking\//i.test(location.pathname);                       // "배송 조회" 화면
const DETAIL_AUTO = (DETAIL_PATH || TRACK_PATH) && /[?&]aesAuto=1/.test(location.search);    // 백그라운드 탭: 상세/배송 조회 화면에서 예상 배송일·운송장 읽기
const LIST_AUTO = /\/p\/order\/index/i.test(location.pathname) && /[?&]aesAuto=list/.test(location.search);   // 백그라운드 탭: 자동 갱신
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const NOISE_URL = /recommend|cart\.count|cookie\.render/i;

const state = {
  orders: {}, settings: { usdRate: null, thumbs: true, auto: false, autoOpen: true, period: '1w', includeShipping: true, coverage: null, listTpl: null, resume: null, customsLimit: 150, protectDays: 7, catOverrides: {} },
  tab: 'summary', shipFilter: 'all', moreOpen: false, open: false, loading: false, cancel: false, progress: '',
  hold: false, held: { orders: [], counts: null },
  filter: '', captures: [], cards: [], lastUpdate: null, net: [], counts: null,
  meta: null, listAt: 0, detail: null, listResps: [], listSeen: new Set(), reqLog: [], reqSeen: new Set(), sessionIds: new Set(), knownAtStart: new Set(), lastPageOrders: [], cut: { cutoff: null, covered: false }, chain: null, endReason: '', libInfo: null, tabResolve: null, cancelDetail: false,
  fast: { list: '', detail: '', track: '' }, detailBusy: false, paused: null, progressDetail: '', detailRerun: false
};

/* ---------------------------- 조회 기간 / 저장된 범위(coverage) ---------------------------- */
const PERIODS = [['1w', '최근 1주일', 7], ['2w', '최근 2주일', 14], ['1m', '최근 1달', 30], ['2m', '최근 2달', 60], ['3m', '최근 3달', 90], ['6m', '최근 6개월', 180], ['1y', '최근 1년', 365], ['all', '전체', null]];
const periodInfo = (k) => PERIODS.find((p) => p[0] === k) || PERIODS[0];
const isoDaysAgo = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - d); return AES.toISO(t); };
const addDaysISO = (iso, d) => { const t = AES.fromISO(iso); t.setDate(t.getDate() + d); return AES.toISO(t); };
const cutoffOf = (k) => { const d = periodInfo(k)[2]; return d == null ? null : isoDaysAgo(d); };
const isHeavy = (k) => { const d = periodInfo(k)[2]; return d == null || d >= 60; };   // 2달 이상
/** 저장된 내역이 이 기준일까지 이미 포함하는가 (포함하면 추가분만 불러온다) */
function coversCutoff(cutoff) {
  const c = state.settings.coverage;
  if (!c || !c.from) return false;
  if (cutoff == null) return c.from === 'all';
  return c.from === 'all' || c.from <= cutoff;
}
const needsConfirm = (k) => isHeavy(k) && !coversCutoff(cutoffOf(k));
function confirmHeavy(label) {
  return confirm(`⚠ ${label} 내역을 불러옵니다.\n\n2달 이상의 내역은 로딩 시간이 길어지고, 알리익스프레스에서 봇 인증(보안 확인) 창이 뜰 수 있습니다.\n인증 창이 뜨면 인증을 완료한 뒤 다시 시도해 주세요.\n\n계속할까요?`);
}

/** 지금까지 받은 페이지로 충분한가? 'cutoff'(기간 도달) / 'incremental'(이미 저장된 부분에 도달) / null(계속) */
function shouldStop(pageOrders) {
  const cut = state.cut;
  if (cut.cutoff == null) return null;                               // 전체: 마지막 페이지까지
  const dates = (pageOrders || []).map((o) => (o.date || '').slice(0, 10)).filter(Boolean).sort();
  const oldest = dates[0] || null;
  const inprog = Object.values(state.orders).filter((o) => o.status === 'shipping' || o.status === 'pending_ship');
  // 배송 중 주문은 기간과 무관하게 포함: 알리가 집계한 건수를 모두 확보하거나 75일 전까지 내려가면 충분
  let shipOk = true;
  if (state.settings.includeShipping !== false && state.counts) {
    const target = state.counts.shipped + state.counts.processing;
    shipOk = inprog.length >= target || !!(oldest && oldest < isoDaysAgo(75));
  }
  if (oldest && oldest < cut.cutoff && shipOk) return 'cutoff';
  if (cut.covered && pageOrders && pageOrders.length && pageOrders.every((o) => state.knownAtStart.has(o.id))) {
    const unseenOlder = inprog.filter((o) => !state.sessionIds.has(o.id) && o.date && (!oldest || o.date.slice(0, 10) <= oldest));
    if (!unseenOlder.length && shipOk) return 'incremental';          // 새 주문만 받고 종료 (배송 중 주문 상태도 갱신됨)
  }
  return null;
}
function updateCoverage(reason) {
  if (state.cancel) return;
  const old = state.settings.coverage;
  let newFrom = null;
  if (state.meta && state.meta.hasMore === false) newFrom = 'all';
  else if (reason === 'cutoff') {
    const ds = [...state.sessionIds].map((id) => state.orders[id] && state.orders[id].date).filter(Boolean).map((d) => d.slice(0, 10)).sort();
    if (ds[0]) newFrom = addDaysISO(ds[0], 1);                       // 마지막 페이지의 가장 오래된 날짜는 일부만 받았을 수 있어 하루 여유
  } else if (reason === 'incremental') newFrom = old && old.from;
  if (!newFrom) return;
  mergeCoverage(newFrom);
  store.flush();
}
/** 저장 범위를 넓힌다 (이미 더 넓으면 유지). 최신 주문부터 이어서 받은 범위만 합쳐지므로 항상 "오늘까지 끊김 없음"이 유지된다 */
function mergeCoverage(newFrom) {
  const old = state.settings.coverage;
  let from = newFrom;
  if (old && old.from) from = (old.from === 'all' || newFrom === 'all') ? 'all' : (old.from < newFrom ? old.from : newFrom);
  state.settings.coverage = { from, at: Date.now() };
}

/* ---------------------------- 저장소 ---------------------------- */
const store = {
  async load() {
    try {
      const r = await chrome.storage.local.get(['orders', 'settings', 'counts']);
      if (r.orders) {
        const fresh = state.orders;                       // 저장소 로딩 중 먼저 들어온 응답은 버리지 않고 병합
        state.orders = r.orders;
        for (const id of Object.keys(fresh)) state.orders[id] = AES.mergeOrder(state.orders[id], fresh[id]);
        state.knownAtStart = new Set(Object.keys(r.orders));
      }
      if (r.counts) state.counts = r.counts;
      if (r.settings) state.settings = { ...state.settings, ...r.settings };
      delete state.settings.detailTpl; delete state.settings.trackTpl;   // 예전 버전이 저장한 요청 형식 (이제 쓰지 않음)
      if ((state.settings.defaultsV || 0) < 1) {                       // 자동 실행 기본값을 "끔"으로 바꾼 버전: 예전 기본값(켬)이 저장돼 있던 설치도 한 번만 끈다
        state.settings.auto = false; state.settings.defaultsV = 1; store.save();
      }
    } catch (_) {}
  },
  _t: null,
  locked: false,                                    // 초기화 중에는 아무것도 저장하지 않는다 (진행 중이던 작업이 지운 기록을 다시 쓰지 못하게)
  async flush() {                                   // 즉시 저장
    clearTimeout(store._t); store._t = null;
    if (store.locked) return;
    try { await chrome.storage.local.set({ orders: state.orders, settings: state.settings, counts: state.counts }); } catch (_) {}
  },
  save() { if (store.locked) return; clearTimeout(store._t); store._t = setTimeout(() => store.flush(), 300); },
  /** 저장된 주문과 그에 딸린 기록을 모두 지운다: 주문, 알리 집계(배송 중/배송 전), "어디까지 불러왔는지"(범위·이어받기 지점),
   *  요청 형식 캐시, 알림 기준선, 상태 보고 대기열. 사용자 설정(기간·환율·관세 한도·분류 수정 등)은 남긴다.
   *  범위만 남기면 다음 불러오기가 "이미 다 받았다"고 판단해 아무것도 받지 않는다. */
  async clear() {
    store.locked = true; clearTimeout(store._t); store._t = null;
    state.orders = {}; state.counts = null;
    Object.assign(state.settings, { coverage: null, resume: null, listTpl: null });
    state.knownAtStart = new Set(); state.sessionIds = new Set(); state.lastPageOrders = [];
    state.cut = { cutoff: null, covered: false }; state.chain = null; state.endReason = '';
    try {
      await chrome.storage.local.remove(['orders', 'counts', 'notifyState', 'healthQueue']);
      await chrome.storage.local.set({ settings: state.settings });
    } catch (_) {}
  }
};

/* ---------------------------- 데이터 수집 ---------------------------- */
/** 초기화 직후에는 이 페이지가 열 때 받은 1페이지 응답이 화면·저장소에 들어오지 않도록 잡아 둔다. 사용자가 조회를 시작하면 풀어 준다. */
function releaseHold() {
  if (!state.hold) return;
  state.hold = false;
  const held = state.held; state.held = { orders: [], counts: null };
  if (held.counts && !state.counts) state.counts = held.counts;
  ingest(held.orders);
}
function ingest(list) {
  if (state.hold) { state.held.orders.push(...list); return 0; }
  let changed = 0;
  for (const o of list) {
    if (!o || !o.id) continue;
    if (DETAIL_PATH && o.eta) { o.etaSrc = 'detail'; }
    const prev = state.orders[o.id];
      const merged = AES.mergeOrder(prev, o);
    const a = JSON.stringify({ ...merged, updated: 0 }), b = JSON.stringify({ ...(prev || {}), updated: 0 });
    if (a !== b) { changed++; state.orders[o.id] = merged; }
  }
  if (changed) { state.lastUpdate = Date.now(); store.save(); scheduleRender(); }
  return changed;
}
