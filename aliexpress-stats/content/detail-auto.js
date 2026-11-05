// 알리 주문 통계 - 주문 상세 자동 조회 (background 가 연 탭)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/** 상세 페이지에서 예상 배송일과 상세 API 요청 형식을 모아 background 로 보낸다 */
async function runDetailAuto() {
    const qs = new URLSearchParams(location.search);
    const orderId = qs.get('orderId') || qs.get('tradeOrderId') || '';
    const kind = TRACK_PATH ? 'track' : 'detail';
    const caps = [], seen = new Set();
    const reqLog = [], reqSeen = new Set();
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && e.data.source === 'aes-req') { const k = e.data.api + ':' + e.data.at; if (!reqSeen.has(k)) { reqSeen.add(k); reqLog.push({ api: e.data.api, opts: e.data.opts }); } return; }
      if (e.source !== window || !e.data || e.data.source !== 'aes-hook' || NOISE_URL.test(e.data.url)) return;
      const k = e.data.url + e.data.text.length;
      if (seen.has(k)) return; seen.add(k);
      caps.push({ url: e.data.url, text: e.data.text.slice(0, 400000) });
    });
    window.postMessage({ source: 'aes-replay' }, '*');
    const getLines = () => (document.body ? document.body.innerText || '' : '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
    let res = null, loadedSince = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 22000) {
      await sleep(600);
      res = AES.extractDetail(orderId, getLines(), caps, { ref: new Date() });
      if (kind === 'track') {                                          // 배송 조회 화면: 운송장 번호를 읽으면 끝, 데이터가 오지 않으면 일정 시간 뒤 포기
        if (res.tracking && res.tracking.no) break;
        if (caps.length || getLines().length > 5) { loadedSince = loadedSince || Date.now(); if (Date.now() - loadedSince > 8000) break; }
        continue;
      }
      if (res.eta) break;
      if (getLines().some((l) => l.includes(orderId))) {               // 페이지는 떴는데 예상 배송일이 없는 경우
        loadedSince = loadedSince || Date.now();
        if (Date.now() - loadedSince > 7000) break;
      }
    }
    const rel = (res ? res.rawLines.concat(res.apiLines) : []).filter((l) => /\d/.test(l) && /(배송|도착|예상|예정|결제|운송장|송장|delivery|deliver|arriv|estimat|ship|payment|pay with|tracking)/i.test(l)).slice(0, 25);
    const head = res ? res.rawLines.slice(0, 40) : [];
    // 이 페이지가 호출한 mtop 상세 API 요청(데이터에 주문번호 포함)을 알려줘서, 이후 주문은 탭 없이 직접 호출하게 한다
    const byApi = new Map();
    for (const r of reqLog) { try { if (JSON.stringify(r.opts.data || '').includes(orderId)) byApi.set(r.api, { api: r.api, opts: r.opts }); } catch (_) {} }
    const tpls = [...byApi.values()].slice(0, 3);
    chrome.runtime.sendMessage({
      type: 'detailResult', orderId, kind,
      eta: res && res.eta, etaSrc: res && res.etaSrc, items: res ? res.items : [],
    tracking: res && res.tracking, protectEnd: res && res.protectEnd, payment: res && res.payment,
      raw: { relevant: rel, head }, tpls
    });
}
