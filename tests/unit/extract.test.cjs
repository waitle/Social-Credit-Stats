'use strict';
// 실제 알리 응답 구조(정제본)로 파서 회귀 테스트. 알리가 구조를 바꾸면 여기서 먼저 깨진다.
const test = require('node:test');
const assert = require('node:assert');
const { AES, loadFixture } = require('./helpers.cjs');

const ref = new Date(2026, 9, 20);
const countBy = (arr, f) => arr.reduce((m, x) => { m[f(x)] = (m[f(x)] || 0) + 1; return m; }, {});

test('목록 1페이지: 주문 수, 상태, 상점명, 페이지 정보', () => {
  const map = loadFixture('list-page1', ref);
  const os = Object.values(map);
  assert.strictEqual(os.length, 10);
  assert.deepStrictEqual(countBy(os, (o) => o.status), { cancelled: 4, shipping: 4, event: 1, pending_ship: 1 });
  assert.strictEqual(os.filter((o) => o.store).length, 9);                 // 이벤트 응모 주문만 상점 없음
  assert.ok(os.every((o) => /^\d{4}-\d{2}-\d{2}/.test(o.date)));
  const fx = require('../fixtures/list-page1.json');
  assert.deepStrictEqual(AES.findListMeta(AES.parseResponseText(fx.captures[0].text)), { hasMore: true, pageIndex: 1, pageSize: 10, moreText: '주문 더 보기' });
});

test('옵션(SKU)만 다른 두 줄은 별도 상품으로', () => {
  const os = Object.values(loadFixture('list-page1', ref));
  const multi = os.filter((o) => o.items.length > 1);
  assert.strictEqual(multi.length, 1);
  assert.strictEqual(multi[0].items.length, 2);
  assert.notStrictEqual(multi[0].items[0].lineId, multi[0].items[1].lineId);
});

test('취소 주문: 환불 진행 중(안내 문구) 판별, 쿠폰 보상 문구는 할인이 아님', () => {
  const os = Object.values(loadFixture('list-page1', ref));
  const cancelled = os.filter((o) => o.status === 'cancelled');
  assert.ok(cancelled.every((o) => o.refund && o.refund.state === 'processing'));
  assert.ok(os.every((o) => !o.discount), '"배송 지연 보상 쿠폰"이 할인으로 잡히면 안 됨');
});

test('이후 페이지: 배송 완료/환불 완료와 환불 금액', () => {
  const map = loadFixture('list-later-pages', ref);
  const os = Object.values(map);
  assert.strictEqual(os.length, 29);
  assert.deepStrictEqual(countBy(os, (o) => o.status), { shipping: 12, cancelled: 1, event: 2, pending_ship: 2, delivered: 12 });
  const done = os.find((o) => o.refund && o.refund.state === 'done');
  assert.ok(done);
  assert.deepStrictEqual(done.refund.amount, { amount: 31.74, currency: 'USD' });
});

test('병합 규칙: 상세 응답이 목록의 주문일/상태를 덮어쓰지 않는다', () => {
  const list = { id: '1', source: 'api', status: 'shipping', date: '2026-11-01', items: [{ id: 'a', title: 'x', qty: 1 }] };
  const detailLike = { id: '1', source: 'dom', status: 'delivered', date: '2025-11-30' };
  const m = AES.mergeOrder(list, detailLike);
  assert.strictEqual(m.date, '2026-11-01');
  assert.strictEqual(m.status, 'shipping');
});

test('상세 응답: 예상 배송일, 운송장/마지막 이벤트, 보호 기간', () => {
  const det = { data: { orderId: '1123000000000001', logistics: { trackingNumber: 'LP00123456789012', logisticsCompany: 'Cainiao',
    events: [{ time: Date.UTC(2026, 10, 1), desc: '출고 완료' }, { time: Date.UTC(2026, 10, 2), desc: '통관 진행 중' }] },
  protection: '구매자 보호 기간 확인 12월 1일', deliveryText: '예상 배송일: 11월 10일 - 11월 16일' } };
  const r = AES.extractDetail('1123000000000001', [], [{ url: 'x', text: JSON.stringify(det) }], { ref: new Date(2026, 10, 3) });
  assert.strictEqual(r.eta.end, '2026-11-16');
  assert.strictEqual(r.tracking.no, 'LP00123456789012');
  assert.strictEqual(r.tracking.last.text, '통관 진행 중');
  assert.strictEqual(r.protectEnd, '2026-12-01');
});

test('배송 완료 시점: 상태 변화 관측 / 추적 이벤트 우선', () => {
  let o = AES.mergeOrder(null, { id: '1', status: 'shipping', source: 'api' });
  o = AES.mergeOrder(o, { id: '1', status: 'delivered', source: 'api' });
  assert.strictEqual(o.deliveredSrc, 'observed');
  const t = AES.mergeOrder({ id: '2', status: 'shipping', source: 'api' }, { id: '2', source: 'detail', track: { no: 'X', last: { text: '배달 완료', time: '2026-11-01T10:00' } } });
  assert.strictEqual(t.deliveredAt, '2026-11-01T10:00');
});

test('결제수단: 상세 API 키 / 화면 문구에서 읽는다', () => {
  assert.strictEqual(AES.pickPayment([{ data: { payInfo: { paymentMethodName: 'Visa ****1234' } } }], []), 'Visa ****1234');
  assert.strictEqual(AES.pickPayment([], ['주문 정보', '결제 수단: 카카오페이', '합계 ₩1,000']), '카카오페이');
  assert.strictEqual(AES.pickPayment([], ['Payment method', 'PayPal', 'Total']), 'PayPal');          // 라벨만 있는 줄 → 다음 줄
  assert.strictEqual(AES.pickPayment([{ payChannel: 'ONLINE_PAY_01', paymentType: '123' }], []), null);   // 코드값은 쓰지 않음
  assert.strictEqual(AES.pickPayment([], ['결제 수단', '결제 방법']), null);
  const d = AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify({ data: { orderId: '1', paymentMethod: 'MasterCard ****9999' } }) }], { ref: new Date(2026, 10, 3) });
  assert.strictEqual(d.payment, 'MasterCard ****9999');
  const m = AES.mergeOrder({ id: '1', status: 'shipping', items: [] }, { id: '1', source: 'detail', payment: 'PayPal' });
  assert.strictEqual(m.payment, 'PayPal');
});
