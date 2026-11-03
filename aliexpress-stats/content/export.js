// 알리 주문 통계 - 내보내기 (CSV, 디버그)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/* ---------------------------- 내보내기 ---------------------------- */
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function exportCsv() {
  const s = state.stats || computeNow();
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const head = ['주문번호', '주문일', '상태', '상품명', '분류', '수량', '단가', '통화', '링크'];
  const rows = s.purchases.map((p) => [p.orderId, p.date, AES.STATUS_LABEL[p.status] || p.status, p.title, p.category, p.qty, p.price ? p.price.amount : '', p.price ? (p.price.currency || s.primary) : '', p.url]);
  download('aliexpress-orders.csv', '\ufeff' + [head, ...rows].map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
}
function exportDebug() {
  const dump = {
    version: 2, page: location.href, ua: navigator.userAgent, at: new Date().toISOString(),
    note: '개인정보(이름/주소/전화번호 등)가 포함됐는지 공유 전에 꼭 확인하세요.',
    counts: state.counts, meta: state.meta, fast: state.fast, libInfo: state.libInfo, period: state.settings.period, coverage: state.settings.coverage, endReason: state.endReason,
    detailTpl: state.settings.detailTpl,
    mtopReqs: state.reqLog.map((r) => ({ api: r.api, at: r.at, opts: JSON.parse(JSON.stringify(r.opts, (k, v) => (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + `…(${v.length})` : v))) })),
    diag: diagnose(),
    netLog: state.net,
    parsedOrders: Object.values(state.orders).map((o) => ({ ...o, raw: undefined })),
    domCards: state.cards.slice(0, 3),
    apiCaptures: state.captures.slice(-3).map((c) => ({ url: c.url, text: c.text.slice(0, 120000) }))
  };
  download('aliexpress-stats-debug.json', JSON.stringify(dump, null, 2), 'application/json');
}

/** 백업 파일: 주문 + 설정 + 알리 집계 (이 브라우저의 데이터를 다른 PC/설치 경로로 옮길 때) */
function exportBackup() {
  const data = { format: 'aliexpress-stats-backup', v: 1, at: new Date().toISOString(), orders: state.orders, settings: state.settings, counts: state.counts };
  download(`aliexpress-stats-backup-${AES.toISO(new Date())}.json`, JSON.stringify(data), 'application/json');
}

/** 백업 파일 또는 이전 버전의 디버그 파일(parsedOrders)을 불러와 현재 데이터와 병합 */
function importBackup() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json,.json';
  input.onchange = async () => {
    const f = input.files && input.files[0]; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); } catch (_) { state.progress = '복원 실패: JSON 파일이 아닙니다'; render(); return; }
    const n = restoreData(data);
    state.progress = n >= 0 ? `복원 완료 · 주문 ${n}건 병합` : '복원 실패: 알 수 없는 형식';
    render();
  };
  input.click();
}

/** 병합 규칙: 지금 데이터가 있으면 그 위에 백업 내용을 보강 (최신 상태 우선) */
function restoreData(data) {
  let list = null;
  if (data && data.format === 'aliexpress-stats-backup' && data.orders) list = Object.values(data.orders);
  else if (data && Array.isArray(data.parsedOrders)) list = data.parsedOrders;       // v1.x 디버그 파일
  if (!list) return -1;
  for (const o of list) {
    if (!o || !o.id) continue;
    const cur = state.orders[o.id];
    state.orders[o.id] = cur ? AES.mergeOrder(o, { ...cur, source: cur.source }) : o;
  }
  const keep = ['period', 'customsLimit', 'protectDays', 'catOverrides', 'includeShipping', 'auto', 'thumbs', 'usdRate', 'notify', 'bgRefreshHours'];
  const src = (data && data.settings) || (data && { period: data.period }) || {};
  for (const k of keep) if (src[k] != null && state.settings[k] == null) state.settings[k] = src[k];
  if (!state.settings.coverage && src.coverage) state.settings.coverage = src.coverage;
  if (!state.counts && data.counts) state.counts = data.counts;
  store.flush();
  return list.length;
}
