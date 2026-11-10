// 툴바 아이콘 배지: 배송 대기·진행 건수, 주의 항목이 있으면 빨간색
'use strict';

async function refreshBadge() {
  const { stats: s } = await loadStats();
  const { orders: tbOrders, stats: t } = await loadStats('taobao');
  const hasTb = Object.keys(tbOrders).length > 0;
  const { updateInfo } = await getStore('updateInfo');
  const n = s.statusOrders.pending_ship + s.statusOrders.shipping + (hasTb ? t.statusOrders.pending_ship + t.statusOrders.shipping : 0);
  const warn = s.protectSoon.length + (s.customs ? s.customs.count : 0) + (hasTb ? t.protectSoon.length + (t.customs ? t.customs.count : 0) : 0);
  let text = n ? String(n) : '';
  if (!text && updateInfo && updateInfo.available) text = 'UP';
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: warn ? '#e62e2e' : '#2563eb' });
  const lines = [`${hasTb ? '알리 ' : ''}배송 전 ${s.statusOrders.pending_ship} · 배송 중 ${s.statusOrders.shipping}`];
  if (hasTb) lines.push(`타오바오 배송 전 ${t.statusOrders.pending_ship} · 배송 중 ${t.statusOrders.shipping}`);
  if (s.protectSoon.length) lines.push(`구매자 보호 기간 임박 ${s.protectSoon.length}건`);
  if (s.customs && s.customs.count) lines.push(`관세 한도 주의 ${s.customs.count}건`);
  if (updateInfo && updateInfo.available) lines.push(`새 버전 ${updateInfo.latest}`);
  await chrome.action.setTitle({ title: (hasTb ? '주문 통계 (알리·타오바오)\n' : '알리 주문 통계\n') + lines.join('\n') });
  return s;
}
