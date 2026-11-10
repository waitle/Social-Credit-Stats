'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { AES } = require('./helpers.cjs');
require(path.join(__dirname, '..', '..', 'aliexpress-stats', 'lib', 'taobao.js'));
const fx = require('../fixtures/taobao-synthetic.json');
const T = AES.taobao;

const listMap = () => { const m = {}; for (const o of T.parseList(fx.list).orders) m[o.id] = o; return m; };

test('금액 문자열: 위안/원/달러', () => {
  assert.deepStrictEqual(T.money('￥1,200.50'), { amount: 1200.5, currency: 'CNY' });
  assert.deepStrictEqual(T.money('KRW 43146'), { amount: 43146, currency: 'KRW' });
  assert.deepStrictEqual(T.money('USD 12.30'), { amount: 12.3, currency: 'USD' });
  assert.strictEqual(T.money(''), null);
});

test('상태 문구 매핑', () => {
  assert.strictEqual(T.statusOf('交易成功'), 'delivered');
  assert.strictEqual(T.statusOf('交易关闭'), 'cancelled');
  assert.strictEqual(T.statusOf('等待买家付款'), 'unpaid');
  assert.strictEqual(T.statusOf('买家已付款'), 'pending_ship');
  assert.strictEqual(T.statusOf('卖家已发货'), 'shipping');
  assert.strictEqual(T.statusOf('退款中'), 'refund');
  assert.strictEqual(T.statusOf('???'), 'unknown');
});

test('목록 파싱: 주문·상품·금액·환불·다음 페이지', () => {
  const r = T.parseList(fx.list);
  assert.ok(r.ok);
  assert.strictEqual(r.orders.length, 4);
  assert.strictEqual(r.hasMore, true);
  assert.strictEqual(r.nextPage, 2);
  const by = Object.fromEntries(r.orders.map((o) => [o.id, o]));
  const a = by['1000000000000000001'];
  assert.strictEqual(a.status, 'delivered');
  assert.strictEqual(a.date, '2026-10-20 09:15');
  assert.deepStrictEqual(a.total, { amount: 268, currency: 'CNY' });
  assert.strictEqual(a.store, 'Test Shop A');
  assert.strictEqual(a.items[0].qty, 2);
  assert.strictEqual(a.items[0].price.amount, 134);                 // 합계 268 / 수량 2
  assert.strictEqual(a.items[0].url, 'https://item.taobao.com/item.htm?id=700000000001');
  assert.strictEqual(a.items[0].image, 'https://img.alicdn.com/imgextra/a.jpg');
  assert.ok(a.overseasDirect && a.canViewLogistics);
  const b = by['1000000000000000002'];
  assert.strictEqual(b.status, 'cancelled');
  assert.strictEqual(b.refund.state, 'done');
  assert.strictEqual(by['1000000000000000003'].status, 'shipping');
  assert.strictEqual(by['1000000000000000003'].total.amount, 1200);
  assert.strictEqual(by['1000000000000000004'].status, 'pending_ship');
  assert.strictEqual(by['1000000000000000004'].date, '2026-11-05');
});

test('목록 파싱: 구조가 다르면 ok=false (조용히 0건이 아니라 실패로 알림)', () => {
  assert.strictEqual(T.parseList({ data: { foo: 1 } }).ok, false);
  assert.strictEqual(T.parseList(null).ok, false);
});

test('상세 파싱: 배대지는 원화 실결제액 + 관세 경고 끔', () => {
  const d = T.parseDetail(fx.detailForwarder, '1000000000000000001');
  assert.deepStrictEqual(d.paid, { amount: 50000, currency: 'KRW' });
  assert.strictEqual(d.shipMode, 'forwarder');
  assert.strictEqual(d.payAt, '2026-10-20 09:16');
  assert.strictEqual(d.shipAt, '2026-10-22 11:00');
  assert.ok(!/7761/.test(JSON.stringify(T.detailPatch(d))), '전화번호·주소는 저장하지 않는다');
  const p = T.detailPatch(d);
  assert.strictEqual(p.total.currency, 'KRW');
  assert.strictEqual(p.noCustoms, true);
});

