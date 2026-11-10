// 변화 알림: 배송 완료, 도착 예정일 변경, 환불 완료, 구매자 보호 기간 임박, 관세 한도 주의
// 알림 폭주 방지:
//  - 처음 실행 때는 현재 상태를 기준점으로만 저장하고 알리지 않는다
//  - 환율/관세 한도/보호 기간 설정이 바뀐 직후에는 그 변화로 생긴 경고를 알리지 않고 기준점만 다시 잡는다
//  - 한 번에 개별 알림은 최대 3개, 한 시간에 최대 8개 (나머지는 요약 1개)
'use strict';

const NOTIFY_DEFAULT = { delivered: true, eta: true, refund: true, protect: true, customs: true };
const MAX_PER_CHECK = 3, MAX_PER_HOUR = 8;

async function checkNotifications(site) {
  const tb = site === 'taobao', keys = siteKeys(site);
  const { orders, settings, stats: s } = await loadStats(site);
  if (tb && !Object.keys(orders).length) return 0;
  const prev = (await getStore(keys.notify))[keys.notify];
  const base = tb ? ((await getStore('settings')).settings || {}) : settings;               // 알림 종류 설정은 알리 쪽 설정 하나를 함께 쓴다
  const cfg = Object.assign({}, NOTIFY_DEFAULT, base.notify || {});
  const ref = (id) => (tb ? 'tb:' + id : id);                                                  // 알림 클릭 시 어느 사이트의 주문인지 구분
  // 경고 계산에 쓰이는 설정이 바뀌었는지 (환율은 추정값이 조금씩 흔들려도 같은 것으로 보도록 50원 단위로 묶는다)
  const sig = [tb ? (settings.cnyRate || 'auto') : (settings.usdRate || 'auto'), settings.customsLimit || 150, settings.protectDays != null ? settings.protectDays : 7, Math.round(((s.customs && s.customs.krwPerUsd) || 0) / 50)].join('|');
  const rebase = !!(prev && prev.sig !== sig);
  const hourAgo = Date.now() - 3600000;
  const next = { orders: {}, protect: {}, customs: {}, sig, sent: ((prev && prev.sent) || []).filter((t) => t > hourAgo) };
  const out = [];
  const titleOf = (o) => (o.items && o.items[0] && o.items[0].title) || `주문 ${o.id}`;
  // 환불 완료 판단: 상품별 환불 상태가 있으면(타오바오) 환불 완료된 상품 수가 늘었을 때만. 요청이 거절돼 주문 요약 상태가 'done'으로 바뀐 경우를 환불 완료로 알리지 않는다
  const perItem = (o) => (o.items || []).some((it) => it.refundState !== undefined);
  const doneItems = (o) => (o.items || []).filter((it) => it.refundState === 'done');
  const refundTitle = (o) => { const d = doneItems(o); return d.length && d.length < (o.items || []).length ? d.map((it) => it.title).join(' / ') : titleOf(o); };

  for (const o of Object.values(orders)) {
    const cur = { st: o.status || null, eta: (o.eta && o.eta.end) || null, rf: (o.refund && o.refund.state) || null };
    if (perItem(o)) cur.rd = doneItems(o).length;
    next.orders[o.id] = cur;
    const p = prev && prev.orders && prev.orders[o.id];
    if (!p) continue;
    if (cfg.delivered && p.st !== 'delivered' && cur.st === 'delivered') out.push({ id: ref(o.id), title: '배송 완료', msg: titleOf(o) });
    else if (cfg.eta && p.eta && cur.eta && p.eta !== cur.eta && cur.st !== 'delivered') out.push({ id: ref(o.id), title: '도착 예정일 변경', msg: `${fmtMD(p.eta)} → ${fmtMD(cur.eta)} · ${titleOf(o)}` });
    const refundDone = cur.rd !== undefined && p.rd !== undefined ? cur.rd > p.rd : (p.rf === 'processing' && cur.rf === 'done');
    if (cfg.refund && refundDone) out.push({ id: ref(o.id), title: '환불 완료', msg: refundTitle(o) });
  }
  for (const x of s.protectSoon) {
    const seen = !!(prev && prev.protect && prev.protect[x.orderId]);
    next.protect[x.orderId] = true;
    if (prev && !rebase && !seen && cfg.protect) out.push({ id: ref(x.orderId), title: '구매자 보호 기간 임박', msg: `${x.daysLeft <= 0 ? '오늘 종료' : 'D-' + x.daysLeft} · ${x.title}` });
  }
  const cs = s.customs || { single: [], groups: [] };
  for (const x of cs.single) {
    next.customs['o' + x.orderId] = true;
    if (prev && !rebase && !(prev.customs && prev.customs['o' + x.orderId]) && cfg.customs) out.push({ id: ref(x.orderId), title: `관세 면세 한도($${cs.limit}) 초과 주문`, msg: `$${x.usd.toFixed(0)} · ${x.title}` });
  }
  for (const g of cs.groups) {
    const k = 'g' + g.store + g.date;
    next.customs[k] = true;
    if (prev && !rebase && !(prev.customs && prev.customs[k]) && cfg.customs) out.push({ id: ref(g.orderIds[0]), title: '같은 날 같은 상점 주문 합계가 관세 한도 초과', msg: `${g.store} · ${g.orderIds.length}건 $${g.usd.toFixed(0)}` });
  }

  if (!prev || !out.length) { await setStore({ [keys.notify]: next }); return 0; }
  const budget = Math.max(0, MAX_PER_HOUR - next.sent.length);
  const show = out.slice(0, Math.min(MAX_PER_CHECK, budget));
  for (const n of show) {
    next.sent.push(Date.now());
    chrome.notifications.create(`aes|${n.id}|${Date.now()}|${Math.random().toString(36).slice(2, 6)}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: n.title, message: String(n.msg).slice(0, 180), priority: 1
    });
  }
  const rest = out.length - show.length;
  if (rest > 0 && next.sent.length < MAX_PER_HOUR) {
    next.sent.push(Date.now());
    chrome.notifications.create(`aes|summary|${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: tb ? '타오바오 주문 통계' : '알리 주문 통계', message: `그 밖에 변경 ${rest}건` });
  }
  await setStore({ [keys.notify]: next });
  return show.length;
}

chrome.notifications.onClicked.addListener(async (nid) => {
  let [, id] = String(nid).split('|');
  const { settings = {} } = await getStore('settings');
  if (id === 'update') { chrome.runtime.openOptionsPage(); return; }
  const tb = /^tb:/.test(id || '');
  if (tb) id = id.slice(3);
  const url = id && id !== 'summary' ? orderDetailUrl(settings, id, tb ? 'taobao' : undefined) : (tb ? TB_LIST_URL : `${originOf(settings)}/p/order/index.html`);
  chrome.tabs.create({ url });
  chrome.notifications.clear(nid);
});
