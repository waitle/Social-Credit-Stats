// 알리 주문 통계 - 응답 수집(훅), DOM 스캔
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
function scanDom(force) {
  if (IS_TB) return 0;                       // 타오바오는 화면을 읽지 않고 API 응답만 쓴다
  try {
    if (!document.body || state.hold) return 0;
    if (force !== true && state.listAt && !DETAIL_PATH) return 0; // API 로 받은 데이터가 있으면 DOM 스캔 불필요
    const { orders, cards } = AES.scrapeDom(document, { ref: new Date() });
    state.cards = cards;
    return ingest(orders);
  } catch (e) { console.warn('[알리 주문 통계] DOM 스캔 실패', e); return 0; }
}
const scanDomSoon = debounce(scanDom, 900);

const hookCache = new Map();
/** 응답 1건 처리. 추출된 주문 배열을 반환 (같은 응답이 훅/직접호출 양쪽으로 와도 한 번만 파싱) */
function onHook(url, text) {
  if (typeof text !== 'string') return [];
  if (IS_TB) return tbOnHook(url, text);
  const key = text.length + ':' + text.slice(0, 60) + ':' + text.slice(-60);
  if (hookCache.has(key)) return hookCache.get(key);
  const json = AES.parseResponseText(text);
  if (!json) return [];
  // 알리 자체 집계 (배송 중 / 처리 중 / 결제 대기)
  if (/order\.count/i.test(url) && json.data && json.data.module) {
    const m = json.data.module;
    const c = { shipped: +m.shipped || 0, processing: +m.processing || 0, unpaid: +m.unpaid || 0, at: Date.now() };
    if (state.hold) { state.held.counts = c; return []; }
    state.counts = c;
    store.save(); scheduleRender();
    return [];
  }
  if (NOISE_URL.test(url) || !/\d{12,}/.test(text)) return [];
  if (!state.captures.some((c) => c.url === url && c.len === text.length)) {
    state.captures.push({ url, len: text.length, text: text.slice(0, 300000) });
    if (state.captures.length > 8) state.captures.shift();
  }
  const meta = AES.findListMeta(json);
  if (meta) {
    state.meta = meta; state.listAt = Date.now();
    if (!state.listSeen.has(key)) { state.listSeen.add(key); state.listResps.push(json); if (state.listResps.length > 400) state.listResps.shift(); }
  }
  let os = [];
  try {
    os = AES.extractFromJson(json, { ref: new Date() });
    if (meta) for (const o of os) state.sessionIds.add(o.id);
    // 주문 목록이 아닌 응답(상세 등)은 이미 아는 주문의 날짜/상태/금액을 덮어쓰지 않고 예상 배송일·환불 정보만 보강
    const toIngest = meta ? os : os.map((o) => {
      if (!state.orders[o.id]) return o;
      const p = { id: o.id, source: 'detail' };
      if (o.eta) { p.eta = o.eta; p.etaSrc = DETAIL_PATH ? 'detail' : 'api'; }
      if (o.refund) p.refund = o.refund;
      return p;
    });
    ingest(toIngest);
  } catch (err) { console.warn('[알리 주문 통계] JSON 파싱 실패', err); }
  if (meta) state.lastPageOrders = os;
  hookCache.set(key, os);
  if (hookCache.size > 60) hookCache.delete(hookCache.keys().next().value);
  return os;
}

/** 페이지 훅 메시지 수신, 앞서 도착한 응답 재수신, DOM 변화 감시 */
function initCollect() {
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source === 'aes-net') {
      state.net.push({ url: e.data.url, len: e.data.len, via: e.data.via, body: e.data.body });
      if (state.net.length > 150) state.net.shift();
    } else if (e.data.source === 'aes-hook') onHook(e.data.url, e.data.text);
    else if (e.data.source === 'aes-mtop-res') { const f = pendingCalls.get(e.data.id); if (f) f(e.data); }
    else if (e.data.source === 'aes-libinfo') state.libInfo = e.data.info;
    else if (e.data.source === 'aes-req') {
      const k = e.data.api + ':' + e.data.at;
      if (!state.reqSeen.has(k)) { state.reqSeen.add(k); state.reqLog.push({ api: e.data.api, opts: e.data.opts, at: e.data.at }); if (state.reqLog.length > 80) state.reqLog.shift(); }
    }
  });
  window.postMessage({ source: 'aes-replay' }, '*'); // 이 스크립트가 뜨기 전에 도착한 응답 재수신

  new MutationObserver(scanDomSoon).observe(document.documentElement, { childList: true, subtree: true });
}
