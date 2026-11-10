// 알리 주문 통계 - 진입점
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';
(() => {
  if (window.__aesLoaded) return;
  window.__aesLoaded = true;
  if (DETAIL_AUTO) { runDetailAuto(); return; }   // UI 없이 상세 정보만 보내고 끝

  try { if (sessionStorage.getItem('aes-empty') === '1') { sessionStorage.removeItem('aes-empty'); state.hold = true; } } catch (_) {}   // 초기화 직후: 조회를 시작할 때까지 빈 화면
  initCollect();
  initDetailsMessages();
  if (LIST_AUTO) { runListAuto(); return; }      // 백그라운드 자동 갱신: UI 없이 추가분 + 예상 배송일만 갱신
  initUI();
  const runOnce = (() => { try { const v = sessionStorage.getItem('aes-run-once'); sessionStorage.removeItem('aes-run-once'); return v === '1' || v === 'refresh' ? v : ''; } catch (_) { return ''; } })();   // "불러오기"(1)·"새로고침"(refresh)이 새로 연 페이지
  window.addEventListener('pagehide', () => { if (store._t) store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && store._t) store.flush(); });
  (async () => {
    await store.load();
    applyRemoteConfig();
    trInit();
    if (isListPage()) { if (state.settings.autoOpen !== false) state.open = true; if (state.settings.lastOrigin !== location.origin) { state.settings.lastOrigin = location.origin; store.save(); } }
    render();
    scanDom();
    setTimeout(scanDom, 1500);
    setTimeout(scanDom, 4000);
    // 자동 실행(기본 꺼짐)을 켰거나 "불러오기"로 새로 연 경우: 목록 → 예상 배송일 조회까지 진행
    if (isListPage() && (state.settings.auto === true || runOnce)) {
      const t0 = Date.now();
      while (!state.listAt && Date.now() - t0 < 10000) await sleep(60);    // 첫 페이지 응답 대기
      if (!state.loading) { fetchDetails(runOnce === 'refresh'); loadAll({ auto: true }); }   // 예상 배송일 조회는 목록 로딩과 동시에 진행 (새로고침이면 배송 중 주문 전부 다시 조회)
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
  for (let i = 0; i < 600 && (state.detail || state.detailBusy); i++) await sleep(200);   // 배송 현황 새로고침 완료 대기 (최대 2분)
  await store.flush();
  try { chrome.runtime.sendMessage({ type: 'bgRefreshDone', orders: Object.keys(state.orders).length }); } catch (_) {}
}

/** 중앙 서버에서 받은 원격 설정(라벨 보강, 기능 플래그)을 파서에 적용 */
function applyRemoteConfig() {
  try { chrome.storage.local.get('serverConfig').then((r) => { if (r && r.serverConfig) AES.applyRemoteConfig(r.serverConfig); }); } catch (_) {}
}