test('상세 파싱: 한국 직배송은 관세 경고 유지', () => {
  const p = T.detailPatch(T.parseDetail(fx.detailDirect, '1000000000000000003'));
  assert.strictEqual(p.shipMode, 'direct');
  assert.strictEqual(p.noCustoms, false);
  assert.strictEqual(p.paidActual.amount, 231000);
});

test('통계: 원화 결제액이 있는 주문은 그대로, 위안만 있는 주문은 추정 환율로 환산', () => {
  const map = listMap();
  map['1000000000000000001'] = AES.mergeOrder(map['1000000000000000001'], T.detailPatch(T.parseDetail(fx.detailForwarder, '1000000000000000001')));
  const rate = T.estimateCnyKrw(map);
  assert.ok(Math.abs(rate - 50000 / 268) < 0.01);
  const opts = T.statsOptionsFor({}, map, { now: new Date(2026, 10, 10) });
  assert.strictEqual(opts.currency, 'KRW');
  const s = AES.computeStats(map, opts);
  assert.strictEqual(s.primary, 'KRW');
  assert.ok(s.spent.KRW > 50000);
  assert.strictEqual(s.spent.CNY, undefined, '환율을 알면 위안이 남지 않는다');
  assert.strictEqual(s.refundCount.done, 1);
  assert.strictEqual(T.estimatedCount(map), 3);                     // 2번(환불 금액)·3번·4번은 위안 환산(추정)
  assert.strictEqual(s.refunds[0].estimated, true);
  assert.strictEqual(s.refunds[0].amountSrc, 'paid');
  assert.strictEqual(s.inProgress.length, 2);
});

test('설정에 환율을 넣으면 추정보다 우선', () => {
  const opts = T.statsOptionsFor({ cnyRate: 190 }, listMap());
  assert.strictEqual(opts.rates.CNY, 190);
  assert.strictEqual(opts.cnyRateAuto, false);
});

test('분류: 중국어 상품명도 기타로 빠지지 않는다', () => {
  const c = (t) => AES.categorize(t);
  assert.strictEqual(c('金钱豹R91侧吹3647长方形4U服务器5热管CPU散热器工控机滚珠风扇'), '컴퓨터·IT·전자부품');
  assert.strictEqual(c('P104-100 8G显卡【无输出接口 配合核显使用】'), '컴퓨터·IT·전자부품');
  assert.strictEqual(c('SpaceX猛禽三代发动机模型摆件3D打印制作'), '완구·취미');
  assert.strictEqual(c('男士纯棉T恤夏季'), '패션의류');
  assert.strictEqual(c('iPhone15 手机壳 包邮'), '휴대폰·충전·오디오');   // "包邮"(무료배송) 때문에 가방으로 가지 않는다
  assert.strictEqual(c('完全无关的东西'), '기타');
});

test('수량: 차액·운임 보충 링크(补差价 등)는 1600개여도 1건으로 센다', () => {
  assert.strictEqual(AES.qtyOf({ title: '补差价专用', qty: 1600 }), 1);
  assert.strictEqual(AES.qtyOf({ title: '补运费通用链接', qty: 200 }), 1);
  assert.strictEqual(AES.qtyOf({ title: 'USB 케이블', qty: 3 }), 3);
  const o = { id: '1', date: '2026-10-01', status: 'delivered', total: { amount: 16, currency: 'CNY' }, items: [{ title: '补差价专用', qty: 1600, price: { amount: 0.01, currency: 'CNY' } }] };
  const st = AES.computeStats({ 1: o }, { currency: 'KRW' });
  assert.strictEqual(st.itemCount, 1);
  assert.strictEqual(st.categories.reduce((a, c) => a + c.count, 0), 1);
});

