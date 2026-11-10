// 타오바오 주문 통계 - 어느 사이트에서 도는지 구분 (알리익스프레스 / 타오바오)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). base.js 보다 먼저 로드된다.
'use strict';
const IS_TB = /(^|\.)taobao\.com$/i.test(location.hostname);
/** 사이트별 저장 키 접두사: 알리는 예전 그대로(orders/settings/counts), 타오바오는 tb_ 로 분리해 서로 섞이지 않는다 */
const SITE = IS_TB ? { id: 'taobao', prefix: 'tb_', name: '타오바오' } : { id: 'ali', prefix: '', name: '알리' };
const isListPage = () => (IS_TB ? /\/trade\/itemlist\//i.test(location.pathname) : /\/p\/order\/index/i.test(location.pathname));
const orderPageUrl = (id) => (IS_TB
  ? `https://trade.taobao.com/trade/detail/trade_order_detail.htm?biz_order_id=${encodeURIComponent(id)}`
  : `${location.origin}/p/order/detail.html?orderId=${encodeURIComponent(id)}`);
