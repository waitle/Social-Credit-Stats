// 알리 주문 통계 - 패널 UI (스타일, 화면, 이벤트)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
let host = null, root = null, panel = null, fab = null;

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.w{--bg:#fff;--fg:#1d1d1f;--mu:#6b7280;--bd:#e5e7eb;--card:#f7f7f9;--ac:#e62e2e;--ac2:#2563eb;--ok:#16a34a;--wa:#d97706;
   font:13px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Roboto,sans-serif;color:var(--fg)}
@media(prefers-color-scheme:dark){.w{--bg:#18181b;--fg:#f4f4f5;--mu:#a1a1aa;--bd:#33333a;--card:#232328;--ac:#ff5a5a;--ac2:#60a5fa;--ok:#4ade80;--wa:#fbbf24}}
.fab{position:fixed;right:18px;bottom:18px;background:var(--ac);color:#fff;border:0;border-radius:999px;padding:11px 16px;font:600 13px inherit;font-family:inherit;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)}
.fab:hover{filter:brightness(1.08)}
.panel{position:fixed;top:0;right:0;height:100vh;width:min(470px,100vw);background:var(--bg);border-left:1px solid var(--bd);box-shadow:-8px 0 30px rgba(0,0,0,.18);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s ease}
.panel.open{transform:none}
header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bd)}
header h1{font-size:15px;margin:0;flex:1}
.x{background:none;border:0;font-size:20px;color:var(--mu);cursor:pointer;line-height:1}
.tabs{display:flex;border-bottom:1px solid var(--bd)}
.tab{flex:1;padding:9px 4px;background:none;border:0;border-bottom:2px solid transparent;color:var(--mu);font:inherit;cursor:pointer}
.tab.on{color:var(--ac);border-color:var(--ac);font-weight:600}
.body{flex:1;overflow:auto;padding:14px}
.tools{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--bd);background:var(--card);align-items:center}
button.b{font:inherit;padding:6px 10px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:8px;cursor:pointer}
button.b:hover{border-color:var(--ac)}
button.b.pri{background:var(--ac);border-color:var(--ac);color:#fff}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.kpi{background:var(--card);border-radius:10px;padding:10px 12px}
.kpi .l{color:var(--mu);font-size:11px}
.kpi .v{font-size:18px;font-weight:700;margin-top:2px;word-break:keep-all}
.kpi .s{color:var(--mu);font-size:11px;margin-top:2px}
.kpi.hl .v{color:var(--ac)}
.kpi.ok .v{color:var(--ok)}
.sum{display:grid;grid-template-columns:1.5fr 1fr;gap:1px;background:var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px}
.sum>div{background:var(--card);padding:12px 14px}
.sum .l{color:var(--mu);font-size:11px}
.sum .v{font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
.sum .big{font-size:22px;color:var(--ac)}
.sum .s{color:var(--mu);font-size:11px;margin-top:2px}
a.row,a.rf{color:inherit;text-decoration:none;margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px}
a.row:hover,a.rf:hover{background:var(--card)}
.seg{display:flex;gap:6px;margin-bottom:6px}
.seg button{flex:1;padding:6px 4px;border:1px solid var(--bd);background:var(--bg);color:var(--mu);border-radius:8px;font:inherit;cursor:pointer}
.seg button.on{background:var(--card);color:var(--fg);border-color:var(--ac);font-weight:600}
.rf{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--bd)}
.rf img,.rf .ph{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--card)}
.rf .ti{display:block;font-weight:500;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rf .sub{display:flex;align-items:center;gap:6px;margin-top:4px}
.rf .amt{font-size:15px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.rf .amt.p{color:var(--wa)}.rf .amt.d{color:var(--ok)}.rf .amt.n{color:var(--mu);font-weight:400}
.eta{display:flex;align-items:baseline;gap:6px;margin-top:4px}
.eta .k{color:var(--mu);font-size:12px;font-weight:400}
.eta .dd{margin-left:auto}
.tools .main{display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1 1 100%}
.tools .more{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;flex:1 1 100%;padding:10px 0 2px;border-top:1px solid var(--bd)}
.tools .more .sep{flex:1 1 100%;height:0}
button.b.ghost{border-color:transparent;background:none;color:var(--mu)}
h2{font-size:13px;margin:16px 0 8px}
.bar{display:grid;grid-template-columns:140px 1fr auto;align-items:center;gap:8px;margin:5px 0}
.bar .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .tr{height:10px;background:var(--card);border-radius:5px;overflow:hidden}
.bar .f{height:100%;background:var(--ac2);border-radius:5px}
.bar .n{color:var(--mu);font-size:12px;text-align:right;min-width:36px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{background:var(--card);border-radius:999px;padding:3px 10px;font-size:12px}
.chip b{color:var(--ac)}
.row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--bd)}
.row img{width:52px;height:52px;object-fit:cover;border-radius:8px;background:var(--card);flex:none}
.row .ph{width:52px;height:52px;border-radius:8px;background:var(--card);flex:none}
.row .m{flex:1;min-width:0}
.row .ti{font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:inherit;text-decoration:none}
.row .sub{color:var(--mu);font-size:12px;margin-top:4px}
.row .eta{font-weight:600}
.badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;margin-right:4px}
.b-wait{background:#fef3c7;color:#92400e}.b-ship{background:#dbeafe;color:#1e40af}.b-done{background:#dcfce7;color:#166534}.b-cancel{background:#e5e7eb;color:#374151}
.dd{color:var(--ac);margin-left:6px;font-weight:700}
.muted{color:var(--mu);font-weight:400}
.empty{text-align:center;color:var(--mu);padding:40px 10px;line-height:1.7}
input.s{width:100%;padding:7px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;margin-bottom:8px}
.note{color:var(--mu);font-size:11.5px;margin-top:8px}
.prog{color:var(--ac2);font-size:12px;flex:1 1 100%}
.prog.warn{color:var(--wa)}
@keyframes aes-spin{to{transform:rotate(360deg)}}
@keyframes aes-slide{0%{left:-40%}100%{left:100%}}
.spin{display:inline-block;width:11px;height:11px;border:2px solid var(--bd);border-top-color:currentColor;border-radius:50%;animation:aes-spin .9s linear infinite;vertical-align:-2px;margin-right:6px}
.lbar{height:2px;position:relative;overflow:hidden;flex:none}
.lbar.on{background:var(--card)}
.lbar.on::after{content:'';position:absolute;top:0;bottom:0;width:40%;background:var(--ac2);border-radius:2px;animation:aes-slide 1.4s ease-in-out infinite;animation-delay:var(--d,0ms)}
.fab.busy::before{content:'';display:inline-block;width:11px;height:11px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:aes-spin .9s linear infinite;margin-right:8px;vertical-align:-2px}
@media (prefers-reduced-motion:reduce){.spin,.lbar.on::after,.fab.busy::before{animation-duration:3.5s}}
label.st{display:flex;align-items:center;gap:6px;color:var(--mu);font-size:12px}
label.st select{padding:3px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
label.st input{width:70px;padding:3px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg)}
.alert{border-radius:10px;padding:10px 12px;margin-bottom:10px;background:var(--card)}
.alert .h{display:flex;justify-content:space-between;font-weight:600;font-size:12.5px;margin-bottom:2px}
.alert.red .h{color:var(--ac)}.alert.amber .h{color:var(--wa)}
.alert a,.alert .ln{display:flex;justify-content:space-between;gap:8px;color:inherit;text-decoration:none;font-size:12px;padding:4px 0}
.alert a span:first-child,.alert .ln span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0}
.alert a b{flex:none}
.alert button.b{margin-top:6px}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 6px;border-radius:6px;background:var(--card);color:var(--mu);margin-left:6px}
.tag.red{background:#fee2e2;color:#b91c1c}
.trk{color:var(--mu);font-size:12px;margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.prow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-bottom:1px solid var(--bd)}
.prow a.row{border-bottom:0}
.prow select{font:inherit;font-size:11.5px;max-width:118px;padding:3px 4px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--mu)}
.prow select.ed{color:var(--fg);border-color:var(--ac2)}
.mini{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px}
.mini .v{font-size:16px}
`;

/** 패널(shadow DOM) 생성 + 이벤트 연결 */
function initUI() {
  host = document.createElement('div');
  host.id = 'aes-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
  root = host.attachShadow({ mode: 'open' });
  (document.body || document.documentElement).appendChild(host);
  if (!document.body) document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host));
  root.innerHTML = `<style>${CSS}</style><div class="w"><button class="fab" data-act="toggle">알리 통계</button><div class="panel" id="p"></div></div>`;
  panel = root.getElementById('p');
  fab = root.querySelector('.fab');
  bindEvents();
}

let renderQueued = false;
// 불러오는 동안 화면이 계속 다시 그려지는데, 드롭다운(<select>)이 열려 있을 때 요소를 갈아 끼우면 목록이 닫힌다.
// 선택 칸에 포커스가 있는 동안에는 백그라운드 갱신을 미뤘다가 포커스가 빠지면 한 번에 반영한다.
let renderDeferred = false;
const selectFocused = () => !!(root && root.activeElement && root.activeElement.tagName === 'SELECT');
function scheduleRender() {
  if (renderQueued) return; renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 250);
}

function barList(items, labelFn, valFn, fmt) {
  const max = Math.max(1, ...items.map(valFn));
  return items.map((it) => `<div class="bar"><div class="t" title="${esc(labelFn(it))}">${esc(labelFn(it))}</div><div class="tr"><div class="f" style="width:${Math.max(2, valFn(it) / max * 100)}%"></div></div><div class="n">${fmt(it)}</div></div>`).join('');
}

function emptyText() {
  return '수집된 주문이 없습니다';
}
function diagnose() {
  const body = document.body ? document.body.innerText || '' : '';
  const apiNames = [...new Set(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /mtop|acs\./i.test(n)).map((n) => (n.match(/mtop\.[\w.]+/) || [n.slice(0, 80)])[0]))];
  return {
    itemLinks: document.querySelectorAll('a[href*="/item/"], a[href*="/i/"]').length,
    orderWordCount: (body.match(/주문|Order/gi) || []).length,
    longDigits: (body.match(/\d{15,}/g) || []).length,
    iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 120)),
    apiNames, meta: state.meta,
    bodyTextSample: body.slice(0, 5000)
  };
}
const emptyView = () => `<div class="empty">${emptyText()}</div>`;
function countsBanner() {
  const c = state.counts; if (!c) return '';
  return `<div class="grid"><div class="kpi"><div class="l">알리 집계 · 배송 중</div><div class="v">${c.shipped}건</div></div>
    <div class="kpi"><div class="l">알리 집계 · 배송 전</div><div class="v">${c.processing}건</div>${c.unpaid ? `<div class="s">결제 대기 ${c.unpaid}건</div>` : ''}</div></div>`;
}
function loadedNote(s) {
  if (!state.counts) return '';
  const target = state.counts.shipped + state.counts.processing;
  const have = s.statusOrders.shipping + s.statusOrders.pending_ship;
  if (have >= target) return '';
  return `<div class="note" style="margin:-6px 0 12px;color:var(--wa)">배송 대기·진행 ${target}건 중 ${have}건만 불러옴</div>`;
}
function viewSummary(s) {
  if (!s.totalOrders) return countsBanner() + emptyView();
  const cats = s.categories.slice(0, 8);
  const months = s.monthly;                      // 전체 개월 표시 (12개월 제한 없음)
  const discNote = s.discountOrders ? `${s.discountOrders}건` : '없음';
  return countsBanner() + loadedNote(s) + alertsView(s) + `
  <div class="grid">
    <div class="kpi"><div class="l">구매한 상품</div><div class="v">${s.itemCount}개</div><div class="s">주문 ${s.orderCount}건</div></div>
    <div class="kpi"><div class="l">총 결제액</div><div class="v">${esc(moneyMap(s.spent, s.primary))}</div><div class="s">주문당 ${s.primaryOrders ? esc(money((s.spent[s.primary] || 0) / s.primaryOrders, s.primary)) : '-'}</div></div>
    <div class="kpi ok"><div class="l">받은 할인</div><div class="v">${esc(moneyMap(s.discount, s.primary))}</div><div class="s">${discNote}</div></div>
    <div class="kpi"><div class="l">배송 대기·진행</div><div class="v">${s.inProgressItems}개</div><div class="s">배송 전 ${s.pendingItems} · 배송 중 ${s.shippingItems}</div></div>
  </div>
  ${refundBanner(s)}
  <h2>주로 산 품목</h2>
  ${barList(cats, (c) => c.name, (c) => c.count, (c) => c.count + '개')}
  ${s.keywords.length ? `<h2>자주 나온 키워드</h2><div class="chips">${s.keywords.slice(0, 16).map((k) => `<span class="chip">${esc(k.word)} <b>${k.count}</b></span>`).join('')}</div>` : ''}
  ${months.length ? `<h2>월별 결제액 (${months.length}개월)</h2>${barList(months, (m) => m.month, (m) => m.spend, (m) => esc(money(m.spend, s.primary)))}` : ''}
  ${s.stores.length ? `<h2>자주 산 상점</h2>${barList(s.stores.slice(0, 6), (x) => x.name, (x) => x.orders, (x) => x.orders + '건')}` : ''}
  ${deliveryView(s)}`;
}

function viewShipping(s) {
  const f = state.shipFilter || 'all';
  const cnt = { all: s.inProgressItems + s.deliveredItems, pending_ship: s.pendingItems, shipping: s.shippingItems, delivered: s.deliveredItems };
  const chips = [['all', '전체'], ['pending_ship', '배송 전'], ['shipping', '배송 중'], ['delivered', '배송 완료']];
  const head = countsBanner() + loadedNote(s) + `<div class="seg">${chips.map(([k, t]) => `<button data-ship="${k}" class="${f === k ? 'on' : ''}">${t} ${cnt[k]}</button>`).join('')}</div>`;
  const rows = [...s.inProgress, ...s.delivered].filter((r) => f === 'all' || r.status === f);
  if (!rows.length) return head + (s.totalOrders ? '<div class="empty">해당하는 주문이 없습니다</div>' : emptyView());
  return head + rows.map((r) => `
    <a class="row" href="${esc(orderUrl(r.orderId))}" target="_blank" rel="noopener" title="주문 상세 열기">
      ${thumb(r.image)}
      <div class="m">
        <div class="ti">${esc(r.title)}</div>
        <div class="sub">${badge(r.status)}${r.qty > 1 ? `${r.qty}개 · ` : ''}주문일 ${fmtDate(r.orderDate)}${protectTag(r)}${r.deliveredAt ? ` · 도착 ${fmtShort(r.deliveredAt)}` : ''}</div>
        ${r.status === 'delivered' ? '' : etaLine(r)}
        ${trackLine(r.track)}
      </div>
    </a>`).join('');
}

/** 잔여 환불 예정 금액(크게) + 환불 완료 금액을 한 카드에 */
function refundBanner(s) {
  const c = s.refundCount; if (!c.processing && !c.done) return '';
  return `<div class="sum">
    <div><div class="l">잔여 환불 예정 금액</div><div class="v big">${c.processing ? esc(moneyMap(s.refundSum.processing, s.primary)) : '없음'}</div><div class="s">${c.processing ? `진행 중 ${c.processing}건` : '진행 중인 환불 없음'}</div></div>
    <div><div class="l">환불 완료</div><div class="v">${c.done ? esc(moneyMap(s.refundSum.done, s.primary)) : '-'}</div><div class="s">${c.done}건</div></div>
  </div>`;
}
const REFUND_BADGE = { processing: ['환불 진행 중', 'b-wait', 'p'], done: ['환불 완료', 'b-done', 'd'], none: ['환불 없음', 'b-cancel', 'n'] };
const AMT_SRC = { shown: '알리가 표시한 환불 금액', paid: '실제 결제한 총 금액 기준', list: '상품 표시가 기준' };
function viewRefunds(s) {
  if (!s.refunds.length) return '<div class="empty">취소·환불된 주문이 없습니다</div>';
  return refundBanner(s) +
    s.refunds.map((r) => {
      const [t, cls, ac] = REFUND_BADGE[r.state];
      const amt = r.state !== 'none' && r.amount ? esc(money(r.amount.amount, r.amount.currency || s.primary)) : '—';
      return `<a class="rf" href="${esc(orderUrl(r.orderId))}" target="_blank" rel="noopener" title="${esc(AMT_SRC[r.amountSrc] || '')} · 클릭하면 주문 상세 열기">
        ${thumb(r.image)}
        <div style="min-width:0">
          <div class="ti">${esc(r.title)}</div>
          <div class="sub"><span class="badge ${cls}" style="margin:0">${t}</span><span class="muted">${fmtShort(r.date)}</span></div>
        </div>
        <div class="amt ${ac}">${amt}</div>
      </a>`; }).join('');
}

function viewPurchases(s) {
  if (!s.purchases.length) return emptyView();
  const q = state.filter.trim().toLowerCase();
  const rows = s.purchases.filter((p) => !q || p.title.toLowerCase().includes(q) || p.category.includes(q));
  return `<input class="s" data-input="filter" placeholder="상품명·분류 검색" value="${esc(state.filter)}">` +
    rows.slice(0, 300).map((p) => `
    <div class="prow">
      <a class="row" href="${esc(orderUrl(p.orderId))}" target="_blank" rel="noopener" title="주문 상세 열기">
        ${thumb(p.image)}
        <div class="m">
          <div class="ti">${esc(p.title)}</div>
          <div class="sub">${badge(p.status)}${fmtDate(p.date, true)}</div>
          <div class="sub">${p.price ? esc(money(p.price.amount, p.price.currency || s.primary)) : '-'}${p.qty > 1 ? ` × ${p.qty}` : ''}</div>
        </div>
      </a>
      <select data-cat="${esc(p.catKey)}" class="${p.catEdited ? 'ed' : ''}" title="분류 변경">${catOptions(p.category, p.catEdited)}</select>
    </div>`).join('') + (rows.length > 300 ? `<div class="note">${rows.length}개 중 300개 표시</div>` : '');
}

const orderUrl = (id) => `${location.origin}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
const thumb = (src) => (src && state.settings.thumbs !== false ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<div class="ph"></div>');

function computeNow() {
  return AES.computeStats(state.orders, AES.statsOptions(state.settings, { since: cutoffOf(state.settings.period || '1w') }));
}

function render() { if (selectFocused()) { renderDeferred = true; return; } renderNow(); }
function renderNow() {
  if (!panel) return;                              // 백그라운드 갱신 탭에는 패널이 없다
  const s = computeNow();
  state.stats = s;
  const tabs = [['summary', '요약'], ['shipping', `배송 현황${s.inProgress.length ? ` (${s.inProgressItems})` : ''}`], ['refunds', `취소·환불${s.refunds.length ? ` (${s.refunds.length})` : ''}`], ['purchases', '구매 내역']];
  const body = state.tab === 'summary' ? viewSummary(s) : state.tab === 'shipping' ? viewShipping(s) : state.tab === 'refunds' ? viewRefunds(s) : viewPurchases(s);
  const keepScroll = panel.querySelector('.body') ? panel.querySelector('.body').scrollTop : 0;
  // 다시 그려도 입력 중이던 칸의 포커스·값·커서를 유지한다 (불러오는 동안 화면이 계속 갱신되므로)
  const fe = root.activeElement && root.activeElement.dataset && root.activeElement.dataset.input ? root.activeElement : null;
  const focusKey = fe ? fe.dataset.input : null, focusVal = fe ? fe.value : null;
  let focusSel = null; try { focusSel = fe ? [fe.selectionStart, fe.selectionEnd] : null; } catch (_) {}
  const busy = !!(state.loading || state.detail);
  const phase = (ms) => `${-Math.round(performance.now() % ms)}ms`;           // 다시 그려도 애니메이션이 끊기지 않도록 위상을 이어 준다
  const spin = `<i class="spin" style="animation-delay:${phase(900)}"></i>`;
  const period = state.settings.period || '1w', rs = state.settings.resume;
  const resumable = !state.loading && !!(rs && rs.oldest) && !coversCutoff(cutoffOf(period));
  const autoRate = s.estimatedRates.USD ? Math.round(s.estimatedRates.USD) : '';
  panel.className = 'panel' + (state.open ? ' open' : '');
  panel.innerHTML = `
    <header><h1>알리 주문 통계</h1><button class="x" data-act="toggle" title="닫기">×</button></header>
    <div class="lbar ${busy ? 'on' : ''}" style="--d:${phase(1400)}"></div>
    <div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
    <div class="body">${body}</div>
    <div class="tools">
      ${state.progress ? `<div class="prog ${state.paused ? 'warn' : ''}">${state.loading ? spin : ''}${esc(state.progress)}</div>` : ''}
      ${state.progressDetail ? `<div class="prog">${state.detail ? spin : ''}${esc(state.progressDetail)}</div>` : ''}
      ${!state.loading && !coversCutoff(cutoffOf(period)) ? `<div class="prog warn">${resumable ? `${esc(periodInfo(period)[1])} 내역을 ${esc(rs.oldest)}까지 불러왔습니다` : `${esc(periodInfo(period)[1])} 내역을 아직 불러오지 않았습니다`}</div>` : ''}
      <div class="main">
        <label class="st">기간 <select data-input="period">${PERIODS.map((p) => `<option value="${p[0]}" ${(state.settings.period || '1w') === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></label>
        ${state.loading ? '<button class="b" data-act="stop">중단</button>' : '<button class="b pri" data-act="loadall">' + (resumable ? '이어서 불러오기' : '불러오기') + '</button>'}
        ${state.detail ? '<button class="b" data-act="stopdetail">조회 중단</button>' : '<button class="b" data-act="details">예상 배송일 조회</button>'}
        <button class="b ghost" data-act="more" style="margin-left:auto">설정 ${state.moreOpen ? '▴' : '▾'}</button>
      </div>
      ${state.moreOpen ? `<div class="more">
        <label class="st" title="체크하면 기간과 무관하게 배송 대기·진행 중인 주문을 모두 불러옵니다 (최대 75일 전까지)"><input type="checkbox" data-input="ship" ${state.settings.includeShipping !== false ? 'checked' : ''} style="width:auto"> 배송 중 주문 항상 포함</label>
        <label class="st" title="주문 페이지를 열면 자동으로 목록 + 예상 배송일을 수집"><input type="checkbox" data-input="auto" ${state.settings.auto === true ? 'checked' : ''} style="width:auto"> 자동 실행</label>
        <label class="st"><input type="checkbox" data-input="thumbs" ${state.settings.thumbs !== false ? 'checked' : ''} style="width:auto"> 썸네일</label>
        <label class="st" title="비워두면 같은 상품의 두 통화 가격으로 자동 추정">USD 환율(원) <input type="number" min="500" max="3000" placeholder="${autoRate || '자동'}" value="${state.settings.usdRate > 0 ? state.settings.usdRate : ''}" data-input="fx"></label>
        <label class="st" title="같은 상점·같은 날 주문 합계 또는 주문 1건이 이 금액을 넘으면 경고">관세 한도($) <input type="number" min="1" max="10000" value="${state.settings.customsLimit || 150}" data-input="customs"></label>
        <label class="st" title="구매자 보호 기간 종료까지 남은 일수가 이 값 이하이면 경고">보호 기간 경고(일) <input type="number" min="1" max="60" value="${state.settings.protectDays != null ? state.settings.protectDays : 7}" data-input="protectDays"></label>
        <div class="sep"></div>
        <button class="b" data-act="backup">백업 파일</button>
        <button class="b" data-act="restore">복원</button>
        <button class="b" data-act="options">고급 설정</button>
        <button class="b" data-act="rescan">다시 읽기</button>
        <button class="b" data-act="csv">CSV</button>
        <button class="b" data-act="debug" title="파싱이 이상할 때 원본 구조를 내보냅니다 (주소 등 개인정보가 포함될 수 있으니 공유 전 확인)">디버그</button>
        <button class="b" data-act="clear">초기화</button>
      </div>` : ''}
      <div class="note" style="flex:1 1 100%;margin:0">수집된 주문 ${s.totalOrders}건</div>
    </div>`;
  fab.style.display = state.open ? 'none' : '';
  fab.classList.toggle('busy', busy);
  const b = panel.querySelector('.body'); if (b) b.scrollTop = keepScroll;
  if (focusKey) {
    const i = panel.querySelector(`[data-input="${focusKey}"]`);
    if (i && i.type !== 'checkbox') {
      if (focusVal != null) i.value = focusVal;
      i.focus();
      try { i.setSelectionRange(focusSel ? focusSel[0] : i.value.length, focusSel ? focusSel[1] : i.value.length); } catch (_) {}
    }
  }
}

/** 진행 중인 목록·예상 배송일 조회를 먼저 멈춘 뒤 모든 기록을 지우고, 페이지를 새로 열어 1페이지부터 다시 시작할 수 있게 한다 */
async function resetAll() {
  state.cancel = true; state.cancelDetail = true;
  try { chrome.runtime.sendMessage({ type: 'cancelDetails' }); } catch (_) {}
  state.progress = '조회를 멈추고 초기화하는 중…'; renderNow();
  for (let i = 0; i < 100 && (state.loading || state.detail); i++) await sleep(50);   // 최대 5초
  await store.clear();                                                                // 이후 남은 작업이 있어도 저장되지 않는다 (store.locked)
  try { sessionStorage.setItem('aes-empty', '1'); } catch (_) {}                       // 새로 열린 페이지는 조회를 시작할 때까지 비어 있게
  location.reload();
}

/** "불러오기" 버튼. 이미 불러온 범위 안이면 이 화면의 1페이지는 열 때 받은 것이라 오래됐을 수 있으므로, 페이지를 새로 열어 최신 주문부터 다시 확인한다 */
function requestLoad() {
  if (state.loading) return;
  if (coversCutoff(cutoffOf(state.settings.period || '1w'))) {
    state.progress = '최신 주문을 확인하려고 페이지를 새로 엽니다…'; renderNow();
    try { sessionStorage.setItem('aes-run-once', '1'); } catch (_) {}
    store.flush().then(() => location.reload());
    return;
  }
  loadAll();
}

function bindEvents() {
  root.addEventListener('focusout', () => { if (renderDeferred) { renderDeferred = false; scheduleRender(); } });
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-tab],[data-ship]'); if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; renderNow(); return; }
    if (t.dataset.ship) { state.shipFilter = t.dataset.ship; renderNow(); return; }
    const act = t.dataset.act;
    if (act === 'more') { state.moreOpen = !state.moreOpen; renderNow(); }
    else if (act === 'toggle') { state.open = !state.open; if (state.open) scanDom(); renderNow(); }
    else if (act === 'loadall') requestLoad();
    else if (act === 'stop') { state.cancel = true; }
    else if (act === 'details') { releaseHold(); fetchDetails(true); }
    else if (act === 'stopdetail') { state.cancelDetail = true; try { chrome.runtime.sendMessage({ type: 'cancelDetails' }); } catch (_) {} }
    else if (act === 'rescan') { releaseHold(); const n = scanDom(true); state.progress = `다시 읽음 (변경 ${n}건)`; renderNow(); }
    else if (act === 'csv') exportCsv();
    else if (act === 'backup') exportBackup();
    else if (act === 'restore') importBackup();
    else if (act === 'options') { try { chrome.runtime.sendMessage({ type: 'openOptions' }); } catch (_) {} }
    else if (act === 'debug') exportDebug();
    else if (act === 'clear') { if (confirm('저장된 주문 통계 데이터를 모두 지울까요? (진행 중인 조회는 중단됩니다)')) resetAll(); }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.tagName === 'SELECT') t.blur();           // 고른 뒤에는 포커스를 풀어야 이후 진행 표시 갱신이 멈추지 않는다
    if (t.dataset.input === 'filter') { state.filter = t.value; renderNow(); }
    if (t.dataset.cat !== undefined) {
      const m = state.settings.catOverrides || (state.settings.catOverrides = {});
      if (t.value) m[t.dataset.cat] = t.value; else delete m[t.dataset.cat];
      store.save(); renderNow(); return;
    }
    if (t.dataset.input === 'ship') { state.settings.includeShipping = !!t.checked; store.save(); }
    if (t.dataset.input === 'period') {
      const nk = t.value, prevK = state.settings.period || '1w';
      if (nk === prevK) return;
      if (needsConfirm(nk) && !confirmHeavy(periodInfo(nk)[1])) { renderNow(); return; }     // 거절하면 기존 기간 유지
      state.settings.period = nk; store.save(); renderNow();
      if (!coversCutoff(cutoffOf(nk))) loadAll({ confirmed: true });                      // 저장된 범위를 넘으면 추가분만 불러오기
      return;
    }
    if (t.dataset.input === 'auto') { state.settings.auto = !!t.checked; store.save(); }
    if (t.dataset.input === 'thumbs') { state.settings.thumbs = !!t.checked; store.save(); renderNow(); }
  });
  // 숫자 설정(환율, 관세 한도, 보호 기간 경고)은 입력하는 도중에는 반영하지 않고, 입력을 마쳤을 때(Enter/포커스 이동)만 범위를 확인해 저장한다.
  // 글자마다 저장하면 중간 값(1, 14, 140…)으로 경고가 계산돼 알림이 쏟아진다.
  root.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset && t.dataset.input;
    if (k !== 'fx' && k !== 'customs' && k !== 'protectDays') return;
    const raw = String(t.value).trim(), v = parseFloat(raw);
    const reject = (msg) => { t.blur(); state.progress = msg; renderNow(); };
    if (k === 'fx') {
      if (raw === '') state.settings.usdRate = null;
      else if (!(v >= 300 && v <= 5000)) return reject('환율은 300~5000 사이로 입력하세요');
      else state.settings.usdRate = v;
    } else if (k === 'customs') {
      if (!(v >= 1 && v <= 10000)) return reject('관세 한도는 1~10000 사이로 입력하세요');
      state.settings.customsLimit = v;
    } else {
      const d = parseInt(raw, 10);
      if (!(d >= 1 && d <= 60)) return reject('보호 기간 경고는 1~60일 사이로 입력하세요');
      state.settings.protectDays = d;
    }
    store.save(); renderNow();
  });
}

/** 요약 상단 경고: 구매자 보호 기간 임박, 관세 면세 한도 */
function alertsView(s) {
  let h = '';
  if (s.protectSoon.length) {
    h += `<div class="alert red"><div class="h"><span>구매자 보호 기간 임박</span><span>${s.protectSoon.length}건</span></div>` +
      s.protectSoon.slice(0, 4).map((p) => `<a href="${esc(orderUrl(p.orderId))}" target="_blank" rel="noopener"><span>${esc(p.title)}</span><b>${p.daysLeft <= 0 ? '오늘 종료' : 'D-' + p.daysLeft}</b></a>`).join('') + '</div>';
  }
  const c = s.customs;
  if (c && c.count) {
    h += `<div class="alert amber"><div class="h"><span>관세 면세 한도 $${c.limit} 주의</span><span>${c.count}건</span></div>` +
      c.single.slice(0, 3).map((x) => `<a href="${esc(orderUrl(x.orderId))}" target="_blank" rel="noopener"><span>${esc(x.title)}</span><b>$${x.usd.toFixed(0)}</b></a>`).join('') +
      c.groups.slice(0, 3).map((g) => `<a href="${esc(orderUrl(g.orderIds[0]))}" target="_blank" rel="noopener"><span>${esc(g.store)} · ${fmtShort(g.date)} 주문 ${g.orderIds.length}건 합계</span><b>$${g.usd.toFixed(0)}</b></a>`).join('') + '</div>';
  }
  return h + healthBanner();
}

/** 실제 배송 소요일 (배송 완료 시점이 기록된 주문이 있을 때만) */
function deliveryView(s) {
  const d = s.delivery;
  if (!d || !d.count) return '';
  const diff = d.etaCount ? (d.etaDiffAvg < -0.5 ? `${Math.abs(d.etaDiffAvg).toFixed(1)}일 빠름` : d.etaDiffAvg > 0.5 ? `${d.etaDiffAvg.toFixed(1)}일 늦음` : '예상대로') : '-';
  return `<h2>실제 배송 소요일 (${d.count}건)</h2><div class="mini">
    <div class="kpi"><div class="l">평균</div><div class="v">${d.avgDays.toFixed(1)}일</div></div>
    <div class="kpi"><div class="l">중앙값</div><div class="v">${d.medianDays}일</div></div>
    <div class="kpi"><div class="l">예상일 대비</div><div class="v">${diff}</div></div></div>` +
    (d.byStore.length ? barList(d.byStore, (x) => x.name, (x) => x.avgDays, (x) => x.avgDays.toFixed(1) + '일') : '');
}

const CAT_NAMES = () => AES.CATEGORIES.map((c) => c[0]).concat('기타');
function catOptions(current, edited) {
  return `<option value="">${edited ? '자동 분류' : esc(current)}</option>` + CAT_NAMES().map((n) => `<option value="${esc(n)}" ${edited && n === current ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

function protectTag(r) {
  if (r.protectDaysLeft == null) return '';
  const soon = r.protectDaysLeft <= (state.settings.protectDays != null ? state.settings.protectDays : 7);
  return `<span class="tag ${soon ? 'red' : ''}" title="구매자 보호 기간 종료 ${esc(fmtShort(r.protectEnd))}">보호 ${r.protectDaysLeft <= 0 ? '종료' : 'D-' + r.protectDaysLeft}</span>`;
}

function trackLine(t) {
  if (!t) return '';
  const head = [t.carrier, t.no].filter(Boolean).join(' ');
  const last = t.last ? `${t.last.text} (${fmtShort(t.last.time)})` : '';
  return `<div class="trk">${esc([head, last].filter(Boolean).join(' · '))}</div>`;
}

/** 구조 변경 감지 배너 (빠른 모드/상세 조회가 반복해서 실패할 때) */
function healthBanner() {
  const h = state.settings.health;
  if (!h || !h.flag) return '';
  return `<div class="alert amber"><div class="h"><span>알리 페이지 구조가 바뀐 것 같습니다</span></div><div class="ln"><span>${esc(h.flag)}</span></div><button class="b" data-act="debug">디버그 파일 내보내기</button></div>`;
}