/* ---- 환불은 상품 단위: 부분 환불·환불 요청 종료·售后中·部分发货 ---- */
let seq = 2000000000000000000n;
function order(title, items, fee) {
  const id = String(seq++), d = {};
  d['shopInfo_' + id] = { fields: { tradeTitle: title, createTime: '2026-11-01 10:00:00', shopName: 'S' } };
  d['orderPayment_' + id] = { fields: { actualFee: '￥' + (fee || items.reduce((a, x) => a + x.p, 0)) } };
  items.forEach((x, i) => { d[`orderItemInfo_${id}_${i}`] = { fields: { item: { itemId: String(800 + i), title: 'item' + i, quantity: '1', priceInfo: { actualTotalFee: '￥' + x.p }, refundStatus: x.r } } }; });
  return { id, d };
}
function parseOne(title, items, fee) {
  const { id, d } = order(title, items, fee);
  return T.parseList({ data: { data: d } }).orders.find((o) => o.id === id);
}

test('환불 문구 분류: 완료 / 요청 종료 / 진행 중', () => {
  assert.strictEqual(T.refundOf('退款成功'), 'done');
  assert.strictEqual(T.refundOf('退款关闭'), 'closed');
  assert.strictEqual(T.refundOf('卖家拒绝退款'), 'closed');
  assert.strictEqual(T.refundOf('退款中'), 'processing');
  assert.strictEqual(T.refundOf('售后中'), 'processing');
  assert.strictEqual(T.refundOf(''), null);
});

test('부분 환불 완료: 주문 상태는 그대로, 환불 탭에는 그 상품 금액만, 결제액에서는 빠짐', () => {
  const o = parseOne('交易成功', [{ p: 100, r: '退款成功' }, { p: 200 }]);
  assert.strictEqual(o.status, 'delivered');
  assert.strictEqual(o.refund.state, 'done');
  assert.strictEqual(o.refund.partial, true);
  assert.deepStrictEqual(o.refund.amount, { amount: 100, currency: 'CNY' });
  const s = AES.computeStats({ [o.id]: o }, T.statsOptionsFor({ cnyRate: 200 }, { [o.id]: o }));
  assert.strictEqual(s.spent.KRW, 200 * 200);                     // 300위안 - 환불 100위안
  assert.strictEqual(s.itemCount, 1);
  assert.strictEqual(s.refundCount.done, 1);
  assert.strictEqual(s.refunds[0].amount.amount, 100 * 200);
  assert.strictEqual(s.refunds[0].title, 'item0');
  assert.strictEqual(s.refunds[0].amountSrc, 'item');
  assert.strictEqual(s.refunds[0].estimated, true);
});

test('부분 환불 진행 중: 주문 전체를 환불로 보지 않는다', () => {
  const o = parseOne('卖家已发货', [{ p: 100, r: '退款中' }, { p: 200 }]);
  assert.strictEqual(o.status, 'shipping');
  assert.strictEqual(o.refund.state, 'processing');
  const s = AES.computeStats({ [o.id]: o }, T.statsOptionsFor({ cnyRate: 200 }, { [o.id]: o }));
  assert.strictEqual(s.refundSum.processing.KRW, 100 * 200);
  assert.strictEqual(s.inProgress.length, 1);                      // 남은 상품은 배송 현황에 그대로
});

test('모든 상품 환불 중이면 주문 전체 환불, 금액은 실제 결제액', () => {
  const o = parseOne('交易成功', [{ p: 100, r: '售后中' }], 90);
  assert.strictEqual(o.status, 'refund');
  assert.strictEqual(o.refund.amount, null);
  const s = AES.computeStats({ [o.id]: o }, T.statsOptionsFor({ cnyRate: 200 }, { [o.id]: o }));
  assert.strictEqual(s.refunds[0].amount.amount, 90 * 200);
  assert.strictEqual(s.refunds[0].amountSrc, 'paid');
});

