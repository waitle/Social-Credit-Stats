// 백그라운드 자동 갱신 (사용자가 켠 경우만): 주문 목록 페이지를 백그라운드 탭으로 열어 추가분 + 예상 배송일을 갱신
// 알리 API 는 로그인된 페이지 안에서만 호출할 수 있어서 서버가 아니라 사용자의 브라우저에서 수행한다.
'use strict';

let refreshing = null;

async function scheduleAlarms() {
  const { settings = {} } = await getStore('settings');
  const h = Number(settings.bgRefreshHours) || 0;
  const cur = await chrome.alarms.get('aes-refresh');
  if (h > 0) { if (!cur || cur.periodInMinutes !== h * 60) chrome.alarms.create('aes-refresh', { periodInMinutes: h * 60, delayInMinutes: 3 }); }
  else if (cur) chrome.alarms.clear('aes-refresh');
  if (!(await chrome.alarms.get('aes-update'))) chrome.alarms.create('aes-update', { periodInMinutes: 30, delayInMinutes: 1 });
  if (!(await chrome.alarms.get('aes-daily'))) chrome.alarms.create('aes-daily', { periodInMinutes: 24 * 60, delayInMinutes: 2 });
}

/** 결과: 'done' | 'busy' | 'no-window' | 'timeout' */
async function runBackgroundRefresh() {
  if (refreshing) return 'busy';
  const { settings = {} } = await getStore('settings');
  let win = null;
  try { win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch (_) {}
  if (!win) return 'no-window';                       // 브라우저 창이 없으면 건너뜀 (다음 주기에 다시)
  refreshing = new Promise((resolve) => {
    chrome.tabs.create({ url: `${originOf(settings)}/p/order/index.html?aesAuto=list`, active: false, windowId: win.id }, (tab) => {
      if (chrome.runtime.lastError || !tab) { resolve('no-tab'); return; }
      const timer = setTimeout(() => finish('timeout'), 180000);
      function finish(r) { clearTimeout(timer); waiters.delete(tab.id); chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError); resolve(r); }
      waiters.set(tab.id, () => finish('done'));
    });
  });
  const r = await refreshing;
  refreshing = null;
  const s = (await getStore('settings')).settings || {};
  s.lastBgRefresh = { at: Date.now(), result: r };
  await setStore({ settings: s });
  return r;
}
