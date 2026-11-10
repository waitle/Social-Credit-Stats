// 상품명 번역 (크롬 내장 Translator API, 기기 안에서 실행 — 상품명이 외부로 나가지 않는다)
// 설정: chrome.storage.local.trSettings = { enabled, mode: 'replace' | 'replace' }  (설정 페이지에서 조작)
// 캐시: chrome.storage.local.trCache = { 원문: 번역 }  (알리/타오바오 공용, 최대 TR_MAX 건)
// 모델 내려받기는 사용자 클릭이 필요해서 설정 페이지에서 한다. 여기서는 이미 받은 모델('available')만 쓴다.
'use strict';
const TR_MAX = 4000;
const TR_TARGET = 'ko';
const TR = { cfg: { enabled: false, mode: 'replace' }, cache: {}, status: 'off', busy: false, tried: new Set(), dirty: 0 };

/** 원문 언어를 간단히 추정: 한글이 있으면 번역하지 않는다 / 한자는 중국어 / 라틴 문자는 영어 */
function trLang(text) {
  const s = String(text || '');
  if (!s.trim() || /[가-힣]/.test(s)) return null;
  if (/[㐀-鿿]/.test(s)) return 'zh';
  if (/[A-Za-z]{3}/.test(s)) return 'en';
  return null;
}

async function trAvailability(src) {
  try {
    if (!globalThis.Translator || !globalThis.Translator.availability) return 'unsupported';
    return await globalThis.Translator.availability({ sourceLanguage: src, targetLanguage: TR_TARGET });
  } catch (_) { return 'unsupported'; }
}

const trTranslators = {};
async function trGet(src) {
  if (trTranslators[src]) return trTranslators[src];
  if ((await trAvailability(src)) !== 'available') return null;       // 'downloadable' 은 사용자 클릭이 필요 → 설정 페이지
  try { trTranslators[src] = await globalThis.Translator.create({ sourceLanguage: src, targetLanguage: TR_TARGET }); } catch (_) { return null; }
  return trTranslators[src];
}

async function trInit() {
  try {
    const r = await chrome.storage.local.get(['trSettings', 'trCache']);
    TR.cfg = Object.assign({ enabled: false, mode: 'replace' }, r.trSettings || {});
    TR.cache = r.trCache || {};
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      let any = false;
      if (ch.trSettings) { TR.cfg = Object.assign({ enabled: false, mode: 'replace' }, ch.trSettings.newValue || {}); TR.tried.clear(); any = true; }
      if (ch.trCache && !TR.busy) { TR.cache = ch.trCache.newValue || {}; if (!ch.trCache.newValue) TR.tried.clear(); any = true; }
      if (any) { scheduleRender(); trKick(); }
    });
  } catch (_) {}
  trKick();
}

/** 화면에 쓸 상품명 HTML (번역이 없으면 원문만) */
function tiDiv(title) {
  const tr = TR.cfg.enabled ? TR.cache[title] : null;
  if (!tr || tr === title) return `<div class="ti">${esc(title)}</div>`;
  if (TR.cfg.mode === 'replace') return `<div class="ti" title="${esc(title)}">${esc(tr)}</div>`;
  return `<div class="ti">${esc(title)}</div><div class="trn">${esc(tr)}</div>`;
}

/** 번역이 켜졌는데 모델이 없을 때 패널에 보여 줄 안내 */
function trNote() {
  if (!TR.cfg.enabled) return '';
  if (TR.status === 'unsupported') return '<div class="note">상품명 번역: 이 크롬에서는 내장 번역을 쓸 수 없습니다 (크롬 138 이상 필요)</div>';
  if (TR.status === 'need-model') return '<div class="note">상품명 번역: 번역 모델이 없습니다. 확장 설정 페이지의 "번역" 항목에서 모델을 준비해 주세요</div>';
  return '';
}

function trTitles() {
  const out = new Set();
  for (const o of Object.values(state.orders || {})) for (const it of o.items || []) if (it && it.title) out.add(it.title);
  return [...out];
}

function trSave() {
  const keys = Object.keys(TR.cache);
  if (keys.length > TR_MAX) for (const k of keys.slice(0, keys.length - TR_MAX)) delete TR.cache[k];
  try { chrome.storage.local.set({ trCache: TR.cache }); } catch (_) {}
}

/** 아직 번역하지 않은 상품명을 하나씩 번역해 캐시에 넣는다 (여러 번 불려도 한 번에 하나만 돈다) */
async function trKick() {
  if (!TR.cfg.enabled) { TR.status = 'off'; return; }
  if (TR.busy) return;
  TR.busy = true;
  try {
    const todo = trTitles().filter((t) => !(t in TR.cache) && !TR.tried.has(t) && trLang(t));
    if (!todo.length) { if (TR.status === 'off') TR.status = 'ok'; return; }
    let done = 0;
    for (const t of todo) {
      if (!TR.cfg.enabled) break;
      const src = trLang(t);
      const tr = await trGet(src);
      if (!tr) { const av = await trAvailability(src); TR.status = av === 'unsupported' || av === 'unavailable' ? 'unsupported' : 'need-model'; scheduleRender(); return; }
      TR.status = 'ok';
      TR.tried.add(t);
      try { const r = await tr.translate(t); if (r) TR.cache[t] = String(r); } catch (_) {}
      if (++done % 8 === 0) { trSave(); scheduleRender(); }
    }
    if (done) { trSave(); scheduleRender(); }
  } finally { TR.busy = false; }
}
