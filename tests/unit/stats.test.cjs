'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { AES, loadFixture } = require('./helpers.cjs');

const now = new Date(2026, 10, 3, 12, 0);
const mk = (id, status, store, date, total, extra = {}) => ({ id, status, source: 'api', store, date, total, items: [{ id: 'i' + id, title: 'USB 케이블 ' + id, qty: 1, price: total }], ...extra });

test('실제 구조: 결제액/할인/환율 추정/환불 진행 합계', () => {
  const s = AES.computeStats(loadFixture('list-page1', new Date(2026, 9, 20)), { now });
  assert.strictEqual(s.primary, 'KRW');
  assert.ok(Math.abs(s.rates.USD - 1407.5) < 1, '같은 상품의 원화/달러 가격으로 환율 추정');
  assert.strictEqual(s.refundCount.processing, 4);
  assert.strictEqual(Math.round(s.refundSum.processing.KRW), 264411);   // 결제 총액 기준 (정가 아님)
  assert.strictEqual(s.orderCount, 5);                                  // 취소 4건·이벤트 1건 제외
});

test('관세 한도: 단건 초과 / 같은 상점·같은 날 합계 초과', () => {
  const map = {
    a: mk('a', 'shipping', 'S1', '2026-10-30', { amount: 250000, currency: 'KRW' }),
    b: mk('b', 'shipping', 'S2', '2026-10-31', { amount: 120, currency: 'USD' }),
    c: mk('c', 'pending_ship', 'S2', '2026-10-31', { amount: 60, currency: 'USD' }),
    d: mk('d', 'delivered', 'S2', '2026-10-31', { amount: 500, currency: 'USD' })           // 도착한 주문은 제외
  };
  const s = AES.computeStats(map, { now, rates: { USD: 1400 } });
  assert.deepStrictEqual(s.customs.single.map((x) => x.orderId), ['a']);
  assert.deepStrictEqual(s.customs.groups.map((g) => [g.store, g.orderIds.sort().join('+'), g.usd]), [['S2', 'b+c', 180]]);
  const s2 = AES.computeStats(map, { now, rates: { USD: 1400 }, customsLimit: 200 });
  assert.strictEqual(s2.customs.count, 0);
});

test('구매자 보호 기간 임박: 설정 일수 이하만', () => {
  const map = { a: mk('a', 'shipping', 'S', '2026-10-01', null, { protectEnd: '2026-11-06' }), b: mk('b', 'shipping', 'S', '2026-10-01', null, { protectEnd: '2026-12-20' }) };
  assert.deepStrictEqual(AES.computeStats(map, { now }).protectSoon.map((x) => [x.orderId, x.daysLeft]), [['a', 3]]);
  assert.strictEqual(AES.computeStats(map, { now, protectDays: 60 }).protectSoon.length, 2);
});

test('실제 배송 소요일과 예상일 대비', () => {
  const map = {
    e: mk('e', 'delivered', 'S', '2026-10-01', null, { deliveredAt: '2026-10-15T09:00', eta: { start: '2026-10-12', end: '2026-10-18' } }),
    f: mk('f', 'delivered', 'S', '2026-10-05', null, { deliveredAt: '2026-10-25T09:00', eta: { start: '2026-10-20', end: '2026-10-22' } })
  };
  const d = AES.computeStats(map, { now }).delivery;
  assert.deepStrictEqual([d.count, d.avgDays, d.etaDiffAvg], [2, 17, 0]);
  assert.deepStrictEqual(d.byStore, [{ name: 'S', n: 2, avgDays: 17 }]);
});

test('조회 기간 필터: 기간 밖이어도 배송 중·환불 진행 중은 포함', () => {
  const map = {
    old: mk('old', 'delivered', 'S', '2026-01-01', { amount: 1000, currency: 'KRW' }),
    oldShip: mk('oldShip', 'shipping', 'S', '2026-01-01', { amount: 1000, currency: 'KRW' }),
    oldRefund: mk('oldRefund', 'cancelled', 'S', '2026-01-01', { amount: 1000, currency: 'KRW' }, { refund: { state: 'processing' } }),
    recent: mk('recent', 'delivered', 'S', '2026-11-01', { amount: 1000, currency: 'KRW' })
  };
  const s = AES.computeStats(map, { now, since: '2026-10-27' });
  assert.strictEqual(s.totalOrders, 3);
  assert.strictEqual(s.refundCount.processing, 1);
});

test('분류 직접 수정이 통계에 반영', () => {
  const map = { a: mk('a', 'delivered', 'S', '2026-11-01', { amount: 1000, currency: 'KRW' }) };
  const s = AES.computeStats(map, AES.statsOptions({ catOverrides: { ia: '반려동물' } }, { now }));
  assert.deepStrictEqual(s.categories.map((c) => c.name), ['반려동물']);
  assert.strictEqual(s.purchases[0].catEdited, true);
});

