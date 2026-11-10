// 가짜 타오바오 (HTTPS): 구매 목록 페이지 + mtop API (실제 응답에서 확인한 필드 구조를 따른 합성 데이터)
// - lib.mtop.request 는 실제처럼 콜백 방식이고, 반환하는 Promise 는 undefined 로 끝난다.
// - lib 는 페이지가 뜬 뒤 늦게 정의된다.
'use strict';
const https = require('https');

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (daysAgo, hh = 10) => { const t = new Date(Date.now() - daysAgo * DAY); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(hh)}:00:00`; };

// n, 며칠 전, 거래 상태, 위안 금액, 배송 방식, 환불
const SPEC = [
  [1, 2, '交易成功', 268, 'forwarder'],
  [2, 3, '卖家已发货', 1200, 'direct'],
  [3, 5, '买家已付款', 30, 'forwarder'],
  [4, 9, '交易关闭', 50.5, 'forwarder', '退款成功'],
  [5, 40, '交易成功', 100, 'forwarder'],
  [6, 45, '交易成功', 80, 'forwarder']
];
const idOf = (n) => '20000000000000000' + String(n).padStart(2, '0');
const ORDERS = SPEC.map(([n, ago, title, cny, ship, refund]) => ({ n, id: idOf(n), ago, title, cny, ship, refund, krw: Math.round(cny * 190) }));

function listPayload(page) {
  const slice = page === 1 ? ORDERS.slice(0, 4) : ORDERS.slice(4);
  const data = {};
  for (const o of slice) {
    data['shopInfo_' + o.id] = { tag: 'shopInfo', fields: { orderId: o.id, createTime: stamp(o.ago), shopName: 'Shop ' + (o.n % 2 ? 'A' : 'B'), sellerName: 's' + o.n, tradeTitle: o.title } };
    data['orderPayment_' + o.id] = { tag: 'orderPayment', fields: { totalFee: '￥' + o.cny.toFixed(2), actualFee: '￥' + o.cny.toFixed(2), pcPostFee: '￥0.00' } };
    data['orderItemInfo_' + o.id + '_1'] = { tag: 'orderItemInfo', fields: { orderId: o.id, item: {
      itemId: '7000000000' + String(o.n).padStart(2, '0'), title: `테스트 상품 ${o.n} ${o.n % 2 ? 'USB 케이블' : 'LED 조명'}`, quantity: '1', pic: '//img.alicdn.com/x.jpg',
      priceInfo: { actualTotalFee: '￥' + o.cny.toFixed(2) }, ...(o.refund ? { refundStatus: o.refund } : {}) } } };
  }
  return { api: 'mtop.taobao.order.queryboughtlistV2', v: '1.0', ret: ['SUCCESS::调用成功'], data: { data, global: { pageControl: { hasMore: page === 1 ? 'true' : 'false', nextPageIndex: String(page + 1) } } } };
}

function detailPayload(id) {
  const o = ORDERS.find((x) => x.id === id);
  if (!o) return { api: 'mtop.taobao.order.query.detailV2', ret: ['FAIL_BIZ::no such order'], data: {} };
  const recv = o.ship === 'direct' ? '홍길동, 010-****-1234, 서울특별시 강남구 테스트로 1' : '中韩E递（不同订单分开发货），086-132****7761，山东省 威海市 环翠区 测试路1号';
  return { api: 'mtop.taobao.order.query.detailV2', ret: ['SUCCESS::调用成功'], data: {
    detailInfo: { labels: [{ tag: 'RECEIVE_INFO', name: '收货信息:', value: recv }, { tag: 'PAY', name: '付款时间:', value: stamp(o.ago, 11) }] },
    settlementInfo: { orderPriceDetails: [{ name: '商品总价', value: '￥' + o.cny.toFixed(2) }], payDetails: [{ name: '实付款', value: 'KRW ' + o.krw }] }
  } };
}

const INDEX = `<html><head><meta charset="utf-8"><title>已买到的宝贝</title></head><body><h1>已买到的宝贝</h1><div id=x>loading…</div><script>
function call(opts, ok, err){
  var xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://h5api.m.taobao.com/h5/' + opts.api.toLowerCase() + '/1.0/?data=' + encodeURIComponent(JSON.stringify(opts.data)));
  xhr.withCredentials = true;
  xhr.onload = function(){ try { ok(JSON.parse(xhr.responseText)); } catch(e){ err && err({ret:['FAIL::parse']}); } };
  xhr.onerror = function(){ err && err({ret:['FAIL::network']}); };
  xhr.send();
}
// 실제 lib.mtop 처럼 늦게 정의되고, 콜백 방식이며, Promise 는 undefined 로 끝난다
setTimeout(function(){
  window.lib = { mtop: { version: '2.7.3', request: function(opts, ok, err){ call(opts, ok, err); return Promise.resolve(undefined); } } };
  window.lib.mtop.request({ api: 'mtop.taobao.order.queryboughtlistV2', data: { tabCode: 'all', page: 1, OrderType: 'OrderList' } }, function(){ document.getElementById('x').textContent = 'loaded'; }, function(){});
}, 400);
</script></body></html>`;

function startMockTaobao({ key, cert, port }) {
  const stats = { listPosts: 0, detailPosts: 0, pages: {}, indexLoads: 0 };
  const ctl = { listFail: false, detailFail: false };
  const srv = https.createServer({ key, cert }, (req, res) => {
    const u = new URL(req.url, 'https://' + req.headers.host);
    const cors = { 'Access-Control-Allow-Origin': 'https://buyertrade.taobao.com', 'Access-Control-Allow-Credentials': 'true' };
    if (u.hostname.startsWith('h5api')) {
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
      const data = JSON.parse(u.searchParams.get('data') || '{}');
      if (/queryboughtlistv2/.test(u.pathname)) {
        if (ctl.listFail) return send({ ret: ['FAIL_SYS_SESSION_EXPIRED::session expired'], data: {} });
        stats.listPosts++;
        stats.pages[data.page] = (stats.pages[data.page] || 0) + 1;
        return send(listPayload(data.page || 1));
      }
      if (/query\.detailv2/.test(u.pathname)) {
        stats.detailPosts++;
        if (ctl.detailFail) return send({ ret: ['FAIL_BIZ::forbidden'], data: {} });
        return send(detailPayload(data.bizOrderId));
      }
      return send({ ret: ['FAIL::unknown'], data: {} });
    }
    stats.indexLoads++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(INDEX);
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({ srv, stats, ctl })));
}

module.exports = { startMockTaobao, ORDERS };
