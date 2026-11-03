// 툴바 팝업: 저장된 데이터만으로 요약 (알리 페이지를 열지 않는다)
'use strict';
const $ = (id) => document.getElementById(id);

async function draw() {
  const { orders = {}, settings = {}, updateInfo = null } = await chrome.storage.local.get(['orders', 'settings', 'updateInfo']);
  const s = AES.computeStats(orders, AES.statsOptions(settings));
  const origin = settings.lastOrigin || 'https://www.aliexpress.com';
  const detail = (id) => `${origin}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
  const last = Math.max(0, ...Object.values(orders).map((o) => o.updated || 0));
  $('upd').textContent = last ? new Date(last).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  if (!Object.keys(orders).length) { $('body').innerHTML = '<div class="empty">아직 수집된 주문이 없습니다</div>'; return; }

  let h = '';
  if (updateInfo && updateInfo.available) h += `<div class="card amber"><div class="h"><span>새 버전 ${esc(updateInfo.latest)}</span><span>현재 ${esc(updateInfo.running)}</span></div></div>`;
  if (s.protectSoon.length) {
    h += `<div class="card red"><div class="h"><span>구매자 보호 기간 임박</span><span>${s.protectSoon.length}건</span></div>` +
      s.protectSoon.slice(0, 3).map((p) => `<a class="ln" data-url="${esc(detail(p.orderId))}"><span>${esc(p.title)}</span><b>${p.daysLeft <= 0 ? '오늘 종료' : 'D-' + p.daysLeft}</b></a>`).join('') + '</div>';
  }
  if (s.customs && s.customs.count) h += `<div class="card amber"><div class="h"><span>관세 면세 한도 $${s.customs.limit} 주의</span><span>${s.customs.count}건</span></div></div>`;
  h += `<div class="grid">
    <div class="kpi"><div class="l">배송 전</div><div class="v">${s.statusOrders.pending_ship}건</div></div>
    <div class="kpi"><div class="l">배송 중</div><div class="v">${s.statusOrders.shipping}건</div></div>
    <div class="kpi"><div class="l">7일 내 도착</div><div class="v">${new Set(s.inProgress.filter((r) => r.daysLeft != null && r.daysLeft <= 7).map((r) => r.orderId)).size}건</div></div></div>`;
  if (s.refundCount.processing) {
    h += `<div class="card"><div class="h"><span>잔여 환불 예정 금액</span><span class="muted">${s.refundCount.processing}건</span></div><div class="big">${esc(moneyMap(s.refundSum.processing, s.primary))}</div></div>`;
  }
  const soon = s.inProgress.filter((r) => r.etaEnd).slice(0, 6);
  if (soon.length) h += '<h2>도착 예정</h2>' + soon.map((r) => `<a class="ln" data-url="${esc(detail(r.orderId))}"><span>${esc(r.title)}</span><b>${dday(r) || '-'}</b></a>`).join('');
  $('body').innerHTML = h;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-url]');
  if (a) { chrome.tabs.create({ url: a.dataset.url }); window.close(); }
});
$('open').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  chrome.tabs.create({ url: `${settings.lastOrigin || 'https://www.aliexpress.com'}/p/order/index.html` });
  window.close();
};
$('refresh').onclick = async () => {
  $('refresh').disabled = true;
  $('status').textContent = '백그라운드 탭에서 갱신 중…';
  const r = await chrome.runtime.sendMessage({ type: 'refreshNow' });
  const msg = { done: '갱신 완료', busy: '이미 갱신 중입니다', 'no-window': '브라우저 창이 없습니다', timeout: '시간 초과', 'no-tab': '탭을 열 수 없습니다' };
  $('status').textContent = msg[r && r.result] || '갱신 실패';
  $('refresh').disabled = false;
  draw();
};
$('opts').onclick = () => chrome.runtime.openOptionsPage();
chrome.storage.onChanged.addListener((c) => { if (c.orders || c.updateInfo) draw(); });
draw();
