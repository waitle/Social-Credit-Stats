// 고급 설정: 알림, 백그라운드 갱신, 업데이트, 중앙 서버, 암호화 백업
'use strict';
const $ = (id) => document.getElementById(id);
const NOTIFY_DEFAULT = { delivered: true, eta: true, refund: true, protect: true, customs: true };

async function getSettings() { return (await chrome.storage.local.get('settings')).settings || {}; }
async function patchSettings(fn) { const s = await getSettings(); fn(s); await chrome.storage.local.set({ settings: s }); return s; }
const serverUrl = (s) => ((s.server && s.server.url) || AES.DEFAULT_SERVER).replace(/\/+$/, '');

async function init() {
  const s = await getSettings();
  const { updateInfo = null } = await chrome.storage.local.get('updateInfo');
  $('ver').textContent = `버전 ${chrome.runtime.getManifest().version}`;
  const nf = Object.assign({}, NOTIFY_DEFAULT, s.notify || {});
  document.querySelectorAll('[data-notify]').forEach((el) => { el.checked = !!nf[el.dataset.notify]; });
  $('bg').value = String(s.bgRefreshHours || 0);
  $('bgLast').textContent = s.lastBgRefresh ? `마지막 갱신 ${new Date(s.lastBgRefresh.at).toLocaleString('ko-KR')} (${s.lastBgRefresh.result})` : '';
  $('updSrc').value = s.updateSource || '';
  $('updInfo').textContent = updateInfo ? `최신 ${updateInfo.latest} · ${updateInfo.available ? '업데이트 있음' : '최신 버전 사용 중'}` : '';
  $('srv').value = serverUrl(s);
  $('srv').placeholder = AES.DEFAULT_SERVER;
  $('tel').checked = !!(s.server && s.server.telemetry);
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.notify) await patchSettings((s) => { s.notify = Object.assign({}, NOTIFY_DEFAULT, s.notify || {}, { [t.dataset.notify]: t.checked }); });
  else if (t.id === 'bg') { await patchSettings((s) => { s.bgRefreshHours = Number(t.value) || 0; }); chrome.runtime.sendMessage({ type: 'rescheduleAlarms' }); }
  else if (t.id === 'updSrc') await patchSettings((s) => { s.updateSource = t.value.trim() || undefined; });
  else if (t.id === 'srv') await patchSettings((s) => { const v = t.value.trim(); s.server = Object.assign({}, s.server, { url: v && v !== AES.DEFAULT_SERVER ? v : undefined }); });
  else if (t.id === 'tel') await patchSettings((s) => { s.server = Object.assign({}, s.server, { telemetry: t.checked }); });
});

$('bgNow').onclick = async () => {
  $('bgStatus').textContent = '갱신 중…';
  const r = await chrome.runtime.sendMessage({ type: 'refreshNow' });
  $('bgStatus').textContent = r && r.result === 'done' ? '갱신 완료' : `갱신하지 못했습니다 (${r && r.result})`;
  init();
};

$('updNow').onclick = async () => {
  $('updStatus').textContent = '확인 중…';
  const r = await chrome.runtime.sendMessage({ type: 'checkUpdate' });
  $('updStatus').textContent = describeUpdate(r);
  init();
};

/** 업데이트 확인 결과를 사용자가 다음에 할 일로 풀어서 보여준다 */
function describeUpdate(r) {
  const i = r && r.info, self = r && r.self;
  if (!i) return '새 버전을 확인하지 못했습니다 (GitHub에 연결할 수 없음)';
  if (!i.available) return `최신 버전입니다 (${i.latest})`;
  if (self && self.reload) return `새 버전 ${i.latest} 파일이 이 폴더에 이미 있어 곧 다시 로드합니다`;
  if (self && self.unpacked === false) return `새 버전 ${i.latest}이 있습니다. 스토어로 설치한 확장은 크롬이 곧 자동으로 업데이트합니다`;
  const disk = self && self.disk ? self.disk : '?';
  return `새 버전 ${i.latest}이 있지만 이 확장이 로드된 폴더의 파일은 아직 ${disk} 입니다 → 업데이터가 이 폴더를 바꾸지 못했습니다. ① 업데이터를 직접 실행하고 ② 크롬에 로드한 폴더가 설치 폴더(Windows: %LOCALAPPDATA%\\AliOrderStats\\extension)인지 확인하세요. 설치 폴더가 아닌 곳(저장소 폴더 등)을 로드했다면 그 폴더는 자동으로 바뀌지 않습니다`;
}

$('srvTest').onclick = async () => {
  const s = await getSettings(); const base = serverUrl(s);
  if (!base) { $('srvStatus').textContent = '서버 주소를 입력하세요'; return; }
  try {
    const t0 = performance.now();
    const r = await fetch(base + '/healthz', { cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    if (!r.ok) throw new Error(r.status);
    const c = await chrome.runtime.sendMessage({ type: 'fetchServerConfig' });
    $('srvStatus').textContent = `연결됨 (${ms}ms)${c && c.ok ? ' · 원격 설정 수신' : ''}`;
  } catch (err) { $('srvStatus').textContent = `연결 실패 (${err.message})`; }
};

async function keysFromInput() {
  const pass = $('pass').value;
  return AES.deriveBackupKeys(pass);
}

$('bkUp').onclick = async () => {
  const s = await getSettings(); const base = serverUrl(s);
  if (!base) { $('bkStatus').textContent = '먼저 중앙 서버 주소를 입력하세요'; return; }
  try {
    $('bkStatus').textContent = '암호화하는 중…';
    const keys = await keysFromInput();
    const { orders = {}, settings = {}, counts = null } = await chrome.storage.local.get(['orders', 'settings', 'counts']);
    const n = await AES.uploadBackup(base, keys, { format: 'aliexpress-stats-backup', v: 1, at: new Date().toISOString(), orders, settings, counts });
    $('bkStatus').textContent = `백업 완료 · 주문 ${Object.keys(orders).length}건, 암호문 ${(n / 1024).toFixed(1)}KB`;
  } catch (err) { $('bkStatus').textContent = err.message; }
};

$('bkDown').onclick = async () => {
  const s = await getSettings(); const base = serverUrl(s);
  if (!base) { $('bkStatus').textContent = '먼저 중앙 서버 주소를 입력하세요'; return; }
  try {
    $('bkStatus').textContent = '받는 중…';
    const keys = await keysFromInput();
    const data = await AES.downloadBackup(base, keys);
    const cur = await chrome.storage.local.get(['orders', 'settings', 'counts']);
    const orders = cur.orders || {};
    let n = 0;
    for (const o of Object.values(data.orders || {})) {
      if (!o || !o.id) continue;
      orders[o.id] = orders[o.id] ? AES.mergeOrder(o, orders[o.id]) : o;
      n++;
    }
    const settings = Object.assign({}, data.settings || {}, cur.settings || {});   // 이 브라우저의 설정을 우선
    await chrome.storage.local.set({ orders, settings, counts: cur.counts || data.counts || null });
    $('bkStatus').textContent = `복원 완료 · 주문 ${n}건 병합`;
  } catch (err) { $('bkStatus').textContent = err.message; }
};

init();
