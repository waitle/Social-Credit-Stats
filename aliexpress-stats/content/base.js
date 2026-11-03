// 알리 주문 통계 - 기본 상수, 상태, 조회 기간, 저장소, 주문 병합 반영
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
const DETAIL_PATH = /\/p\/order\/detail/i.test(location.pathname);
const DETAIL_AUTO = DETAIL_PATH && /[?&]aesAuto=1/.test(location.search);    // 백그라운드 탭: 예상 배송일 학습
const LIST_AUTO = /\/p\/order\/index/i.test(location.pathname) && /[?&]aesAuto=list/.test(location.search);   // 백그라운드 탭: 자동 갱신
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const NOISE_URL = /recommend|cart\.count|cookie\.render/i;

const state = {
  orders: {}, settings: { usdRate: null, thumbs: true, detailTpl: null, auto: true, period: '1w', includeShipping: true, coverage: null, listTpl: null, customsLimit: 150, protectDays: 7, catOverrides: {} },
  tab: 'summary', shipFilter: 'all', moreOpen: false, open: false, loading: false, cancel: false, progress: '',
  filter: '', captures: [], cards: [], lastUpdate: null, net: [], counts: null,
  meta: null, listAt: 0, detail: null, listResps: [], listSeen: new Set(), reqLog: [], reqSeen: new Set(), sessionIds: new Set(), knownAtStart: new Set(), lastPageOrders: [], cut: { cutoff: null, covered: false }, chain: null, endReason: '', libInfo: null, detailTplCand: null, tabResolve: null, cancelDetail: false,
  fast: { list: '', detail: '' }, progressDetail: '', detailRerun: false
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
  let from = newFrom;
  if (old && old.from) from = (old.from === 'all' || newFrom === 'all') ? 'all' : (old.from < newFrom ? old.from : newFrom);
  state.settings.coverage = { from, at: Date.now() };
  store.save();
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
    } catch (_) {}
  },
  _t: null,
  async flush() {                                   // 즉시 저장
    clearTimeout(store._t); store._t = null;
    try { await chrome.storage.local.set({ orders: state.orders, settings: state.settings, counts: state.counts }); } catch (_) {}
  },
  save() { clearTimeout(store._t); store._t = setTimeout(() => store.flush(), 300); },
  async clear() { try { await chrome.storage.local.remove(['orders']); } catch (_) {} }
};

/* ---------------------------- 데이터 수집 ---------------------------- */
function ingest(list) {
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
