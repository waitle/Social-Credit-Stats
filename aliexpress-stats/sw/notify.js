// 변화 알림: 배송 완료, 도착 예정일 변경, 환불 완료, 구매자 보호 기간 임박, 관세 한도 주의
// 알림 폭주 방지:
//  - 처음 실행 때는 현재 상태를 기준점으로만 저장하고 알리지 않는다
//  - 환율/관세 한도/보호 기간 설정이 바뀐 직후에는 그 변화로 생긴 경고를 알리지 않고 기준점만 다시 잡는다
//  - 한 번에 개별 알림은 최대 3개, 한 시간에 최대 8개 (나머지는 요약 1개)
'use strict';

const NOTIFY_DEFAULT = { delivered: true, eta: true, refund: true, protect: true, customs: true };
const MAX_PER_CHECK = 3, MAX_PER_HOUR = 8;

async function checkNotifications() {
  const { orders, settings, stats: s } = await loadStats();
  const { notifyState: prev } = await getStore('notifyState');
  const cfg = Object.assign({}, NOTIFY_DEFAULT, settings.notify || {});
  // 경고 계산에 쓰이는 설정이 바뀌었는지 (환율은 추정값이 조금씩 흔들려도 같은 것으로 보도록 50원 단위로 묶는다)
  const sig = [settings.usdRate || 'auto', settings.customsLimit || 150, settings.protectDays != null ? settings.protectDays : 7, Math.round(((s.customs && s.customs.krwPerUsd) || 0) / 50)].join('|');
  const rebase = !!(prev && prev.sig !== sig);
  const hourAgo = Date.now() - 3600000;
  const next = { orders: {}, protect: {}, customs: {}, sig, sent: ((prev && prev.sent) || []).filter((t) => t > hourAgo) };
  const out = [];
  const titleOf = (o) => (o.items && o.items[0] && o.items[0].title) || `주문 ${o.id}`;

  for (const o of Object.values(orders)) {
    const cur = { st: o.status || null, eta: (o.eta && o.eta.end) || null, rf: (o.refund && o.refund.state) || null };
    next.orders[o.id] = cur;
    const p = prev && prev.orders && prev.orders[o.id];
    if (!p) continue;
    if (cfg.delivered && p.st !== 'delivered' && cur.st === 'delivered') out.push({ id: o.id, title: '배송 완료', msg: titleOf(o) });
    else if (cfg.eta && p.eta && cur.eta && p.eta !== cur.eta && cur.st !== 'delivered') out.push({ id: o.id, title: '도착 예정일 변경', msg: `${fmtMD(p.eta)} → ${fmtMD(cur.eta)} · ${titleOf(o)}` });
    if (cfg.refund && p.rf === 'processing' && cur.rf === 'done') out.push({ id: o.id, title: '환불 완료', msg: titleOf(o) });
  }
  for (const x of s.protectSoon) {
    const seen = !!(prev && prev.protect && prev.protect[x.orderId]);
    next.protect[x.orderId] = true;
    if (prev && !rebase && !seen && cfg.protect) out.push({ id: x.orderId, title: '구매자 보호 기간 임박', msg: `${x.daysLeft <= 0 ? '오늘 종료' : 'D-' + x.daysLeft} · ${x.title}` });
  }
  const cs = s.customs || { single: [], groups: [] };
  for (const x of cs.single) {
    next.customs['o' + x.orderId] = true;
    if (prev && !rebase && !(prev.customs && prev.customs['o' + x.orderId]) && cfg.customs) out.push({ id: x.orderId, title: `관세 면세 한도($${cs.limit}) 초과 주문`, msg: `$${x.usd.toFixed(0)} · ${x.title}` });
  }
  for (const g of cs.groups) {
    const k = 'g' + g.store + g.date;
    next.customs[k] = true;
    if (prev && !rebase && !(prev.customs && prev.customs[k]) && cfg.customs) out.push({ id: g.orderIds[0], title: '같은 날 같은 상점 주문 합계가 관세 한도 초과', msg: `${g.store} · ${g.orderIds.length}건 $${g.usd.toFixed(0)}` });
  }

  if (!prev || !out.length) { await setStore({ notifyState: next }); return 0; }
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
    chrome.notifications.create(`aes|summary|${Date.now()}`, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: '알리 주문 통계', message: `그 밖에 변경 ${rest}건` });
  }
  await setStore({ notifyState: next });
  return show.length;
}

chrome.notifications.onClicked.addListener(async (nid) => {
  const [, id] = String(nid).split('|');
  const { settings = {} } = await getStore('settings');
  if (id === 'update') { chrome.runtime.openOptionsPage(); return; }
  const url = id && id !== 'summary' ? orderDetailUrl(settings, id) : `${originOf(settings)}/p/order/index.html`;
  chrome.tabs.create({ url });
  chrome.notifications.clear(nid);
});
