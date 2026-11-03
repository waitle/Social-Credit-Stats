// 자동 업데이트
// 1) 설치 프로그램의 업데이터가 디스크의 확장 파일을 새 버전으로 바꾸면 → 여기서 감지해 스스로 다시 로드
// 2) 원격(GitHub 또는 중앙 서버)에 새 버전이 있으면 → 배지 "UP" 과 알림으로 안내
'use strict';

const UPDATE_SOURCE_DEFAULT = 'https://raw.githubusercontent.com/waitle/Social-Credit-Stats/main/aliexpress-stats/manifest.json';

/**
 * 디스크의 manifest 버전이 실행 중인 버전보다 높으면 다시 로드한다.
 * 압축 해제(개발자 모드)로 설치한 경우에만 동작한다 (스토어 설치는 크롬이 직접 업데이트).
 * dryRun 이면 판단 결과만 돌려준다 (테스트용).
 */
async function checkSelfReload(dryRun) {
  const running = chrome.runtime.getManifest().version;
  let disk = null;
  try { disk = (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json()).version; } catch (_) {}
  let unpacked = true;
  try { unpacked = (await chrome.management.getSelf()).installType === 'development'; } catch (_) {}
  const reload = !!(disk && unpacked && cmpVersion(disk, running) > 0);
  if (reload && !dryRun) chrome.runtime.reload();
  return { running, disk, unpacked, reload };
}

async function checkRemoteVersion() {
  const { settings = {}, serverConfig = null, updateInfo: prev = null } = await getStore(['settings', 'serverConfig', 'updateInfo']);
  const running = chrome.runtime.getManifest().version;
  let latest = null, source = null;
  try {
    const m = await (await fetch(settings.updateSource || UPDATE_SOURCE_DEFAULT, { cache: 'no-store' })).json();
    if (m && m.version) { latest = m.version; source = 'github'; }
  } catch (_) {}
  if (serverConfig && serverConfig.latestVersion && cmpVersion(serverConfig.latestVersion, latest) > 0) { latest = serverConfig.latestVersion; source = 'server'; }
  if (!latest) return prev;
  const info = { latest, running, source, available: cmpVersion(latest, running) > 0, checkedAt: Date.now(), notified: prev && prev.latest === latest ? prev.notified : false };
  if (info.available && !info.notified) {
    chrome.notifications.create(`aes|update|${Date.now()}`, {
      type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon128.png'), title: `새 버전 ${latest}`,
      message: '설치 프로그램으로 설치했다면 자동으로 적용됩니다. 직접 설치했다면 업데이트 스크립트를 실행하세요.'
    });
    info.notified = true;
  }
  await setStore({ updateInfo: info });
  return info;
}
