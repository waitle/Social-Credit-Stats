// 가짜 알리익스프레스 (HTTPS): 주문 목록/상세 페이지 + mtop API
// - 페이지는 실제 알리처럼 늦게 정의되는 window.lib.mtop.request(POST, 토큰 쿠키 필요)로 데이터를 요청한다.
// - 목록 2페이지부터는 직전 응답의 linkage 토큰이 있어야 한다 (실제 체인 구조 흉내).
'use strict';
const https = require('https');

const pad = (n) => String(n).padStart(2, '0');
const daysFromNow = (d) => { const t = new Date(); t.setDate(t.getDate() + d); return t; };
const koDate = (t) => `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일`;
const koMD = (t) => `${t.getMonth() + 1}월 ${t.getDate()}일`;

function orderOf(n) {
  const id = '1123' + String(600000000000 + n * 1111).padStart(12, '0');
  const st = ['배송 중', '처리 중', '취소', '배송 중', '완료'][n % 5];
  const ago = n === 1 ? 0 : n * 10;                                       // n=0,1 같은 날 주문
  const store = n <= 1 ? 'Store A' : n % 2 ? 'Store B' : 'Store C';
  let total = '₩' + (3000 + n * 500).toLocaleString('en-US'), price = '₩' + (3500 + n * 500).toLocaleString('en-US');
  if (n === 0) { total = 'US $90.00'; price = 'US $95.00'; }               // 같은 상점·같은 날 합계 $170 → 관세 한도 묶음 경고
  if (n === 1) { total = 'US $80.00'; price = 'US $85.00'; }
  if (n === 3) { total = '₩250,000'; price = '₩260,000'; }                 // 단건 한도 초과
  const refund = st === '취소' ? { itemList: [{ detailList: [n % 2
    ? { title: '환불 처리', content: 'AliExpress 환불 처리 중이며, 1~3일 내에 예상됩니다.' }
    : { title: '환불 완료', content: 'AliExpress 처리가 완료되었습니다.', extendContent: '환불 금액: ' + total }] }] } : undefined;
  const item = '1005' + String(n).padStart(12, '0');
  return { id, n, fields: {
    orderId: id, statusText: st, orderDateText: koDate(daysFromNow(-ago)), orderDateTitle: '주문일자:', storeName: store,
    totalPriceText: total, exposeInfo: refund,
    orderLines: [{ itemId: item, productId: item, orderLineId: id + '1', itemTitle: `테스트 상품 ${n}${n % 2 ? ' 충전 케이블 USB' : ' LED 조명'}`,
      itemPriceText: price, quantity: 1 + (n % 2), itemImgUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/x.jpg', itemDetailUrl: `//www.aliexpress.com/item/${item}.html` }]
  } };
}
const PAGES = [0, 1, 2].map((p) => Array.from({ length: p < 2 ? 10 : 7 }, (_, i) => orderOf(p * 10 + i)));
const ALL = PAGES.flat();

function listPayload(idx) {
  const data = {};
  for (const o of PAGES[idx - 1]) data['pc_om_list_order_' + o.id] = { fields: o.fields };
  data.pc_om_list_body_1 = { fields: { hasMore: idx < 3, hasMoreText: '주문 더 보기', pageIndex: idx, pageSize: 10 } };
  return { api: 'mtop.aliexpress.trade.buyer.order.list', data: { data, linkage: { common: { queryParams: 'QP' + idx + '^^$$AbC+/=', submitParams: 'SP' + idx }, signature: 'SIG' + idx } }, ret: ['SUCCESS::调用成功'] };
}

// 배송 조회 화면 API: 0번과 3번 주문은 같은 운송장(합배송), 3번은 이미 배달 완료 이벤트(수령 확인 전)
function trackingPayload(id) {
  const o = ALL.find((x) => x.id === id) || ALL[0];
  const delivered = o.n === 3;
  return { api: 'mtop.aliexpress.logistics.tracking.detail', data: {
    tradeOrderId: id,
    logistics: { trackingNumber: 'LP' + String(o.n === 3 ? 0 : o.n).padStart(12, '0'), logisticsCompany: 'Cainiao', events: [
      { time: Date.now() - 3 * 86400000, desc: '출고 완료' }, (delivered ? { time: Date.now() - 86400000, location: '시흥시 경기', status: 'Delivered' } : { time: Date.now() - 86400000, desc: '통관 진행 중' })] }
  }, ret: ['SUCCESS::ok'] };
}

function detailPayload(id) {
  const o = ALL.find((x) => x.id === id) || ALL[0];
  const d = 7 + (o.n % 15);
  return {
    api: 'mtop.aliexpress.trade.buyer.order.detail',
    data: {
      orderId: id,
      deliveryText: `예상 배송일: ${koMD(daysFromNow(d))} - ${koMD(daysFromNow(d + 6))}`,
      protection: `구매자 보호 기간 확인 ${koMD(daysFromNow(o.n === 0 ? 3 : 40))}`,
      paymentMethod: o.n % 2 ? 'PayPal' : 'Visa ****1234'
    },
    ret: ['SUCCESS::ok']
  };
}

// 실제 알리의 lib-mtop 흉내: 늦게 정의되고, POST + 토큰 쿠키, Promise 반환
const LIB = `setTimeout(function(){ window.lib = window.lib || {}; window.lib.mtop = { request: function(opts, ok, ng){ return new Promise(function(resolve, reject){
  var data = typeof opts.data==='string' ? opts.data : JSON.stringify(opts.data);
  function attempt(n){ fetch('https://acs.aliexpress.com/h5/'+opts.api+'/1.0/?appKey=12574478&isSec=1&method=POST&api='+opts.api, {method:'POST', credentials:'include', headers:{'content-type':'application/x-www-form-urlencoded'}, body:'data='+encodeURIComponent(data)})
    .then(function(r){return r.json()}).then(function(j){ var r0=(j.ret||[])[0]||''; if(/TOKEN/.test(r0) && n<2) return attempt(n+1); if(/^SUCCESS/.test(r0)){ ok&&ok(j); resolve(j);} else { ng&&ng(j); reject(j);} }); }
  attempt(0); }); } }; }, 150);`;

const INDEX = `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body><h1>주문</h1><div id="list"></div>
<button id="more" style="display:none"><span>주문 더 보기</span></button>
<script>${LIB}
var page=0, lastQP='';
function load(){ page++; var data = page===1 ? {renderType:'init', statusTab:null} : {renderType:'adjust', params: JSON.stringify({pageIndex:page, queryParams:lastQP})};
  lib.mtop.request({api:'mtop.aliexpress.trade.buyer.order.list', v:'1.0', data:data, ecode:1, isSec:1, type:'originaljson'}).then(render); }
function render(j){ var d=j.data; lastQP=d.linkage.common.queryParams; var more=false; for (var k in d.data){ var f=d.data[k].fields; if(k.indexOf('pc_om_list_body')===0) more=f.hasMore; if(k.indexOf('pc_om_list_order_')!==0) continue;
  var L=f.orderLines[0]; var c=document.createElement('div'); c.innerHTML='<div>'+f.statusText+'</div><div>주문번호:: '+f.orderId+'</div><a href="'+L.itemDetailUrl+'">'+L.itemTitle+'</a><div>'+L.itemPriceText+' x'+L.quantity+'</div><div>총 금액:'+f.totalPriceText+'</div>'; document.getElementById('list').appendChild(c); }
  document.getElementById('more').style.display = more ? 'block' : 'none'; }
document.getElementById('more').onclick = load;
setTimeout(function(){ lib.mtop.request({api:'mtop.aliexpress.trade.buyer.order.count', v:'1.0', data:{}}); }, 300);
setTimeout(load, 400);
</script></body></html>`;

function detailPage(id) {
  return `<html><body><h1>주문 상세</h1><div>주문번호:: ${id}</div><div id=x>loading…</div><script>${LIB}
setTimeout(function(){ lib.mtop.request({api:'mtop.aliexpress.trade.buyer.order.detail', v:'1.0', data:{orderId:'${id}', lang:'ko'}, ecode:1, isSec:1})
  .then(function(j){ document.getElementById('x').innerHTML='<div>'+j.data.deliveryText+'</div><div>'+j.data.protection+'</div>'; }); }, 500);</script></body></html>`;
}

function trackingPage(id, opaque) {
  // opaque: 요청 데이터에 주문번호가 그대로 들어 있지 않은 경우 (직접 호출 형식을 배울 수 없음 → 탭으로만 읽어야 함)
  const data = opaque ? `{k:btoa('${id}')}` : `{tradeOrderId:'${id}'}`;
  return `<html><body><h1>배송 조회</h1><div id=x>loading…</div><script>${LIB}
setTimeout(function(){ lib.mtop.request({api:'mtop.aliexpress.logistics.tracking.detail', v:'1.0', data:${data}, ecode:1, isSec:1})
  .then(function(j){ document.getElementById('x').innerHTML='<div>운송장 번호 '+j.data.logistics.trackingNumber+'</div>'; }); }, 500);</script></body></html>`;
}

function startMockAli({ key, cert, port }) {
  const stats = { listPosts: 0, detailPosts: 0, detailTabs: 0, trackPosts: 0, trackTabs: 0, indexLoads: 0, pages: {}, captchaHits: 0 };
  // 테스트에서 조절: captchaFailsPage3 > 0 이면 그 횟수만큼, -1 이면 해제할 때까지 3페이지 요청에 보안 인증 오류를 돌려준다. delayMs 는 3페이지 응답 지연.
  const ctl = { captchaFailsPage3: 0, delayMs: 0, trackOpaque: false };
  const srv = https.createServer({ key, cert }, (req, res) => {
    const u = new URL(req.url, 'https://' + req.headers.host);
    const cors = { 'Access-Control-Allow-Origin': 'https://www.aliexpress.com', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (u.hostname.startsWith('acs')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const api = u.searchParams.get('api') || '';
        const send = (obj, extra = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(obj)); };
        if (!/_m_h5_tk=/.test(req.headers.cookie || '')) return send({ api, data: {}, ret: ['FAIL_SYS_TOKEN_EMPTY::token empty'] }, { 'Set-Cookie': '_m_h5_tk=tok_1; Domain=.aliexpress.com; Path=/' });
        if (/order\.count/.test(api)) return send({ api, data: { module: { shipped: '6', processing: '3', unpaid: '0' } }, ret: ['SUCCESS::ok'] });
        const data = JSON.parse(decodeURIComponent((body.match(/data=([^&]*)/) || [])[1] || '{}'));
        if (/order\.list/.test(api)) {
          let idx = 1;
          if (data.renderType === 'adjust') {
            const p = JSON.parse(data.params); idx = p.pageIndex;
            if (p.queryParams !== 'QP' + (idx - 1) + '^^$$AbC+/=') return send({ api, data: {}, ret: ['FAIL_BIZ::bad chain page ' + idx] });
          }
          if (idx === 3 && ctl.captchaFailsPage3 !== 0) {
            if (ctl.captchaFailsPage3 > 0) ctl.captchaFailsPage3--;
            stats.captchaHits++;
            return send({ api, data: { url: 'https://acs.aliexpress.com/punish?x5secdata=x' }, ret: ['FAIL_SYS_USER_VALIDATE::RGV587_ERROR::验证'] });
          }
          stats.listPosts++;
          stats.pages[idx] = (stats.pages[idx] || 0) + 1;
          if (idx === 3 && ctl.delayMs) return setTimeout(() => send(listPayload(idx)), ctl.delayMs);
          return send(listPayload(idx));
        }
        if (/logistics\.tracking/.test(api)) { stats.trackPosts++; return send(trackingPayload(data.tradeOrderId || Buffer.from(data.k || '', 'base64').toString())); }
        if (/order\.detail/.test(api)) { stats.detailPosts++; return send(detailPayload(data.orderId)); }
        return send({ api, data: {}, ret: ['FAIL::unknown'] });
      });
      return;
    }
    if (u.pathname.endsWith('/tracking/index.html')) { stats.trackTabs++; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(trackingPage(u.searchParams.get('tradeOrderId'), ctl.trackOpaque)); }
    if (u.pathname.endsWith('detail.html')) { stats.detailTabs++; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(detailPage(u.searchParams.get('orderId'))); }
    stats.indexLoads++;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(INDEX);
  });
  return new Promise((resolve) => srv.listen(port, () => resolve({ srv, stats, ctl })));
}

module.exports = { startMockAli, ALL };
