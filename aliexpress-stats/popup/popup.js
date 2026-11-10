// 툴바 팝업: 저장된 데이터만으로 요약 (주문 페이지를 열지 않는다)
// 상단 전환 버튼으로 알리 / 타오바오 중 하나만 보여 준다. 마지막으로 본 사이트를 기억한다.
'use strict';
const $ = (id) => document.getElementById(id);

const TB_LIST = 'https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm';
const tbDetail = (id) => `https://trade.taobao.com/trade/detail/trade_order_detail.htm?biz_order_id=${encodeURIComponent(id)}`;
const SITE_KEY = 'aesPopupSite';

let site = null;                                     // 'ali' | 'taobao' (처음 그릴 때 정한다)
const savedSite = () => { try { const v = localStorage.getItem(SITE_KEY); return v === 'ali' || v === 'taobao' ? v : null; } catch (_) { return null; } };
const saveSite = (v) => { try { localStorage.setItem(SITE_KEY, v); } catch (_) {} };

const kpi = (l, v) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
const lastUpdated = (orders) => Math.max(0, ...Object.values(orders).map((o) => o.updated || 0));
const fmtUpd = (t) => (t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const empty = (name, how) => `<div class="empty">아직 수집된 ${name} 주문이 없습니다<br><span style="font-size:12px">${how}</span></div>`;

function refundCard(s) {
  if (!s.refundCount.processing) return '';
  const est = s.refunds.some((r) => r.state === 'processing' && r.estimated) ? '약 ' : '';
  return `<div class="card"><div class="h"><span>잔여 환불 예정 금액</span><span class="muted">${s.refundCount.processing}건</span></div><div class="big">${est}${esc(moneyMap(s.refundSum.processing, s.primary))}</div></div>`;
}

function aliView(s, settings) {
  const origin = settings.lastOrigin || 'https://www.aliexpress.com';
  const detail = (id) => `${origin}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
  let h = '';
  if (s.protectSoon.length) {
    h += `<div class="card red"><div class="h"><span>구매자 보호 기간 임박</span><span>${s.protectSoon.length}건</span></div>` +
      s.protectSoon.slice(0, 3).map((p) => `<a class="ln" data-url="${esc(detail(p.orderId))}"><span>${esc(p.title)}</span><b>${p.daysLeft <= 0 ? '오늘 종료' : 'D-' + p.daysLeft}</b></a>`).join('') + '</div>';
  }
  if (s.customs && s.customs.count) h += `<div class="card amber"><div class="h"><span>관세 면세 한도 $${s.customs.limit} 주의</span><span>${s.customs.count}건</span></div></div>`;
  const arrive7 = new Set(s.inProgress.filter((x) => x.daysLeft != null && x.daysLeft <= 7).map((x) => x.orderId)).size;
  h += `<div class="grid">${kpi('배송 전', s.statusOrders.pending_ship + '건')}${kpi('배송 중', s.statusOrders.shipping + '건')}${kpi('7일 내 도착', arrive7 + '건')}</div>`;
  h += refundCard(s);
  const soon = s.inProgress.filter((r) => r.etaEnd).slice(0, 6);
  if (soon.length) h += '<h2>도착 예정</h2>' + soon.map((r) => `<a class="ln" data-url="${esc(detail(r.orderId))}"><span>${esc(r.title)}</span><b>${dday(r) || '-'}</b></a>`).join('');
  return h;
}

/** 타오바오: 예상 도착일·구매자 보호 기간이 없으므로 배송 대기·진행 목록과 환불 위주 */
function taobaoView(s, orders) {
  let h = '';
  if (s.customs && s.customs.count) h += `<div class="card amber"><div class="h"><span>한국 직배송 관세 한도 $${s.customs.limit} 주의</span><span>${s.customs.count}건</span></div></div>`;
  h += `<div class="grid">${kpi('배송 전', s.statusOrders.pending_ship + '건')}${kpi('배송 중', s.statusOrders.shipping + '건')}${kpi('환불 진행', s.refundCount.processing + '건')}</div>`;
  h += refundCard(s);
  const ids = new Set(), rows = [];
  for (const r of s.inProgress) if (!ids.has(r.orderId) && rows.length < 6) { ids.add(r.orderId); rows.push(r); }
  if (rows.length) h += '<h2>배송 대기·진행</h2>' + rows.map((r) => `<a class="ln" data-url="${esc(tbDetail(r.orderId))}"><span>${esc(r.title)}</span><b>${r.status === 'shipping' ? '배송 중' : '배송 전'}</b></a>`).join('');
  const est = AES.taobao.estimatedCount(orders);
  if (est) h += `<div class="muted" style="margin-top:8px;font-size:12px">위안 금액을 환율로 환산한 주문 ${est}건 (추정). 타오바오 주문 목록에서 새로고침하면 원화 결제액으로 바뀝니다.</div>`;
  return h;
}

async function draw() {
  const r = await chrome.storage.local.get(['orders', 'settings', 'updateInfo', 'tb_orders', 'tb_settings']);
  const orders = r.orders || {}, settings = r.settings || {}, updateInfo = r.updateInfo || null;
  const tbOrders = r.tb_orders || {}, tbSettings = r.tb_settings || {};
  const hasAli = Object.keys(orders).length > 0, hasTb = Object.keys(tbOrders).length > 0;
  if (!site) site = savedSite() || (hasAli || !hasTb ? 'ali' : 'taobao');
  const tb = site === 'taobao';

  const s = AES.computeStats(orders, AES.statsOptions(settings));
  const ts = AES.computeStats(tbOrders, AES.taobao.statsOptionsFor(tbSettings, tbOrders));
  // 전환 버튼: 각 사이트의 배송 대기·진행 건수
  const pending = (x) => x.statusOrders.pending_ship + x.statusOrders.shipping;
  $('s-ali').innerHTML = `알리${hasAli && pending(s) ? `<b>${pending(s)}</b>` : ''}`;
  $('s-taobao').innerHTML = `타오바오${hasTb && pending(ts) ? `<b>${pending(ts)}</b>` : ''}`;
  for (const b of document.querySelectorAll('.site button')) { const on = b.dataset.site === site; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  document.body.classList.toggle('tb', tb);
  $('upd').textContent = fmtUpd(lastUpdated(tb ? tbOrders : orders));
  $('open').textContent = tb ? '타오바오 주문' : '알리 주문';
  $('refresh').hidden = tb;                          // 백그라운드 갱신은 알리 주문 페이지만 지원

  let h = '';
  if (updateInfo && updateInfo.available) h += `<div class="card amber"><div class="h"><span>새 버전 ${esc(updateInfo.latest)}</span><span>현재 ${esc(updateInfo.running)}</span></div></div>`;
  if (tb) h += hasTb ? taobaoView(ts, tbOrders) : empty('타오바오', '타오바오 주문 목록에서 패널을 열고 "불러오기"를 누르세요');
  else h += hasAli ? aliView(s, settings) : empty('알리', '알리 주문 페이지에서 패널을 열고 "불러오기"를 누르세요');
  $('body').innerHTML = h;
}

document.addEventListener('click', (e) => {
  const sb = e.target.closest('.site button');
  if (sb) { if (sb.dataset.site !== site) { site = sb.dataset.site; saveSite(site); $('status').textContent = ''; draw(); } return; }
  const a = e.target.closest('[data-url]');
  if (a) { chrome.tabs.create({ url: a.dataset.url }); window.close(); }
});
$('open').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  chrome.tabs.create({ url: site === 'taobao' ? TB_LIST : `${settings.lastOrigin || 'https://www.aliexpress.com'}/p/order/index.html` });
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
chrome.storage.onChanged.addListener((c) => { if (c.orders || c.tb_orders || c.updateInfo) draw(); });
draw();
