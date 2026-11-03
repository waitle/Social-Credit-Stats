// 알리 주문 통계 - 구조 변경 감지 (빠른 모드/상세 조회가 연속으로 실패하면 표시)
// 콘텐츠 스크립트들은 같은 스코프를 공유한다 (manifest 순서대로 로드). 실제 초기화는 main.js 에서만 한다.
'use strict';

/** kind: 'list' (목록 빠른 모드 결과) | 'detail' (상세 조회 결과) */
function noteHealth(kind, info) {
  const h = state.settings.health || (state.settings.health = { fastFails: 0, etaMiss: 0, flag: null });
  if (kind === 'list') {
    const code = String(info.code || '');
    // 버튼이 없거나 이미 다 불러온 경우는 실패가 아님
    if (/^fail/.test(code) && !/^fail:button/.test(code)) { h.fastFails = (h.fastFails || 0) + 1; h.lastList = code.replace(/\d+/g, '#').slice(0, 60); }
    else if (code === 'done') h.fastFails = 0;
  } else if (kind === 'detail') {
    if (info.total >= 3 && info.found === 0) h.etaMiss = (h.etaMiss || 0) + 1;
    else if (info.found > 0) h.etaMiss = 0;
  }
  h.flag = h.fastFails >= 2 ? `목록 빠른 모드 연속 실패 (${h.lastList})` : h.etaMiss >= 2 ? '주문 상세에서 예상 배송일을 찾지 못함' : null;
  store.save();
  // 익명 상태 코드만 background 로 전달 (서버 보고는 사용자가 켠 경우에만)
  try {
    chrome.runtime.sendMessage({ type: 'health', codes: {
      v: chrome.runtime.getManifest().version, kind,
      list: kind === 'list' ? String(info.code || '').replace(/\d+/g, '#').slice(0, 60) : undefined,
      detail: kind === 'detail' ? String(state.fast.detail || '').replace(/\d+/g, '#').slice(0, 60) : undefined,
      etaFound: kind === 'detail' ? info.found : undefined, etaTotal: kind === 'detail' ? info.total : undefined
    } });
  } catch (_) {}
}
