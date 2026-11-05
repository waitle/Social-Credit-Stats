// 주문 상세 페이지를 백그라운드 탭으로 열어 "예상 배송일"을 읽어오는 오케스트레이터 (요청 형식 학습용 / 직접 호출 실패 시 대체)
const waiters = new Map();   // tabId -> resolve
const cancelled = new Set(); // listTabId
const running = new Set();   // listTabId

function fetchOne(origin, windowId, orderId, kind) {
  return new Promise((resolve) => {
    const url = kind === 'track'
      ? `${origin}/p/tracking/index.html?_addShare=no&_login=yes&tradeOrderId=${orderId}&aesAuto=1`     // 주문 목록의 "배송 조회" 버튼이 여는 화면
      : `${origin}/p/order/detail.html?orderId=${orderId}&aesAuto=1`;
    chrome.tabs.create({ url, active: false, windowId }, (tab) => {
      if (chrome.runtime.lastError || !tab) { resolve({ orderId, error: String(chrome.runtime.lastError && chrome.runtime.lastError.message) }); return; }
      let done = false;
      const finish = (msg) => {
        if (done) return; done = true;
        clearTimeout(timer); waiters.delete(tab.id);
        chrome.tabs.remove(tab.id, () => void chrome.runtime.lastError);
        resolve({ ...msg, orderId });
      };
      const timer = setTimeout(() => finish({ timeout: true }), 40000);
      waiters.set(tab.id, finish);
    });
  });
}

async function runDetails(listTabId, windowId, origin, orderIds, kind) {
  if (running.has(listTabId)) return;
  running.add(listTabId); cancelled.delete(listTabId);
  const queue = orderIds.slice();
  const total = queue.length;
  let done = 0;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError), 20000);
  const send = (m) => chrome.tabs.sendMessage(listTabId, m, () => void chrome.runtime.lastError);
  const worker = async () => {
    while (queue.length && !cancelled.has(listTabId)) {
      const id = queue.shift();
      const res = await fetchOne(origin, windowId, id, kind);
      done++;
      send({ ...res, type: 'detail', kind: kind || 'detail' });
      send({ type: 'detailProgress', done, total });
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); }
  finally {
    clearInterval(keepAlive); running.delete(listTabId);
    send({ type: 'detailDone', done, total, cancelled: cancelled.has(listTabId) });
    cancelled.delete(listTabId);
  }
}

/** 탭에서 온 결과를 기다리는 쪽에 전달 */
function resolveTabWaiter(tabId, msg) { const w = waiters.get(tabId); if (w) w(msg); }
