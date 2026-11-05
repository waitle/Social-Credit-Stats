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

// 실제 상세 API 응답을 정제한 구조. 값이 detail_<블록>_<번호>.fields 아래 깊은 곳에 있다
const realDetail = (eta, buttons) => ({ data: { data: {
  detail_root_container_1: { fields: { i18nMap: { button_delete_tips: '삭제 후 주문은 분류됩니다.' } } },
  detail_order_status_block_2: { fields: { buttonVOList: buttons, countDownPattern: '{0} 일 남았습니다', gmtTrigger: new Date(2027, 0, 17, 10, 34).getTime(), reminder: '{0} 후에 자동으로 배송 완료 확인 처리됩니다.문제가 있는 경우 주문 후 90 일 이내에 환불/반품을 신청할 수 있습니다.', title: '배송 중' } },
  detail_order_services_3: { fields: { data: [{ title: '구매자 보호' }, { content: '지정된 주문 보호 기간 내 반품 및 환불 가능' }] } },
  detail_product_block_4: { fields: { productVOList: [{ etaAndTrack: { deliveryDateChangeInfo: { changeReason: '판매자 또는 택배사에서 예상 배송 시간을 제공합니다.', title: '배송 예정일' }, ...(eta ? { expectDeliveryDateTitle: eta } : {}), packageInfo: { trackDesc: '배송사 인계 완료' } }, itemTitle: '상품', orderLineId: '1123000000000002', quantity: 1 }] } },
  detail_simple_order_info_component_5: { fields: { orderCreatTime: '2026년 11월 3일', orderShipTime: '2026년 11월 3일', paymentMethod: '네이버페이', paymentMethodTitle: '결제 수단', tradeOrderId: 1123000000000001 } }
} }, ret: ['SUCCESS::调用成功'] });
const confirmBtn = [{ text: '수령 확인', type: 'CONFIRM_GOODS' }];

test('실제 구조의 상세 응답: 깊은 곳의 예상 배송일, 자동 확정 시각, 결제수단을 읽는다', () => {
  const r = AES.extractDetail('1123000000000001', [], [{ url: 'x', text: JSON.stringify(realDetail('예상 배송일: 2026년 11월 24일', confirmBtn)) }], { ref: new Date(2026, 10, 5) });
  assert.strictEqual(r.eta.end, '2026-11-24');
  assert.strictEqual(r.etaSrc, 'api');
  assert.strictEqual(r.payment, '네이버페이');
  assert.strictEqual(r.protectEnd, '2027-01-17T10:34');
  assert.strictEqual(r.detailKnown, true);
});

test('실제 구조의 상세 응답: 값이 없으면 지어내지 않는다', () => {
  const ref = new Date(2026, 10, 5);
  const none = AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify(realDetail(null, confirmBtn)) }], { ref });
  assert.strictEqual(none.eta, null);                            // 주문일·발송일·"90 일 이내" 문구를 배송일로 읽지 않는다
  assert.strictEqual(none.detailKnown, true);
  const noBtn = AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify(realDetail('예상 배송일: 2026년 11월 24일', [])) }], { ref });
  assert.strictEqual(noBtn.protectEnd, null);                    // 수령 확인 버튼이 없는 화면의 카운트다운은 자동 확정 시각이 아니다
  assert.strictEqual(AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify({ data: { foo: 'bar' } }) }], { ref }).detailKnown, false);
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

test('배송 조회 화면: 위치·상태가 따로 있는 이벤트와 현재 상태로 도착 여부를 읽는다', () => {
  const ref = new Date(2026, 10, 5, 18, 0);
  const ev = (loc, st, t) => ({ location: loc, status: st, time: t });
  const page = { data: { trackingNumber: '998006720488', events: [ev('인천', '통관 완료', Date.parse('2026-11-04T10:00:00+09:00')), ev('시흥시 경기', '배송 완료', Date.parse('2026-11-05T17:07:00+09:00'))] } };
  const a = AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify(page) }], { ref, track: true }).tracking;
  assert.strictEqual(a.no, '998006720488');
  assert.match(a.last.text, /시흥시 경기 · 배송 완료/);
  assert.ok(AES.DELIVERED_EVENT.test(a.last.text));
  // 이벤트 목록이 없어도 현재 상태 값이 배송 완료이면 도착으로 본다 (track 화면에서만)
  const b = AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify({ data: { mailNo: 'ABCD1234567', logisticsStatus: 'Delivered' } }) }], { ref, track: true }).tracking;
  assert.strictEqual(b.delivered, true);
  assert.strictEqual(AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify({ data: { mailNo: 'ABCD1234567', logisticsStatus: 'Delivered' } }) }], { ref }).tracking.delivered, undefined);   // 상세 화면에서는 쓰지 않음
  // 아직 배송 중이거나 "배송 완료 확인" 버튼 문구는 도착이 아니다
  const c = AES.extractDetail('1', ['배송 완료 확인', '운송장 번호 LP00112233445'], [{ url: 'x', text: JSON.stringify({ data: { status: 'IN_TRANSIT', statusDesc: '배송 중' } }) }], { ref, track: true }).tracking;
  assert.ok(c && !c.delivered);
  // 화면에 단독으로 "배송 완료"가 있는 경우
  assert.strictEqual(AES.extractDetail('1', ['배송 조회', '배송 완료', 'LP00112233445'], [], { ref, track: true }).tracking.delivered, true);
});

test('상세 화면의 "위치 + 배송 완료." 줄로 도착을 인식하고, 운송장 정보와 합쳐도 유지된다', () => {
  const ref = new Date(2026, 10, 5, 18, 0);
  const lines = ['예상 배송일: 2026년 11월 7일', '시흥시 경기', '배송 완료.', '삼성 S26 울트라 케이스', '배송 완료 확인'];
  const t = AES.extractDetail('1', lines, [], { ref }).tracking;
  assert.strictEqual(t.delivered, true);
  assert.strictEqual(t.last.text, '시흥시 경기 · 배송 완료.');
  assert.ok(AES.DELIVERED_EVENT.test(t.last.text));
  assert.strictEqual(AES.extractDetail('1', ['배송 완료 확인', '배송 중'], [], { ref }).tracking, null);   // 버튼 문구만으로는 도착이 아니다
  // 키 이름이 달라도 위치·상태 칸을 모두 이어 붙인다
  const j = { data: { trackingNumber: '998006720488', list: [{ gmtTime: Date.parse('2026-11-05T17:07:00+09:00'), areaName: '시흥시 경기', standardDesc: '배송 완료.' }] } };
  assert.match(AES.extractDetail('1', [], [{ url: 'x', text: JSON.stringify(j) }], { ref }).tracking.last.text, /배송 완료/);
  // 상세 결과(번호 없음, 도착)와 배송 조회 결과(번호)를 합친다
  const m = AES.mergeOrder({ id: '1', status: 'shipping', track: { no: '998006720488', carrier: null, last: { text: '출발', time: '2026-11-04T10:00' } } }, { id: '1', source: 'detail', track: t });
  assert.strictEqual(m.track.no, '998006720488');
  assert.strictEqual(m.track.delivered, true);
});
