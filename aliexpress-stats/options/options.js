// 고급 설정: 알림, 백그라운드 갱신, 업데이트, 중앙 서버, 암호화 백업
'use strict';
const $ = (id) => document.getElementById(id);
const NOTIFY_DEFAULT = { delivered: true, eta: true, refund: true, protect: true, customs: true };

async function getSettings() { return (await chrome.storage.local.get('settings')).settings || {}; }
async function patchSettings(fn) { const s = await getSettings(); fn(s); await chrome.storage.local.set({ settings: s }); return s; }
const serverUrl = (s) => ((s.server && s.server.url) || '').replace(/\/+$/, '');

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
  $('tel').checked = !!(s.server && s.server.telemetry);
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.notify) await patchSettings((s) => { s.notify = Object.assign({}, NOTIFY_DEFAULT, s.notify || {}, { [t.dataset.notify]: t.checked }); });
  else if (t.id === 'bg') { await patchSettings((s) => { s.bgRefreshHours = Number(t.value) || 0; }); chrome.runtime.sendMessage({ type: 'rescheduleAlarms' }); }
  else if (t.id === 'updSrc') await patchSettings((s) => { s.updateSource = t.value.trim() || undefined; });
  else if (t.id === 'srv') await patchSettings((s) => { s.server = Object.assign({}, s.server, { url: t.value.trim() }); });
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
  const i = r && r.info;
  $('updStatus').textContent = i ? (i.available ? `새 버전 ${i.latest}이 있습니다` : `최신 버전입니다 (${i.latest})`) : '확인하지 못했습니다';
  init();
};

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
