// 서비스 워커 공용 도구
'use strict';

const getStore = (keys) => chrome.storage.local.get(keys);
const setStore = (obj) => chrome.storage.local.set(obj);

/** 저장된 주문/설정으로 통계 계산 (패널과 같은 기준) */
/** 사이트별 저장 키: 알리는 예전 그대로, 타오바오는 tb_ 접두사 */
const siteKeys = (site) => (site === 'taobao' ? { orders: 'tb_orders', settings: 'tb_settings', counts: 'tb_counts', notify: 'tb_notifyState' } : { orders: 'orders', settings: 'settings', counts: 'counts', notify: 'notifyState' });
const TB_LIST_URL = 'https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm';

async function loadStats(site) {
  const k = siteKeys(site);
  const r = await getStore([k.orders, k.settings, k.counts]);
  const orders = r[k.orders] || {}, settings = r[k.settings] || {}, counts = r[k.counts] || null;
  const opts = site === 'taobao' ? AES.taobao.statsOptionsFor(settings, orders) : AES.statsOptions(settings);
  return { orders, settings, counts, stats: AES.computeStats(orders, opts) };
}

function originOf(settings) {
  return (settings && settings.lastOrigin) || 'https://www.aliexpress.com';
}

function orderDetailUrl(settings, id, site) {
  if (site === 'taobao') return `https://trade.taobao.com/trade/detail/trade_order_detail.htm?biz_order_id=${encodeURIComponent(id)}`;
  return `${originOf(settings)}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
}

/** 버전 비교: a > b 이면 양수 */
function cmpVersion(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

const fmtMD = (iso) => { const d = AES.fromISO(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : '-'; };
