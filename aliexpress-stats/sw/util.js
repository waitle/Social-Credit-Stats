// 서비스 워커 공용 도구
'use strict';

const getStore = (keys) => chrome.storage.local.get(keys);
const setStore = (obj) => chrome.storage.local.set(obj);

/** 저장된 주문/설정으로 통계 계산 (패널과 같은 기준) */
async function loadStats() {
  const { orders = {}, settings = {}, counts = null } = await getStore(['orders', 'settings', 'counts']);
  return { orders, settings, counts, stats: AES.computeStats(orders, AES.statsOptions(settings)) };
}

function originOf(settings) {
  return (settings && settings.lastOrigin) || 'https://www.aliexpress.com';
}

function orderDetailUrl(settings, id) {
  return `${originOf(settings)}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
}

/** 버전 비교: a > b 이면 양수 */
function cmpVersion(a, b) {
  const x = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0), y = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

const fmtMD = (iso) => { const d = AES.fromISO(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : '-'; };
