// 알리 주문 통계 - 표시 형식 (금액, 날짜, 배지)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
/* ---------------------------- 포맷 ---------------------------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ko-KR');
function money(amount, cur) {
  if (amount == null || !isFinite(amount)) return '-';
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: cur || 'KRW' }).format(amount); }
  catch (_) { return nf.format(Math.round(amount)) + (cur ? ' ' + cur : ''); }
}
function moneyMap(m, primary) {
  const e = Object.entries(m || {}).filter(([, v]) => v);
  if (!e.length) return '-';
  e.sort((a, b) => (a[0] === primary ? -1 : b[0] === primary ? 1 : b[1] - a[1]));
  return e.map(([c, v]) => money(v, c)).join(' + ');
}
function fmtDate(iso, withYear) {
  const d = AES.fromISO(iso); if (!d) return '-';
  const opt = { month: 'numeric', day: 'numeric', weekday: 'short' };
  if (withYear || d.getFullYear() !== new Date().getFullYear()) opt.year = '2-digit';
  let s = d.toLocaleDateString('ko-KR', opt);
  if (/T\d\d:\d\d/.test(iso)) s += ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  return s;
}
function etaLine(r) {
  if (!r.etaEnd) return `<div class="eta"><span class="muted">${r.detailTried ? '예상 배송일 없음' : '예상 배송일 미조회'}</span></div>`;
  const same = !r.etaStart || r.etaStart === r.etaEnd;
  const txt = same ? fmtDate(r.etaEnd) : `${fmtDate(r.etaStart)} ~ ${fmtDate(r.etaEnd)}`;
  return `<div class="eta"><span class="k">도착 예정</span><span>${esc(txt)}</span><span class="dd">${dday(r)}</span></div>`;
}
const fmtShort = (iso) => { const d = AES.fromISO(iso); if (!d) return '-'; return `${d.getFullYear() !== new Date().getFullYear() ? String(d.getFullYear()).slice(2) + '.' : ''}${d.getMonth() + 1}.${d.getDate()}`; };
function dday(r) {
  if (r.daysLeft == null) return '';
  if (r.daysLeft > 0) return `D-${r.daysLeft}`;
  if (r.daysLeft === 0) return '오늘';
  return `${-r.daysLeft}일 지연`;
}
const STATUS_BADGE = { pending_ship: ['배송 전', 'b-wait'], shipping: ['배송 중', 'b-ship'], delivered: ['배송 완료', 'b-done'], cancelled: ['취소', 'b-cancel'], refund: ['환불', 'b-cancel'], unpaid: ['결제대기', 'b-cancel'], event: ['이벤트', 'b-cancel'], unknown: ['?', 'b-cancel'] };
const badge = (s) => { const [t, c] = STATUS_BADGE[s] || STATUS_BADGE.unknown; return `<span class="badge ${c}">${t}</span>`; };
