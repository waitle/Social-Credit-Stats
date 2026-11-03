// 중앙 서버 연동 (사용자가 서버 주소를 설정한 경우만)
// - 원격 설정: 알리 문구/구조 변경에 대응하는 라벨 보강과 기능 플래그 (주문 데이터 전송 없음)
// - 익명 상태 보고: 사용자가 켠 경우에만, 실패 사유 코드와 확장 버전만 전송
'use strict';

async function serverBase() {
  const { settings = {} } = await getStore('settings');
  const url = (settings.server && settings.server.url) || '';
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, '') : '';
}

async function fetchServerConfig() {
  const base = await serverBase();
  if (!base) return null;
  const { serverConfigEtag = '' } = await getStore('serverConfigEtag');
  try {
    const r = await fetch(base + '/v1/config', { headers: serverConfigEtag ? { 'If-None-Match': serverConfigEtag } : {}, cache: 'no-store' });
    if (r.status === 304) return 'unchanged';
    if (!r.ok) return null;
    const cfg = await r.json();
    await setStore({ serverConfig: cfg, serverConfigEtag: r.headers.get('ETag') || '' });
    return cfg;
  } catch (_) { return null; }
}

async function queueHealth(codes) {
  const { settings = {} } = await getStore('settings');
  if (!(settings.server && settings.server.telemetry)) return;
  const clean = {};
  for (const [k, v] of Object.entries(codes || {})) if (v != null && ['v', 'kind', 'list', 'detail', 'etaFound', 'etaTotal'].includes(k)) clean[k] = typeof v === 'number' ? v : String(v).slice(0, 60);
  const { healthQueue = [] } = await getStore('healthQueue');
  healthQueue.push(clean);
  await setStore({ healthQueue: healthQueue.slice(-50) });
  if (healthQueue.length >= 10) flushHealth();
}

async function flushHealth() {
  const base = await serverBase();
  const { healthQueue = [] } = await getStore('healthQueue');
  if (!base || !healthQueue.length) return 0;
  try {
    const r = await fetch(base + '/v1/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: chrome.runtime.getManifest().version, items: healthQueue }) });
    if (r.ok) { await setStore({ healthQueue: [] }); return healthQueue.length; }
  } catch (_) {}
  return 0;
}