test('환불 요청 종료(退款关闭)는 환불 진행 중이 아니다', () => {
  const c = parseOne('交易关闭', [{ p: 300, r: '退款关闭' }]);
  assert.strictEqual(c.status, 'cancelled');
  assert.strictEqual(c.refund, null);
  const d = parseOne('交易成功', [{ p: 300, r: '退款关闭' }]);
  assert.strictEqual(d.status, 'delivered');
  assert.strictEqual(d.refund, null);
});

test('목록을 다시 받으면 사라진 환불 정보도 반영된다 (진행 중 → 요청 종료)', () => {
  const { id, d } = order('交易成功', [{ p: 100, r: '退款中' }, { p: 200 }]);
  const first = T.parseList({ data: { data: d } }).orders[0];
  assert.strictEqual(first.refund.state, 'processing');
  d[`orderItemInfo_${id}_0`].fields.item.refundStatus = '退款关闭';
  const merged = AES.mergeOrder(first, T.parseList({ data: { data: d } }).orders[0]);
  assert.strictEqual(merged.refund, null);
  assert.strictEqual(merged.items[0].refundState, 'closed');
  // 상세 보강(원화 결제액)은 환불 정보를 지우지 않는다
  const again = AES.mergeOrder(first, { id, source: 'detail', detailAt: 1, paidActual: { amount: 60000, currency: 'KRW' } });
  assert.strictEqual(again.refund.state, 'processing');
});

test('일부 발송(部分发货)은 배송 중', () => {
  assert.strictEqual(T.statusOf('卖家部分发货'), 'shipping');
});

test('같은 상품의 다른 옵션(SKU): 한 옵션만 환불돼도 다른 옵션은 그대로', () => {
  const { id, d } = order('交易成功', [{ p: 100, r: '退款成功' }, { p: 50 }]);
  d[`orderItemInfo_${id}_1`].fields.item.itemId = '800';               // 두 줄 모두 같은 상품번호
  d[`orderItemInfo_${id}_0`].fields.item.skuText = '红色';
  d[`orderItemInfo_${id}_1`].fields.item.skuText = '蓝色';
  const o = T.parseList({ data: { data: d } }).orders[0];
  assert.notStrictEqual(o.items[0].lineId, o.items[1].lineId);
  const s = AES.computeStats({ [o.id]: o }, T.statsOptionsFor({ cnyRate: 100 }, { [o.id]: o }));
  assert.strictEqual(s.purchases.length, 1);
  assert.strictEqual(s.purchases[0].price.amount, 50);
  assert.strictEqual(s.refunds[0].title, 'item0');
  // 목록을 다시 받아 병합해도 줄별 금액·환불 상태가 섞이지 않는다
  const m = AES.mergeOrder(o, T.parseList({ data: { data: d } }).orders[0]);
  assert.deepStrictEqual(m.items.map((x) => [x.price.amount, x.refundState]), [[100, 'done'], [50, null]]);
});

test('기간 밖의 배송 완료 주문에 부분 환불이 진행 중이면 환불 목록에만 나온다', () => {
  const o = parseOne('交易成功', [{ p: 100, r: '退款中' }, { p: 200 }]);
  o.date = '2025-01-01 10:00';
  const s = AES.computeStats({ [o.id]: o }, T.statsOptionsFor({ cnyRate: 100 }, { [o.id]: o }, { since: '2026-11-01' }));
  assert.deepStrictEqual(s.spent, {});
  assert.strictEqual(s.monthly.length, 0);
  assert.strictEqual(s.refundCount.processing, 1);
});

test('원화 결제액은 있는데 환율을 모르면 위안 결제액에서 환불분을 빼고 환산', () => {
  const o = parseOne('交易成功', [{ p: 100, r: '退款成功' }, { p: 200 }]);
  o.paidActual = o.total = { amount: 60000, currency: 'KRW' };
  const s = AES.computeStats({ [o.id]: o }, { currency: 'KRW', rates: {} });
  assert.strictEqual(s.spent.KRW, undefined);                     // 환율이 없으니 원화로 섞지 않고
  assert.strictEqual(s.spent.CNY, 200);                           // 위안 기준 순결제액
});
