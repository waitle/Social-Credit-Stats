// 알리 주문 통계 - 진입점
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
(() => {
  if (window.__aesLoaded) return;
  window.__aesLoaded = true;
  if (DETAIL_AUTO) { runDetailAuto(); return; }   // UI 없이 상세 정보만 보내고 끝

  initCollect();
  initDetailsMessages();
  if (LIST_AUTO) { runListAuto(); return; }      // 백그라운드 자동 갱신: UI 없이 추가분 + 예상 배송일만 갱신
  initUI();
  window.addEventListener('pagehide', () => { if (store._t) store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && store._t) store.flush(); });
  (async () => {
    await store.load();
    applyRemoteConfig();
    if (/\/p\/order\/index/i.test(location.pathname)) { state.open = true; if (state.settings.lastOrigin !== location.origin) { state.settings.lastOrigin = location.origin; store.save(); } }
    render();
    scanDom();
    setTimeout(scanDom, 1500);
    setTimeout(scanDom, 4000);
    // 주문 목록 페이지를 열면 전체 목록 → 예상 배송일 조회까지 자동 진행
    if (/\/p\/order\/index/i.test(location.pathname) && state.settings.auto !== false) {
      const t0 = Date.now();
      while (!state.listAt && Date.now() - t0 < 10000) await sleep(60);    // 첫 페이지 응답 대기
      if (!state.loading) { fetchDetails(false); loadAll({ auto: true }); }               // 예상 배송일 조회는 목록 로딩과 동시에 진행
    }
  })();
})();

/** background 가 주기적으로 연 탭: 저장된 범위의 추가분과 예상 배송일을 갱신하고 결과를 알린다 */
async function runListAuto() {
  await store.load();
  applyRemoteConfig();
  const t0 = Date.now();
  while (!state.listAt && Date.now() - t0 < 15000) await sleep(100);
  try { await loadAll({ auto: true, background: true }); } catch (_) {}
  await sleep(300);
  for (let i = 0; i < 600 && state.detail; i++) await sleep(200);   // 예상 배송일 조회 완료 대기 (최대 2분)
  await store.flush();
  try { chrome.runtime.sendMessage({ type: 'bgRefreshDone', orders: Object.keys(state.orders).length }); } catch (_) {}
}

/** 중앙 서버에서 받은 원격 설정(라벨 보강, 기능 플래그)을 파서에 적용 */
function applyRemoteConfig() {
  try { chrome.storage.local.get('serverConfig').then((r) => { if (r && r.serverConfig) AES.applyRemoteConfig(r.serverConfig); }); } catch (_) {}
}