test('티켓류는 배송 현황(진행 중/완료)에서 제외하되 구매 통계에는 남는다', () => {
  const it = (id, title) => ({ id, title, qty: 1 });
  const map = {
    a: { id: 'a', status: 'shipping', date: '2026-10-30', total: { amount: 300000, currency: 'KRW' }, items: [it('a1', '인천-도쿄 왕복 항공권 e-ticket')] },
    b: { id: 'b', status: 'delivered', date: '2026-10-20', total: { amount: 50000, currency: 'KRW' }, items: [it('b1', '놀이공원 입장권 2매')] },
    c: { id: 'c', status: 'shipping', date: '2026-10-30', total: { amount: 9000, currency: 'KRW' }, items: [it('c1', 'USB 케이블'), it('c2', 'Flight ticket booking service')] },
    d: { id: 'd', status: 'shipping', date: '2026-10-30', total: { amount: 5000, currency: 'KRW' }, items: [it('d1', '티켓 홀더 여권 케이스')] }
  };
  const s = AES.computeStats(map, { now });
  assert.deepStrictEqual(s.inProgress.map((r) => r.title).sort(), ['USB 케이블', '티켓 홀더 여권 케이스']);   // 액세서리는 제외하지 않음
  assert.strictEqual(s.delivered.length, 0);
  assert.strictEqual(s.inProgressItems, 2);
  assert.strictEqual(s.orderCount, 4);                                                                    // 지출 통계에는 포함
  assert.ok(AES.isTicket('Airline boarding pass') && AES.isTicket('항공권 예약') && !AES.isTicket('USB 케이블'));
});

test('합배송: 같은 운송장 번호의 서로 다른 주문을 묶는다', () => {
  const it = (id, title) => ({ id, title, qty: 1 });
  const tr = (no) => ({ no, carrier: 'Cainiao', last: null });
  const map = {
    a: { id: 'a', status: 'shipping', date: '2026-10-30', total: { amount: 5000, currency: 'KRW' }, track: tr('LP00112233445'), payment: 'PayPal', items: [it('a1', '케이블 A')] },
    b: { id: 'b', status: 'shipping', date: '2026-10-31', total: { amount: 6000, currency: 'KRW' }, track: tr('lp00112233445'), items: [it('b1', '케이블 B'), it('b2', '케이스 B')] },
    c: { id: 'c', status: 'shipping', date: '2026-10-20', total: { amount: 7000, currency: 'KRW' }, track: { no: 'LP00112233445', carrier: 'Cainiao', last: { text: 'Delivered', time: '2026-11-01T10:00' } }, items: [it('c1', '이전 주문')] },   // 도착(수령 확인 전)도 같은 묶음
    d: { id: 'd', status: 'shipping', date: '2026-10-31', total: { amount: 8000, currency: 'KRW' }, track: tr('LP99999999999'), items: [it('d1', '단독')] },
    e: { id: 'e', status: 'shipping', date: '2026-10-31', total: { amount: 9000, currency: 'KRW' }, items: [it('e1', '운송장 없음')] }
  };
  const s = AES.computeStats(map, { now });
  assert.strictEqual(s.shipGroups.length, 1);
  assert.deepStrictEqual(s.shipGroups[0].orderIds.sort(), ['a', 'b', 'c']);
  assert.strictEqual(s.shipGroups[0].members.length, 4);                                  // 상품 4개
  const sizes = Object.fromEntries([...s.inProgress, ...s.delivered].map((r) => [r.title, r.groupSize]));
  assert.deepStrictEqual([sizes['케이블 A'], sizes['케이블 B'], sizes['이전 주문'], sizes['단독'], sizes['운송장 없음']], [3, 3, 3, 0, 0]);
  assert.strictEqual(s.inProgress.find((r) => r.title === '케이블 A').payment, 'PayPal');
  // 한 주문 안의 여러 상품이 같은 운송장인 것은 합배송이 아니다
  const one = { x: { id: 'x', status: 'shipping', date: '2026-10-31', track: tr('LP55555555555'), items: [it('x1', 'a'), it('x2', 'b')] } };
  assert.strictEqual(AES.computeStats(one, { now }).shipGroups.length, 0);
});

test('배송 완료 기준: 주문 상태 "완료"는 배송 현황에서 제외, 배송 중이면서 조회상 도착한 것만 배송 완료', () => {
  const it = (id, title) => ({ id, title, qty: 1 });
  const ev = (text) => ({ no: 'LP12345678901', carrier: 'Cainiao', last: { text, time: '2026-11-01T10:00' } });
  const map = {
    a: { id: 'a', status: 'delivered', date: '2026-10-20', total: { amount: 1000, currency: 'KRW' }, track: ev('Delivered'), items: [it('a1', '내가 수령 확인한 상품')] },
    b: { id: 'b', status: 'shipping', date: '2026-10-25', total: { amount: 2000, currency: 'KRW' }, track: ev('배송 완료'), items: [it('b1', '도착했지만 확인 전')] },
    c: { id: 'c', status: 'shipping', date: '2026-10-25', total: { amount: 3000, currency: 'KRW' }, track: ev('통관 진행 중'), items: [it('c1', '배송 중')] },
    d: { id: 'd', status: 'shipping', date: '2026-10-25', total: { amount: 4000, currency: 'KRW' }, track: ev('Assigned to courier'), items: [it('d1', '기사 배정')] },
    e: { id: 'e', status: 'shipping', date: '2026-10-25', total: { amount: 5000, currency: 'KRW' }, items: [it('e1', '조회 정보 없음')] }
  };
  const s = AES.computeStats(map, { now });
  assert.deepStrictEqual(s.delivered.map((r) => r.title), ['도착했지만 확인 전']);
  assert.strictEqual(s.delivered[0].awaitingConfirm, true);
  assert.deepStrictEqual(s.inProgress.map((r) => r.title).sort(), ['기사 배정', '배송 중', '조회 정보 없음']);
  assert.strictEqual(s.orderCount, 5);                                                       // 구매 내역·지출에는 모두 포함
  assert.strictEqual(s.deliveredItems, 1);
});
