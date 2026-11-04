// 알리 주문 통계 - 서비스 워커 진입점
'use strict';
importScripts('../lib/core.js', '../lib/extract.js', '../lib/stats.js',
  'util.js', 'detail-tabs.js', 'badge.js', 'notify.js', 'refresh.js', 'update.js', 'server.js');

const onDataChanged = debounceSw(async () => { await refreshBadge(); await checkNotifications(); }, 2000);
function debounceSw(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.orders || changes.counts || changes.updateInfo) onDataChanged();
  if (changes.settings) { scheduleAlarms(); onDataChanged(); }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'aes-refresh') runBackgroundRefresh();
  else if (a.name === 'aes-update') checkSelfReload();
  else if (a.name === 'aes-daily') { await fetchServerConfig(); await checkRemoteVersion(); await flushHealth(); refreshBadge(); }
});

chrome.runtime.onInstalled.addListener(async () => { await scheduleAlarms(); refreshBadge(); checkNotifications(); checkRemoteVersion(); fetchServerConfig(); });
chrome.runtime.onStartup.addListener(async () => { await scheduleAlarms(); if (!(await checkSelfReload()).reload) refreshBadge(); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'fetchDetails': {
      if (!sender.tab) return;
      let origin = 'https://www.aliexpress.com';
      try { origin = new URL(sender.tab.url).origin; } catch (_) {}
      runDetails(sender.tab.id, sender.tab.windowId, origin, msg.orderIds || []);
      sendResponse({ ok: true });
      return;
    }
    case 'cancelDetails': if (sender.tab) cancelled.add(sender.tab.id); sendResponse({ ok: true }); return;
    case 'detailResult':
    case 'bgRefreshDone': if (sender.tab) resolveTabWaiter(sender.tab.id, msg); return;
    case 'health': queueHealth(msg.codes); return;
    case 'openOptions': chrome.runtime.openOptionsPage(); return;
    // 팝업/설정 페이지 요청 (비동기 응답)
    case 'refreshNow': runBackgroundRefresh().then((r) => sendResponse({ result: r })); return true;
    case 'checkUpdate': (async () => {
      const self = await checkSelfReload(true);                 // 판단만 (응답을 먼저 보낸 뒤 다시 로드)
      const info = await checkRemoteVersion();
      sendResponse({ info, self });
      if (self.reload) setTimeout(() => chrome.runtime.reload(), 800);
    })(); return true;
    case 'fetchServerConfig': fetchServerConfig().then((c) => sendResponse({ ok: !!c, config: c })); return true;
    case 'flushHealth': flushHealth().then((n) => sendResponse({ sent: n })); return true;
    case 'rescheduleAlarms': scheduleAlarms().then(() => sendResponse({ ok: true })); return true;
  }
});
