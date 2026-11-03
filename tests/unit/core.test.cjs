'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { AES } = require('./helpers.cjs');

const ref = new Date(2026, 10, 3, 12, 0);
const iso = (arr) => arr.map((d) => AES.toISO(d.date, d.hasTime));

test('날짜: 한국어/영어/ISO, 범위, 연도 넘김', () => {
  assert.deepStrictEqual(iso(AES.parseDates('예상 배송: 11월 20일 - 12월 5일', { ref })), ['2026-11-20', '2026-12-05']);
  assert.deepStrictEqual(iso(AES.parseDates('배송: 11월 08일- 14일', { ref })), ['2026-11-08', '2026-11-14']);
  assert.deepStrictEqual(iso(AES.parseDates('12월 20일 ~ 1월 5일', { ref })), ['2026-12-20', '2027-01-05']);
  assert.deepStrictEqual(iso(AES.parseDates('Estimated delivery: Nov 20 - Dec 5', { ref })), ['2026-11-20', '2026-12-05']);
  assert.deepStrictEqual(iso(AES.parseDates('Deliver by 20 Nov 2026 14:30', { ref })), ['2026-11-20T14:30']);
  assert.deepStrictEqual(iso(AES.parseDates('주문일: 10월 28일', { ref, prefer: 'past' })), ['2026-10-28']);
});

test('금액: 통화 기호/표기 차이', () => {
  const m = (s) => AES.parseMoney(s);
  assert.deepStrictEqual(m('₩12,345'), { amount: 12345, currency: 'KRW' });
  assert.deepStrictEqual(m('US $12.34'), { amount: 12.34, currency: 'USD' });
  assert.deepStrictEqual(m('12,345원'), { amount: 12345, currency: 'KRW' });
  assert.deepStrictEqual(m('€5,99'), { amount: 5.99, currency: 'EUR' });
  assert.deepStrictEqual(AES.parseMoney({ formattedPrice: '₩9,900' }), { amount: 9900, currency: 'KRW' });
});

test('상태 분류: 버튼 문구와 상태 문구 구분', () => {
  const c = (t, k) => AES.classifyStatus(t, k);
  assert.strictEqual(c('배송 중'), 'shipping');
  assert.strictEqual(c('처리 중'), 'pending_ship');
  assert.strictEqual(c('참여 완료! '), 'event');
  assert.strictEqual(c('취소'), 'unknown');           // 화면의 "취소" 버튼
  assert.strictEqual(c('취소', true), 'cancelled');    // API statusText 의 "취소"
  assert.strictEqual(c('Awaiting delivery'), 'shipping');
  assert.strictEqual(c('완료'), 'delivered');
});

test('예상 배송일: 보호 기간/확인 기한 문구는 제외', () => {
  assert.deepStrictEqual(AES.pickEta(['예상 배송일: 11월 18일 - 11월 25일'], ref), { start: '2026-11-18', end: '2026-11-25', text: '예상 배송일: 11월 18일 - 11월 25일' });
  assert.strictEqual(AES.pickEta(['구매자 보호 기간 확인 11월 30일'], ref), null);
});

test('구매자 보호 기간: 날짜형, 남은 시간형', () => {
  assert.strictEqual(AES.pickProtection(['구매자 보호 기간 확인 11월 30일'], ref), '2026-11-30');
  assert.strictEqual(AES.pickProtection(['자동 구매 확정까지', '12일 3시간'], ref), '2026-11-15T15:00');
  assert.strictEqual(AES.pickProtection(['Buyer protection ends: Dec 5, 2026'], ref), '2026-12-05');
  assert.strictEqual(AES.pickProtection(['예상 배송일: 11월 18일'], ref), null);
});

test('원격 설정으로 라벨 보강', () => {
  assert.strictEqual(AES.pickEta(['도착 보장 11월 22일'], ref), null);
  AES.applyRemoteConfig({ parser: { etaLabels: ['도착\\s*보장'] }, flags: { disableFastList: true } });
  assert.strictEqual(AES.pickEta(['도착 보장 11월 22일'], ref).end, '2026-11-22');
  assert.strictEqual(AES.EXTRA.flags.disableFastList, true);
  AES.applyRemoteConfig({ parser: { etaLabels: ['(잘못된 정규식'] } });       // 잘못된 패턴은 무시
  assert.strictEqual(AES.EXTRA.eta.length, 0);
});
