// 알리 주문 통계 - content script (isolated world)
(() => {
  'use strict';
  if (window.__aesLoaded) return;
  window.__aesLoaded = true;
  const AES = window.AES;

  const DETAIL_PATH = /\/p\/order\/detail/i.test(location.pathname);
  const DETAIL_AUTO = DETAIL_PATH && /[?&]aesAuto=1/.test(location.search);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  const NOISE_URL = /recommend|cart\.count|cookie\.render/i;

  /* ================================================================== *
   * 상세 페이지 자동 조회 모드 (background.js 가 백그라운드 탭으로 연 경우)
   * ================================================================== */
  if (DETAIL_AUTO) {
    (async () => {
      const orderId = new URLSearchParams(location.search).get('orderId') || '';
      const caps = [], seen = new Set();
      const reqLog = [], reqSeen = new Set();
      window.addEventListener('message', (e) => {
        if (e.source === window && e.data && e.data.source === 'aes-req') { const k = e.data.api + ':' + e.data.at; if (!reqSeen.has(k)) { reqSeen.add(k); reqLog.push({ api: e.data.api, opts: e.data.opts }); } return; }
        if (e.source !== window || !e.data || e.data.source !== 'aes-hook' || NOISE_URL.test(e.data.url)) return;
        const k = e.data.url + e.data.text.length;
        if (seen.has(k)) return; seen.add(k);
        caps.push({ url: e.data.url, text: e.data.text.slice(0, 400000) });
      });
      window.postMessage({ source: 'aes-replay' }, '*');
      const getLines = () => (document.body ? document.body.innerText || '' : '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
      let res = null, loadedSince = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 22000) {
        await sleep(600);
        res = AES.extractDetail(orderId, getLines(), caps, { ref: new Date() });
        if (res.eta) break;
        if (getLines().some((l) => l.includes(orderId))) {               // 페이지는 떴는데 예상 배송일이 없는 경우
          loadedSince = loadedSince || Date.now();
          if (Date.now() - loadedSince > 7000) break;
        }
      }
      const rel = (res ? res.rawLines.concat(res.apiLines) : []).filter((l) => /\d/.test(l) && /(배송|도착|예상|예정|delivery|deliver|arriv|estimat|ship)/i.test(l)).slice(0, 25);
      const head = res ? res.rawLines.slice(0, 40) : [];
      // 이 페이지가 호출한 mtop 상세 API 요청(데이터에 주문번호 포함)을 알려줘서, 이후 주문은 탭 없이 직접 호출하게 한다
      const byApi = new Map();
      for (const r of reqLog) { try { if (JSON.stringify(r.opts.data || '').includes(orderId)) byApi.set(r.api, { api: r.api, opts: r.opts }); } catch (_) {} }
      const tpls = [...byApi.values()].slice(0, 3);
      chrome.runtime.sendMessage({
        type: 'detailResult', orderId,
        eta: res && res.eta, etaSrc: res && res.etaSrc, items: res ? res.items : [],
        raw: { relevant: rel, head }, tpls
      });
    })();
    return; // UI 없이 종료
  }

  /* ================================================================== *
   * 일반 모드
   * ================================================================== */
  const state = {
    orders: {}, settings: { usdRate: null, thumbs: true, detailTpl: null, auto: true, period: '1w', includeShipping: true, coverage: null, listTpl: null },
    tab: 'summary', shipFilter: 'all', moreOpen: false, open: false, loading: false, cancel: false, progress: '',
    filter: '', captures: [], cards: [], lastUpdate: null, net: [], counts: null,
    meta: null, listAt: 0, detail: null, listResps: [], listSeen: new Set(), reqLog: [], reqSeen: new Set(), sessionIds: new Set(), knownAtStart: new Set(), lastPageOrders: [], cut: { cutoff: null, covered: false }, chain: null, endReason: '', libInfo: null, detailTplCand: null, tabResolve: null, cancelDetail: false,
    fast: { list: '', detail: '' }, progressDetail: '', detailRerun: false
  };

  /* ---------------------------- 조회 기간 / 저장된 범위(coverage) ---------------------------- */
  const PERIODS = [['1w', '최근 1주일', 7], ['2w', '최근 2주일', 14], ['1m', '최근 1달', 30], ['2m', '최근 2달', 60], ['3m', '최근 3달', 90], ['6m', '최근 6개월', 180], ['1y', '최근 1년', 365], ['all', '전체', null]];
  const periodInfo = (k) => PERIODS.find((p) => p[0] === k) || PERIODS[0];
  const isoDaysAgo = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - d); return AES.toISO(t); };
  const addDaysISO = (iso, d) => { const t = AES.fromISO(iso); t.setDate(t.getDate() + d); return AES.toISO(t); };
  const cutoffOf = (k) => { const d = periodInfo(k)[2]; return d == null ? null : isoDaysAgo(d); };
  const isHeavy = (k) => { const d = periodInfo(k)[2]; return d == null || d >= 60; };   // 2달 이상
  /** 저장된 내역이 이 기준일까지 이미 포함하는가 (포함하면 추가분만 불러온다) */
  function coversCutoff(cutoff) {
    const c = state.settings.coverage;
    if (!c || !c.from) return false;
    if (cutoff == null) return c.from === 'all';
    return c.from === 'all' || c.from <= cutoff;
  }
  const needsConfirm = (k) => isHeavy(k) && !coversCutoff(cutoffOf(k));
  function confirmHeavy(label) {
    return confirm(`⚠ ${label} 내역을 불러옵니다.\n\n2달 이상의 내역은 로딩 시간이 길어지고, 알리익스프레스에서 봇 인증(보안 확인) 창이 뜰 수 있습니다.\n인증 창이 뜨면 인증을 완료한 뒤 다시 시도해 주세요.\n\n계속할까요?`);
  }

  /** 지금까지 받은 페이지로 충분한가? 'cutoff'(기간 도달) / 'incremental'(이미 저장된 부분에 도달) / null(계속) */
  function shouldStop(pageOrders) {
    const cut = state.cut;
    if (cut.cutoff == null) return null;                               // 전체: 마지막 페이지까지
    const dates = (pageOrders || []).map((o) => (o.date || '').slice(0, 10)).filter(Boolean).sort();
    const oldest = dates[0] || null;
    const inprog = Object.values(state.orders).filter((o) => o.status === 'shipping' || o.status === 'pending_ship');
    // 배송 중 주문은 기간과 무관하게 포함: 알리가 집계한 건수를 모두 확보하거나 75일 전까지 내려가면 충분
    let shipOk = true;
    if (state.settings.includeShipping !== false && state.counts) {
      const target = state.counts.shipped + state.counts.processing;
      shipOk = inprog.length >= target || !!(oldest && oldest < isoDaysAgo(75));
    }
    if (oldest && oldest < cut.cutoff && shipOk) return 'cutoff';
    if (cut.covered && pageOrders && pageOrders.length && pageOrders.every((o) => state.knownAtStart.has(o.id))) {
      const unseenOlder = inprog.filter((o) => !state.sessionIds.has(o.id) && o.date && (!oldest || o.date.slice(0, 10) <= oldest));
      if (!unseenOlder.length && shipOk) return 'incremental';          // 새 주문만 받고 종료 (배송 중 주문 상태도 갱신됨)
    }
    return null;
  }
  function updateCoverage(reason) {
    if (state.cancel) return;
    const old = state.settings.coverage;
    let newFrom = null;
    if (state.meta && state.meta.hasMore === false) newFrom = 'all';
    else if (reason === 'cutoff') {
      const ds = [...state.sessionIds].map((id) => state.orders[id] && state.orders[id].date).filter(Boolean).map((d) => d.slice(0, 10)).sort();
      if (ds[0]) newFrom = addDaysISO(ds[0], 1);                       // 마지막 페이지의 가장 오래된 날짜는 일부만 받았을 수 있어 하루 여유
    } else if (reason === 'incremental') newFrom = old && old.from;
    if (!newFrom) return;
    let from = newFrom;
    if (old && old.from) from = (old.from === 'all' || newFrom === 'all') ? 'all' : (old.from < newFrom ? old.from : newFrom);
    state.settings.coverage = { from, at: Date.now() };
    store.save();
  }

  /* ---------------------------- 저장소 ---------------------------- */
  const store = {
    async load() {
      try {
        const r = await chrome.storage.local.get(['orders', 'settings', 'counts']);
        if (r.orders) {
          const fresh = state.orders;                       // 저장소 로딩 중 먼저 들어온 응답은 버리지 않고 병합
          state.orders = r.orders;
          for (const id of Object.keys(fresh)) state.orders[id] = AES.mergeOrder(state.orders[id], fresh[id]);
          state.knownAtStart = new Set(Object.keys(r.orders));
        }
        if (r.counts) state.counts = r.counts;
        if (r.settings) state.settings = { ...state.settings, ...r.settings };
      } catch (_) {}
    },
    _t: null,
    async flush() {                                   // 즉시 저장
      clearTimeout(store._t); store._t = null;
      try { await chrome.storage.local.set({ orders: state.orders, settings: state.settings, counts: state.counts }); } catch (_) {}
    },
    save() { clearTimeout(store._t); store._t = setTimeout(() => store.flush(), 300); },
    async clear() { try { await chrome.storage.local.remove(['orders']); } catch (_) {} }
  };

  /* ---------------------------- 데이터 수집 ---------------------------- */
  function ingest(list) {
    let changed = 0;
    for (const o of list) {
      if (!o || !o.id) continue;
      if (DETAIL_PATH && o.eta) { o.etaSrc = 'detail'; }
      const prev = state.orders[o.id];
      if (/^2025/.test(o.date || '') ) console.log('[aes-dbg] 2025 date from', o.source, o.id, o.date, (o.raw||'').slice(0,120), 'prev=', prev && prev.date);
      const merged = AES.mergeOrder(prev, o);
      const a = JSON.stringify({ ...merged, updated: 0 }), b = JSON.stringify({ ...(prev || {}), updated: 0 });
      if (a !== b) { changed++; state.orders[o.id] = merged; }
    }
    if (changed) { state.lastUpdate = Date.now(); store.save(); scheduleRender(); }
    return changed;
  }

  function scanDom(force) {
    try {
      if (!document.body) return 0;
      if (force !== true && state.listAt && !DETAIL_PATH) return 0; // API 로 받은 데이터가 있으면 DOM 스캔 불필요
      const { orders, cards } = AES.scrapeDom(document, { ref: new Date() });
      state.cards = cards;
      return ingest(orders);
    } catch (e) { console.warn('[알리 주문 통계] DOM 스캔 실패', e); return 0; }
  }
  const scanDomSoon = debounce(scanDom, 900);

  const hookCache = new Map();
  /** 응답 1건 처리. 추출된 주문 배열을 반환 (같은 응답이 훅/직접호출 양쪽으로 와도 한 번만 파싱) */
  function onHook(url, text) {
    if (typeof text !== 'string') return [];
    const key = text.length + ':' + text.slice(0, 60) + ':' + text.slice(-60);
    if (hookCache.has(key)) return hookCache.get(key);
    const json = AES.parseResponseText(text);
    if (!json) return [];
    // 알리 자체 집계 (배송 중 / 처리 중 / 결제 대기)
    if (/order\.count/i.test(url) && json.data && json.data.module) {
      const m = json.data.module;
      state.counts = { shipped: +m.shipped || 0, processing: +m.processing || 0, unpaid: +m.unpaid || 0, at: Date.now() };
      store.save(); scheduleRender();
      return [];
    }
    if (NOISE_URL.test(url) || !/\d{12,}/.test(text)) return [];
    if (!state.captures.some((c) => c.url === url && c.len === text.length)) {
      state.captures.push({ url, len: text.length, text: text.slice(0, 300000) });
      if (state.captures.length > 8) state.captures.shift();
    }
    const meta = AES.findListMeta(json);
    if (meta) {
      state.meta = meta; state.listAt = Date.now();
      if (!state.listSeen.has(key)) { state.listSeen.add(key); state.listResps.push(json); if (state.listResps.length > 400) state.listResps.shift(); }
    }
    let os = [];
    try {
      os = AES.extractFromJson(json, { ref: new Date() });
      if (meta) for (const o of os) state.sessionIds.add(o.id);
      // 주문 목록이 아닌 응답(상세 등)은 이미 아는 주문의 날짜/상태/금액을 덮어쓰지 않고 예상 배송일·환불 정보만 보강
      const toIngest = meta ? os : os.map((o) => {
        if (!state.orders[o.id]) return o;
        const p = { id: o.id, source: 'detail' };
        if (o.eta) { p.eta = o.eta; p.etaSrc = DETAIL_PATH ? 'detail' : 'api'; }
        if (o.refund) p.refund = o.refund;
        return p;
      });
      ingest(toIngest);
    } catch (err) { console.warn('[알리 주문 통계] JSON 파싱 실패', err); }
    if (meta) state.lastPageOrders = os;
    hookCache.set(key, os);
    if (hookCache.size > 60) hookCache.delete(hookCache.keys().next().value);
    return os;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.source === 'aes-net') {
      state.net.push({ url: e.data.url, len: e.data.len, via: e.data.via, body: e.data.body });
      if (state.net.length > 150) state.net.shift();
    } else if (e.data.source === 'aes-hook') onHook(e.data.url, e.data.text);
    else if (e.data.source === 'aes-mtop-res') { const f = pendingCalls.get(e.data.id); if (f) f(e.data); }
    else if (e.data.source === 'aes-libinfo') state.libInfo = e.data.info;
    else if (e.data.source === 'aes-req') {
      const k = e.data.api + ':' + e.data.at;
      if (!state.reqSeen.has(k)) { state.reqSeen.add(k); state.reqLog.push({ api: e.data.api, opts: e.data.opts, at: e.data.at }); if (state.reqLog.length > 80) state.reqLog.shift(); }
    }
  });
  window.postMessage({ source: 'aes-replay' }, '*'); // 이 스크립트가 뜨기 전에 도착한 응답 재수신

  new MutationObserver(scanDomSoon).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------------------------- 네트워크 직접 호출 (페이지의 lib.mtop 클라이언트 이용) ---------------------------- */
  const pendingCalls = new Map();
  let callSeq = 0;
  /** 페이지의 lib.mtop.request 를 opts 그대로 호출 → { ok, json } (서명/토큰/보안 처리는 페이지 클라이언트가 수행) */
  function libCall(opts) {
    return new Promise((resolve) => {
      const id = ++callSeq;
      const timer = setTimeout(() => { pendingCalls.delete(id); resolve({ ok: false, json: { error: 'timeout' } }); }, 25000);
      pendingCalls.set(id, (d) => { clearTimeout(timer); pendingCalls.delete(id); resolve(d); });
      window.postMessage({ source: 'aes-mtop', id, opts }, '*');
    });
  }
  const isOk = (j) => !!(j && Array.isArray(j.ret) && /^SUCCESS/i.test(j.ret[0] || ''));
  const errText = (r) => { const j = r && r.json; return (j && j.ret && j.ret[0]) || (j && j.error) || (j && j.message) || 'no-response'; };
  async function pool(list, n, fn) {
    const q = list.slice();
    await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length && !state.cancel && !state.cancelDetail) await fn(q.shift()); }));
  }

  /** 페이지의 lib.mtop 후킹 상태를 즉시 확인 (최대 3초 대기) */
  async function refreshLibInfo() {
    for (let i = 0; i < 60; i++) {
      state.libInfo = null;
      window.postMessage({ source: 'aes-libinfo-req' }, '*');
      for (let w = 0; w < 10 && !state.libInfo; w++) await sleep(10);
      if (state.libInfo && state.libInfo.hooked) return;
      await sleep(50);                            // lib 가 아직 로드되지 않았을 수 있으니 잠깐씩 재확인
    }
  }
  const hookOrders = (json) => onHook('fast:list', JSON.stringify(json));
  const dataToStr = (d) => (typeof d === 'string' ? d : JSON.stringify(d));
  const strToData = (like, str) => (typeof like === 'string' ? str : JSON.parse(str));
  function tokensOf(json) {
    const out = {};
    const lk = json && json.data && json.data.linkage;
    (function walk(n, p, d) {
      if (n == null || d > 6) return;
      if (typeof n === 'string') { if (n.length >= 6) out[p] = n; }
      else if (typeof n === 'object') for (const k of Object.keys(n)) walk(n[k], p + '/' + k, d + 1);
    })(lk, '', 0);
    return out;
  }
  const esc1 = (x) => JSON.stringify(x).slice(1, -1);
  function replaceTokens(data, a, b) {
    for (const p of Object.keys(a)) {
      if (b[p] == null || b[p] === a[p]) continue;
      for (const f of [(x) => x, esc1, (x) => esc1(esc1(x))]) data = data.split(f(a[p])).join(f(b[p]));
    }
    return data;
  }
  const bumpPage = (data) => data.replace(/(pageIndex\\*"\s*:\s*\\*"?)(\d+)/g, (m, p, n) => p + (parseInt(n, 10) + 1));
  const listReqs = () => state.reqLog.filter((r) => /order\.list/i.test(r.api));
  const orderIdsOf = (json) => { try { return AES.extractFromJson(json, { ref: new Date() }).map((o) => o.id); } catch (_) { return []; } };

  /** 화면 조작/이미지 로딩 없이 다음 페이지들을 페이지 자신의 mtop 클라이언트로 직접 요청. 성공 시 'done', 실패 시 사유 문자열 */
  async function loadAllFast() {
    if (!(state.meta && state.meta.hasMore)) return 'done';
    const early0 = shouldStop(state.lastPageOrders);               // 첫 페이지만으로 충분하면 추가 요청 없이 종료
    if (early0) { state.endReason = early0; return 'done'; }
    await refreshLibInfo();
    if (!state.libInfo || !state.libInfo.hooked) return 'fail:no-lib(' + (state.libInfo ? `lib=${state.libInfo.hasLib} mtop=${state.libInfo.hasMtop} request=${state.libInfo.requestType}` : 'noinfo') + ')';

    // 요청 1회 + 새 주문 확인. 성공하면 응답 JSON, 실패하면 null
    async function callList(opts) {
      const known = new Set(state.sessionIds);          // 이번 접속에서 목록 응답으로 받은 주문 (저장소의 이전 데이터와 무관하게 판단)
      const r = await libCall(opts);
      if (!r.ok || !isOk(r.json)) { state.fast.listWhy = 'api:' + errText(r); return null; }
      const os = hookOrders(r.json);
      if (!os.some((o) => !known.has(o.id))) { state.fast.listWhy = 'norepeat'; return null; }
      return r.json;
    }

    let tpl = null, dataCur = '', prev = null, cur = null, learnPrevTokens = null, saveAfter = false;
    state.endReason = '';
    const early = shouldStop(state.lastPageOrders);               // 첫 페이지만으로 충분하면 추가 요청 없이 종료
    if (early) { state.endReason = early; return 'done'; }

    // (0) 같은 접속에서 이전에 이어받던 체인이 있으면 이어서 계속 (기간을 늘렸을 때)
    if (state.chain && state.meta.hasMore) ({ tpl, dataCur, prev, cur } = state.chain);

    // (1) 저장된 요청 형식이 있으면 "주문 더 보기" 클릭 없이 바로 2페이지 요청 (1페이지 응답의 토큰으로 갱신)
    const saved = state.settings.listTpl;
    if (!tpl && saved && saved.opts && saved.prevTokens && state.meta.pageIndex <= 1 && state.listResps.length) {
      const first = state.listResps[state.listResps.length - 1];
      const dataFirst = replaceTokens(dataToStr(saved.opts.data), saved.prevTokens, tokensOf(first));
      let json = null;
      try { json = await callList({ ...saved.opts, data: strToData(saved.opts.data, dataFirst) }); } catch (_) {}
      if (json) { tpl = saved.opts; dataCur = dataFirst; prev = first; cur = json; state.fast.listTpl = 'saved'; state.lastPageOrders = hookOrders(json); }
      else { state.settings.listTpl = null; store.save(); state.fast.listTpl = 'saved-failed(' + state.fast.listWhy + ')'; }
      if (json) { const w = shouldStop(state.lastPageOrders); if (w) { state.endReason = w; state.chain = { tpl, dataCur, prev, cur }; return 'done'; } }
    }

    // (2) 없으면 "주문 더 보기"를 딱 한 번만 눌러 2페이지 요청 형식을 학습
    if (!tpl) {
      let reqs = listReqs();
      if (reqs.length < 2) {
        const before = reqs.length;
        const btn = findMoreButton();
        if (!btn) return 'fail:button';
        const at = state.listAt;
        btn.scrollIntoView({ block: 'center' }); btn.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 12000 && state.listAt === at) await sleep(40);
        await sleep(80);
        reqs = listReqs();
        if (reqs.length <= before) return 'fail:learn(요청 ' + reqs.length + '개)';
      }
      if (state.listResps.length < 2) return 'fail:resps';
      tpl = reqs[reqs.length - 1].opts;
      dataCur = dataToStr(tpl.data);
      prev = state.listResps[state.listResps.length - 2]; cur = state.listResps[state.listResps.length - 1];
      learnPrevTokens = tokensOf(prev); saveAfter = true; state.fast.listTpl = 'learned';
      state.settings.listTpl = { opts: tpl, prevTokens: learnPrevTokens }; store.save();   // 바로 저장 (다음 접속에서 실패하면 자동으로 지우고 재학습)
      const w = shouldStop(state.lastPageOrders);
      if (w) { state.endReason = w; state.chain = { tpl, dataCur, prev, cur }; return 'done'; }
    }

    // (3) 나머지 페이지: 응답마다 토큰을 갱신하며 이어서 요청 (기간/저장된 범위에 도달하면 중단)
    for (let i = 0; i < 500 && state.meta.hasMore && !state.cancel; i++) {
      const dataNext = bumpPage(replaceTokens(dataCur, tokensOf(prev), tokensOf(cur)));
      let optsNext;
      try { optsNext = { ...tpl, data: strToData(tpl.data, dataNext) }; } catch (e) { return 'fail:data-parse'; }
      const json = await callList(optsNext);
      if (!json) return 'fail:' + state.fast.listWhy;
      state.lastPageOrders = hookOrders(json);
      if (saveAfter) { state.settings.listTpl = { opts: tpl, prevTokens: learnPrevTokens }; store.save(); saveAfter = false; }  // 한 번 검증된 형식만 저장
      prev = cur; cur = json; dataCur = dataNext;
      state.chain = { tpl, dataCur, prev, cur };
      state.progress = `목록 불러오는 중(빠른 모드)… ${Object.keys(state.orders).length}건`;
      scheduleRender();
      fetchDetails(false);                          // 새로 발견된 배송 대기·진행 주문의 예상 배송일 조회를 목록 로딩과 동시에 진행
      const why = shouldStop(state.lastPageOrders);
      if (why) { state.endReason = why; return 'done'; }
    }
    return state.cancel ? 'cancel' : 'done';
  }

  /* ---------------------------- "주문 더 보기" 반복 클릭 (느린 방식, 빠른 방식 실패 시 대체) ---------------------------- */
  const MORE_RE = /^(더\s?보기|주문\s?더\s?보기|더\s?많은\s?주문.*|view\s?more.*|show\s?more.*|load\s?more.*|see\s?more.*|more orders|view orders)$/i;
  function findMoreButton() {
    const exact = state.meta && state.meta.moreText ? state.meta.moreText.trim() : '';
    const cands = [];
    for (const el of document.querySelectorAll('button, [role="button"], a, div, span')) {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 30) continue;
      if (!(exact && t === exact) && !MORE_RE.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      cands.push({ el, exactHit: !!(exact && t === exact), btn: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' });
    }
    if (!cands.length) return null;
    const pool = cands.some((c) => c.exactHit) ? cands.filter((c) => c.exactHit) : cands;
    return (pool.find((c) => c.btn) || pool[pool.length - 1]).el;
  }

  /** opts.auto: 페이지를 열 때 자동 실행 / opts.confirmed: 이미 경고를 확인함 */
  async function loadAll(opts = {}) {
    if (state.loading) return;
    let key = state.settings.period || '1w';
    if (!opts.confirmed && needsConfirm(key) && !confirmHeavy(periodInfo(key)[1])) {
      if (!opts.auto) { state.progress = '취소됨'; render(); return; }
      state.settings.period = key = '1w'; store.save();              // 자동 실행에서 거절하면 기본값(1주일)으로 진행
    }
    const info = periodInfo(key), cutoff = cutoffOf(key), covered = coversCutoff(cutoff);
    state.cut = { cutoff, covered };
    state.loading = true; state.cancel = false; state.endReason = '';
    state.progress = covered ? `${info[1]} · 저장된 내역 이후 추가분 확인 중…` : `${info[1]} 주문 목록 불러오는 중…`; render();
    for (let i = 0; i < 30 && !state.counts; i++) await sleep(50);   // 배송 중 주문 수(알리 집계)가 필요한 판단이 있어 잠깐 대기
    let stall = 0, why = '완료';
    let fastRes = 'skip';
    try { fastRes = await loadAllFast(); } catch (e) { fastRes = 'fail:exception ' + e.message; }
    state.fast.list = fastRes;
    if (fastRes === 'done') why = '완료(빠른 모드)';
    else if (fastRes !== 'cancel') { state.progress = `빠른 모드 실패(${fastRes}) → 화면 방식으로 전환`; render(); }
    for (let i = 0; i < 400 && !state.cancel && fastRes !== 'done' && fastRes !== 'cancel'; i++) {
      if (state.meta && state.meta.hasMore === false) break;                  // 마지막 페이지까지 로드됨
      const stop = shouldStop(state.lastPageOrders);
      if (stop) { state.endReason = stop; break; }
      const beforeN = Object.keys(state.orders).length, beforeAt = state.listAt;
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(350);
      const btn = findMoreButton();
      if (!btn) {
        if (++stall >= 4) { why = '"주문 더 보기" 버튼을 찾지 못해 중단'; break; }
        await sleep(900); continue;
      }
      btn.scrollIntoView({ block: 'center' }); await sleep(200);
      btn.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 12000 && state.listAt === beforeAt && !state.cancel) {
        await sleep(250);
        if (Object.keys(state.orders).length > beforeN) break;
      }
      await sleep(600); scanDom();
      const n = Object.keys(state.orders).length;
      state.progress = `주문 목록 불러오는 중… ${n}건 수집`;
      render();
      if (n === beforeN && state.listAt === beforeAt) { if (++stall >= 3) { why = '더 이상 새 주문이 로드되지 않아 중단'; break; } } else stall = 0;
    }
    state.loading = false;
    if (fastRes !== 'done') window.scrollTo(0, 0);
    const finishedOk = !state.cancel && (fastRes === 'done' || why === '완료' || (state.meta && state.meta.hasMore === false) || state.endReason);
    if (finishedOk) updateCoverage(state.endReason);
    store.flush();
    state.progress = state.cancel ? '중단됨' : `${info[1]} ${state.endReason === 'incremental' ? '추가분 확인' : '목록'} ${why} · 총 ${Object.keys(state.orders).length}건 저장됨`;
    render();
    if (!state.cancel) fetchDetails(false);
  }

  /* ---------------------------- 주문 상세에서 예상 배송일 가져오기 ---------------------------- */
  // 1) 저장된/학습된 API 요청 형식이 있으면 탭 없이 직접 호출 (빠름)
  // 2) 없으면 첫 주문만 백그라운드 탭으로 열어 요청 형식을 학습 → 검증 후 나머지는 직접 호출
  // 3) 실패한 주문은 백그라운드 탭으로 처리 (느리지만 확실)
  function applyDetail(id, res) {
    const o = { id, source: 'detail', detailAt: Date.now(), detailRaw: { relevant: (res.apiLines || []).filter((l) => /\d/.test(l) && /(배송|도착|예상|예정|delivery|deliver|arriv|estimat)/i.test(l)).slice(0, 15), head: [] } };
    if (res.eta) { o.eta = res.eta; o.etaSrc = 'detail'; }
    if (res.items && res.items.length) o.items = res.items.map((i) => ({ id: i.id, eta: i.eta }));
    if (state.orders[id]) ingest([o]);
  }

  async function replayDetail(tpls, fromId, toId) {
    const caps = [];
    for (const t of tpls) {
      const dataStr = dataToStr(t.opts.data).split(fromId).join(toId);
      let opts;
      try { opts = { ...t.opts, data: strToData(t.opts.data, dataStr) }; } catch (_) { return { ok: false, why: 'data-parse' }; }
      const r = await libCall(opts);
      if (!r.ok || !isOk(r.json)) return { ok: false, why: errText(r) };
      caps.push({ url: 'lib:' + t.api, text: JSON.stringify(r.json) });
    }
    return { ok: true, res: AES.extractDetail(toId, [], caps, { ref: new Date() }) };
  }

  function tabFetch(ids) {
    return new Promise((resolve) => {
      state.tabResolve = resolve;
      try { chrome.runtime.sendMessage({ type: 'fetchDetails', orderIds: ids }); } catch (e) { state.tabResolve = null; resolve(); }
    });
  }

  async function fetchDetails(force) {
    if (state.detail) { state.detailRerun = true; return; }     // 진행 중이면 끝난 뒤 새로 발견된 주문도 이어서 처리
    state.cancelDetail = false;
    do { state.detailRerun = false; await fetchDetailsOnce(force); force = false; } while (state.detailRerun && !state.cancelDetail);
  }

  async function fetchDetailsOnce(force) {
    const s = AES.computeStats(state.orders, {});
    let ids = [...new Set(s.inProgress.map((r) => r.orderId))].filter((id) => force || !(state.orders[id] && state.orders[id].detailAt && Date.now() - state.orders[id].detailAt < 6 * 3600 * 1000));
    if (!ids.length) { if (force) { state.progressDetail = '조회할 배송 대기·진행 주문이 없습니다'; render(); } return; }
    const total = ids.length;
    state.detail = { done: 0, total, running: true, base: 0 };
    const bump = () => { state.detail.done++; state.progressDetail = `예상 배송일 조회 중… ${state.detail.done}/${total}`; scheduleRender(); };
    state.progressDetail = `예상 배송일 조회 중… 0/${total}`; render();
    try {
      let tpl = state.settings.detailTpl && state.settings.detailTpl.valid ? state.settings.detailTpl : null;
      if (!tpl) {
        // 학습: 첫 주문은 탭으로 열어 결과와 API 요청 형식을 얻는다
        state.detailTplCand = null;
        const first = ids.shift();
        await tabFetch([first]); bump();
        const cand = state.detailTplCand;
        if (cand && cand.eta) {
          const v = await replayDetail(cand.tpls, cand.orderId, cand.orderId);
          const same = v.ok && v.res && v.res.eta && v.res.eta.start === cand.eta.start && v.res.eta.end === cand.eta.end;
          state.fast.detail = same ? 'learned' : 'fail:mismatch' + (v.ok ? '' : '(' + v.why + ')');
          if (same) { tpl = { tpls: cand.tpls, orderId: cand.orderId, valid: true }; state.settings.detailTpl = tpl; store.save(); }
        } else state.fast.detail = cand ? 'fail:no-eta' : 'fail:no-template';
      } else state.fast.detail = 'saved';

      let failed = [];
      if (tpl && ids.length) {
        await pool(ids, 6, async (id) => {
          let r = null;
          try { r = await replayDetail(tpl.tpls, tpl.orderId, id); } catch (_) {}
          if (r && r.ok) { applyDetail(id, r.res); bump(); } else failed.push(id);
        });
        if (failed.length === ids.length) { state.settings.detailTpl = null; store.save(); state.fast.detail += ' → 직접 호출 실패, 탭으로 전환'; }
      } else failed = ids;
      if (failed.length && !state.cancelDetail) {
        state.detail.base = state.detail.done;
        await tabFetch(failed);
      }
    } finally {
      state.detail = null;
      const miss = AES.computeStats(state.orders, {}).etaMissingOrders.length;
      state.progressDetail = state.cancelDetail ? '예상 배송일 조회 중단됨' : `예상 배송일 조회 완료${miss ? ` (상세에 날짜가 없는 주문 ${miss}건)` : ''}`;
      render();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.type) return;
    if (msg.type === 'detail') {
      if (msg.tpls && msg.tpls.length && msg.eta && !state.detailTplCand) state.detailTplCand = { tpls: msg.tpls, orderId: msg.orderId, eta: msg.eta };
      const o = { id: msg.orderId, source: 'detail', detailAt: Date.now(), detailRaw: msg.raw || null };
      if (msg.eta) { o.eta = msg.eta; o.etaSrc = 'detail'; }
      if (msg.items && msg.items.length) o.items = msg.items.map((i) => ({ id: i.id, eta: i.eta }));
      if (state.orders[msg.orderId]) ingest([o]);
    } else if (msg.type === 'detailProgress') {
      if (state.detail) { state.detail.done = (state.detail.base || 0) + msg.done; state.progressDetail = `예상 배송일 조회 중… ${state.detail.done}/${state.detail.total}`; scheduleRender(); }
    } else if (msg.type === 'detailDone') {
      const f = state.tabResolve; state.tabResolve = null; if (f) f();
    }
  });

  /* ---------------------------- 포맷 ---------------------------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('ko-KR');
  function money(amount, cur) {
    if (amount == null || !isFinite(amount)) return '-';
    try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: cur || 'KRW' }).format(amount); }
    catch (_) { return nf.format(Math.round(amount)) + (cur ? ' ' + cur : ''); }
  }
  function moneyMap(m, primary) {
    const e = Object.entries(m || {}).filter(([, v]) => v);
    if (!e.length) return '-';
    e.sort((a, b) => (a[0] === primary ? -1 : b[0] === primary ? 1 : b[1] - a[1]));
    return e.map(([c, v]) => money(v, c)).join(' + ');
  }
  function fmtDate(iso, withYear) {
    const d = AES.fromISO(iso); if (!d) return '-';
    const opt = { month: 'numeric', day: 'numeric', weekday: 'short' };
    if (withYear || d.getFullYear() !== new Date().getFullYear()) opt.year = '2-digit';
    let s = d.toLocaleDateString('ko-KR', opt);
    if (/T\d\d:\d\d/.test(iso)) s += ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return s;
  }
  function etaLine(r) {
    if (!r.etaEnd) return `<div class="eta"><span class="muted">${r.detailTried ? '예상 배송일 없음' : '예상 배송일 미조회'}</span></div>`;
    const same = !r.etaStart || r.etaStart === r.etaEnd;
    const txt = same ? fmtDate(r.etaEnd) : `${fmtDate(r.etaStart)} ~ ${fmtDate(r.etaEnd)}`;
    return `<div class="eta"><span class="k">도착 예정</span><span>${esc(txt)}</span><span class="dd">${dday(r)}</span></div>`;
  }
  const fmtShort = (iso) => { const d = AES.fromISO(iso); if (!d) return '-'; return `${d.getFullYear() !== new Date().getFullYear() ? String(d.getFullYear()).slice(2) + '.' : ''}${d.getMonth() + 1}.${d.getDate()}`; };
  function dday(r) {
    if (r.daysLeft == null) return '';
    if (r.daysLeft > 0) return `D-${r.daysLeft}`;
    if (r.daysLeft === 0) return '오늘';
    return `${-r.daysLeft}일 지연`;
  }
  const STATUS_BADGE = { pending_ship: ['배송 전', 'b-wait'], shipping: ['배송 중', 'b-ship'], delivered: ['배송 완료', 'b-done'], cancelled: ['취소', 'b-cancel'], refund: ['환불', 'b-cancel'], unpaid: ['결제대기', 'b-cancel'], event: ['이벤트', 'b-cancel'], unknown: ['?', 'b-cancel'] };
  const badge = (s) => { const [t, c] = STATUS_BADGE[s] || STATUS_BADGE.unknown; return `<span class="badge ${c}">${t}</span>`; };

  /* ---------------------------- UI ---------------------------- */
  const host = document.createElement('div');
  host.id = 'aes-host';
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;right:0;';
  const root = host.attachShadow({ mode: 'open' });
  (document.body || document.documentElement).appendChild(host);
  if (!document.body) document.addEventListener('DOMContentLoaded', () => document.body.appendChild(host));

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .w{--bg:#fff;--fg:#1d1d1f;--mu:#6b7280;--bd:#e5e7eb;--card:#f7f7f9;--ac:#e62e2e;--ac2:#2563eb;--ok:#16a34a;--wa:#d97706;
     font:13px/1.45 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",Roboto,sans-serif;color:var(--fg)}
  @media(prefers-color-scheme:dark){.w{--bg:#18181b;--fg:#f4f4f5;--mu:#a1a1aa;--bd:#33333a;--card:#232328;--ac:#ff5a5a;--ac2:#60a5fa;--ok:#4ade80;--wa:#fbbf24}}
  .fab{position:fixed;right:18px;bottom:18px;background:var(--ac);color:#fff;border:0;border-radius:999px;padding:11px 16px;font:600 13px inherit;font-family:inherit;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28)}
  .fab:hover{filter:brightness(1.08)}
  .panel{position:fixed;top:0;right:0;height:100vh;width:min(470px,100vw);background:var(--bg);border-left:1px solid var(--bd);box-shadow:-8px 0 30px rgba(0,0,0,.18);display:flex;flex-direction:column;transform:translateX(105%);transition:transform .22s ease}
  .panel.open{transform:none}
  header{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--bd)}
  header h1{font-size:15px;margin:0;flex:1}
  .x{background:none;border:0;font-size:20px;color:var(--mu);cursor:pointer;line-height:1}
  .tabs{display:flex;border-bottom:1px solid var(--bd)}
  .tab{flex:1;padding:9px 4px;background:none;border:0;border-bottom:2px solid transparent;color:var(--mu);font:inherit;cursor:pointer}
  .tab.on{color:var(--ac);border-color:var(--ac);font-weight:600}
  .body{flex:1;overflow:auto;padding:14px}
  .tools{display:flex;flex-wrap:wrap;gap:6px;padding:10px 14px;border-top:1px solid var(--bd);background:var(--card);align-items:center}
  button.b{font:inherit;padding:6px 10px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:8px;cursor:pointer}
  button.b:hover{border-color:var(--ac)}
  button.b.pri{background:var(--ac);border-color:var(--ac);color:#fff}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
  .kpi{background:var(--card);border-radius:10px;padding:10px 12px}
  .kpi .l{color:var(--mu);font-size:11px}
  .kpi .v{font-size:18px;font-weight:700;margin-top:2px;word-break:keep-all}
  .kpi .s{color:var(--mu);font-size:11px;margin-top:2px}
  .kpi.hl .v{color:var(--ac)}
  .kpi.ok .v{color:var(--ok)}
  .sum{display:grid;grid-template-columns:1.5fr 1fr;gap:1px;background:var(--bd);border-radius:10px;overflow:hidden;margin-bottom:14px}
  .sum>div{background:var(--card);padding:12px 14px}
  .sum .l{color:var(--mu);font-size:11px}
  .sum .v{font-weight:700;margin-top:2px;font-variant-numeric:tabular-nums}
  .sum .big{font-size:22px;color:var(--ac)}
  .sum .s{color:var(--mu);font-size:11px;margin-top:2px}
  a.row,a.rf{color:inherit;text-decoration:none;margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:8px}
  a.row:hover,a.rf:hover{background:var(--card)}
  .seg{display:flex;gap:6px;margin-bottom:6px}
  .seg button{flex:1;padding:6px 4px;border:1px solid var(--bd);background:var(--bg);color:var(--mu);border-radius:8px;font:inherit;cursor:pointer}
  .seg button.on{background:var(--card);color:var(--fg);border-color:var(--ac);font-weight:600}
  .rf{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--bd)}
  .rf img,.rf .ph{width:44px;height:44px;border-radius:8px;object-fit:cover;background:var(--card)}
  .rf .ti{display:block;font-weight:500;color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rf .sub{display:flex;align-items:center;gap:6px;margin-top:4px}
  .rf .amt{font-size:15px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .rf .amt.p{color:var(--wa)}.rf .amt.d{color:var(--ok)}.rf .amt.n{color:var(--mu);font-weight:400}
  .eta{display:flex;align-items:baseline;gap:6px;margin-top:4px}
  .eta .k{color:var(--mu);font-size:12px;font-weight:400}
  .eta .dd{margin-left:auto}
  .tools .main{display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:1 1 100%}
  .tools .more{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;flex:1 1 100%;padding:10px 0 2px;border-top:1px solid var(--bd)}
  .tools .more .sep{flex:1 1 100%;height:0}
  button.b.ghost{border-color:transparent;background:none;color:var(--mu)}
  h2{font-size:13px;margin:16px 0 8px}
  .bar{display:grid;grid-template-columns:140px 1fr auto;align-items:center;gap:8px;margin:5px 0}
  .bar .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bar .tr{height:10px;background:var(--card);border-radius:5px;overflow:hidden}
  .bar .f{height:100%;background:var(--ac2);border-radius:5px}
  .bar .n{color:var(--mu);font-size:12px;text-align:right;min-width:36px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{background:var(--card);border-radius:999px;padding:3px 10px;font-size:12px}
  .chip b{color:var(--ac)}
  .row{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--bd)}
  .row img{width:52px;height:52px;object-fit:cover;border-radius:8px;background:var(--card);flex:none}
  .row .ph{width:52px;height:52px;border-radius:8px;background:var(--card);flex:none}
  .row .m{flex:1;min-width:0}
  .row .ti{font-weight:500;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:inherit;text-decoration:none}
  .row .sub{color:var(--mu);font-size:12px;margin-top:4px}
  .row .eta{font-weight:600}
  .badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;margin-right:4px}
  .b-wait{background:#fef3c7;color:#92400e}.b-ship{background:#dbeafe;color:#1e40af}.b-done{background:#dcfce7;color:#166534}.b-cancel{background:#e5e7eb;color:#374151}
  .dd{color:var(--ac);margin-left:6px;font-weight:700}
  .muted{color:var(--mu);font-weight:400}
  .empty{text-align:center;color:var(--mu);padding:40px 10px;line-height:1.7}
  input.s{width:100%;padding:7px 10px;border:1px solid var(--bd);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit;margin-bottom:8px}
  .note{color:var(--mu);font-size:11.5px;margin-top:8px}
  .prog{color:var(--ac2);font-size:12px;flex:1 1 100%}
  label.st{display:flex;align-items:center;gap:6px;color:var(--mu);font-size:12px}
  label.st select{padding:3px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit}
  label.st input{width:70px;padding:3px 6px;border:1px solid var(--bd);border-radius:6px;background:var(--bg);color:var(--fg)}
  `;

  root.innerHTML = `<style>${CSS}</style><div class="w"><button class="fab" data-act="toggle">알리 통계</button><div class="panel" id="p"></div></div>`;
  const panel = root.getElementById('p');
  const fab = root.querySelector('.fab');

  let renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; setTimeout(() => { renderQueued = false; render(); }, 250); }

  function barList(items, labelFn, valFn, fmt) {
    const max = Math.max(1, ...items.map(valFn));
    return items.map((it) => `<div class="bar"><div class="t" title="${esc(labelFn(it))}">${esc(labelFn(it))}</div><div class="tr"><div class="f" style="width:${Math.max(2, valFn(it) / max * 100)}%"></div></div><div class="n">${fmt(it)}</div></div>`).join('');
  }

  function emptyText() {
    return '수집된 주문이 없습니다';
  }
  function diagnose() {
    const body = document.body ? document.body.innerText || '' : '';
    const apiNames = [...new Set(performance.getEntriesByType('resource').map((r) => r.name).filter((n) => /mtop|acs\./i.test(n)).map((n) => (n.match(/mtop\.[\w.]+/) || [n.slice(0, 80)])[0]))];
    return {
      itemLinks: document.querySelectorAll('a[href*="/item/"], a[href*="/i/"]').length,
      orderWordCount: (body.match(/주문|Order/gi) || []).length,
      longDigits: (body.match(/\d{15,}/g) || []).length,
      iframes: [...document.querySelectorAll('iframe')].map((f) => (f.src || '').slice(0, 120)),
      apiNames, meta: state.meta,
      bodyTextSample: body.slice(0, 5000)
    };
  }
  const emptyView = () => `<div class="empty">${emptyText()}</div>`;
  function countsBanner() {
    const c = state.counts; if (!c) return '';
    return `<div class="grid"><div class="kpi"><div class="l">알리 집계 · 배송 중</div><div class="v">${c.shipped}건</div></div>
      <div class="kpi"><div class="l">알리 집계 · 배송 전</div><div class="v">${c.processing}건</div>${c.unpaid ? `<div class="s">결제 대기 ${c.unpaid}건</div>` : ''}</div></div>`;
  }
  function loadedNote(s) {
    if (!state.counts) return '';
    const target = state.counts.shipped + state.counts.processing;
    const have = s.statusOrders.shipping + s.statusOrders.pending_ship;
    if (have >= target) return '';
    return `<div class="note" style="margin:-6px 0 12px;color:var(--wa)">배송 대기·진행 ${target}건 중 ${have}건만 불러옴</div>`;
  }
  function viewSummary(s) {
    if (!s.totalOrders) return countsBanner() + emptyView();
    const cats = s.categories.slice(0, 8);
    const months = s.monthly;                      // 전체 개월 표시 (12개월 제한 없음)
    const discNote = s.discountOrders ? `${s.discountOrders}건` : '없음';
    return countsBanner() + loadedNote(s) + `
    <div class="grid">
      <div class="kpi"><div class="l">구매한 상품</div><div class="v">${s.itemCount}개</div><div class="s">주문 ${s.orderCount}건</div></div>
      <div class="kpi"><div class="l">총 결제액</div><div class="v">${esc(moneyMap(s.spent, s.primary))}</div><div class="s">주문당 ${s.primaryOrders ? esc(money((s.spent[s.primary] || 0) / s.primaryOrders, s.primary)) : '-'}</div></div>
      <div class="kpi ok"><div class="l">받은 할인</div><div class="v">${esc(moneyMap(s.discount, s.primary))}</div><div class="s">${discNote}</div></div>
      <div class="kpi"><div class="l">배송 대기·진행</div><div class="v">${s.inProgressItems}개</div><div class="s">배송 전 ${s.pendingItems} · 배송 중 ${s.shippingItems}</div></div>
    </div>
    ${refundBanner(s)}
    <h2>주로 산 품목</h2>
    ${barList(cats, (c) => c.name, (c) => c.count, (c) => c.count + '개')}
    ${s.keywords.length ? `<h2>자주 나온 키워드</h2><div class="chips">${s.keywords.slice(0, 16).map((k) => `<span class="chip">${esc(k.word)} <b>${k.count}</b></span>`).join('')}</div>` : ''}
    ${months.length ? `<h2>월별 결제액 (${months.length}개월)</h2>${barList(months, (m) => m.month, (m) => m.spend, (m) => esc(money(m.spend, s.primary)))}` : ''}`;
  }

  function viewShipping(s) {
    const f = state.shipFilter || 'all';
    const cnt = { all: s.inProgressItems + s.deliveredItems, pending_ship: s.pendingItems, shipping: s.shippingItems, delivered: s.deliveredItems };
    const chips = [['all', '전체'], ['pending_ship', '배송 전'], ['shipping', '배송 중'], ['delivered', '배송 완료']];
    const head = countsBanner() + loadedNote(s) + `<div class="seg">${chips.map(([k, t]) => `<button data-ship="${k}" class="${f === k ? 'on' : ''}">${t} ${cnt[k]}</button>`).join('')}</div>`;
    const rows = [...s.inProgress, ...s.delivered].filter((r) => f === 'all' || r.status === f);
    if (!rows.length) return head + (s.totalOrders ? '<div class="empty">해당하는 주문이 없습니다</div>' : emptyView());
    return head + rows.map((r) => `
      <a class="row" href="${esc(orderUrl(r.orderId))}" target="_blank" rel="noopener" title="주문 상세 열기">
        ${thumb(r.image)}
        <div class="m">
          <div class="ti">${esc(r.title)}</div>
          <div class="sub">${badge(r.status)}${r.qty > 1 ? `${r.qty}개 · ` : ''}주문일 ${fmtDate(r.orderDate)}</div>
          ${r.status === 'delivered' ? '' : etaLine(r)}
        </div>
      </a>`).join('');
  }

  /** 잔여 환불 예정 금액(크게) + 환불 완료 금액을 한 카드에 */
  function refundBanner(s) {
    const c = s.refundCount; if (!c.processing && !c.done) return '';
    return `<div class="sum">
      <div><div class="l">잔여 환불 예정 금액</div><div class="v big">${c.processing ? esc(moneyMap(s.refundSum.processing, s.primary)) : '없음'}</div><div class="s">${c.processing ? `진행 중 ${c.processing}건` : '진행 중인 환불 없음'}</div></div>
      <div><div class="l">환불 완료</div><div class="v">${c.done ? esc(moneyMap(s.refundSum.done, s.primary)) : '-'}</div><div class="s">${c.done}건</div></div>
    </div>`;
  }
  const REFUND_BADGE = { processing: ['환불 진행 중', 'b-wait', 'p'], done: ['환불 완료', 'b-done', 'd'], none: ['환불 없음', 'b-cancel', 'n'] };
  const AMT_SRC = { shown: '알리가 표시한 환불 금액', paid: '실제 결제한 총 금액 기준', list: '상품 표시가 기준' };
  function viewRefunds(s) {
    if (!s.refunds.length) return '<div class="empty">취소·환불된 주문이 없습니다</div>';
    return refundBanner(s) +
      s.refunds.map((r) => {
        const [t, cls, ac] = REFUND_BADGE[r.state];
        const amt = r.state !== 'none' && r.amount ? esc(money(r.amount.amount, r.amount.currency || s.primary)) : '—';
        return `<a class="rf" href="${esc(orderUrl(r.orderId))}" target="_blank" rel="noopener" title="${esc(AMT_SRC[r.amountSrc] || '')} · 클릭하면 주문 상세 열기">
          ${thumb(r.image)}
          <div style="min-width:0">
            <div class="ti">${esc(r.title)}</div>
            <div class="sub"><span class="badge ${cls}" style="margin:0">${t}</span><span class="muted">${fmtShort(r.date)}</span></div>
          </div>
          <div class="amt ${ac}">${amt}</div>
        </a>`; }).join('');
  }

  function viewPurchases(s) {
    if (!s.purchases.length) return emptyView();
    const q = state.filter.trim().toLowerCase();
    const rows = s.purchases.filter((p) => !q || p.title.toLowerCase().includes(q) || p.category.includes(q));
    return `<input class="s" data-input="filter" placeholder="상품명·분류 검색" value="${esc(state.filter)}">` +
      rows.slice(0, 300).map((p) => `
      <a class="row" href="${esc(orderUrl(p.orderId))}" target="_blank" rel="noopener" title="주문 상세 열기">
        ${thumb(p.image)}
        <div class="m">
          <div class="ti">${esc(p.title)}</div>
          <div class="sub">${badge(p.status)}${esc(p.category)} · ${fmtDate(p.date, true)}</div>
          <div class="sub">${p.price ? esc(money(p.price.amount, p.price.currency || s.primary)) : '-'}${p.qty > 1 ? ` × ${p.qty}` : ''}</div>
        </div>
      </a>`).join('') + (rows.length > 300 ? `<div class="note">${rows.length}개 중 300개 표시</div>` : '');
  }

  const orderUrl = (id) => `${location.origin}/p/order/detail.html?orderId=${encodeURIComponent(id)}`;
  const thumb = (src) => (src && state.settings.thumbs !== false ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : '<div class="ph"></div>');

  function computeNow() {
    const r = state.settings.usdRate;
    return AES.computeStats(state.orders, { rates: r > 0 ? { USD: r } : {}, since: cutoffOf(state.settings.period || '1w') });
  }

  function render() {
    const s = computeNow();
    state.stats = s;
    const tabs = [['summary', '요약'], ['shipping', `배송 현황${s.inProgress.length ? ` (${s.inProgressItems})` : ''}`], ['refunds', `취소·환불${s.refunds.length ? ` (${s.refunds.length})` : ''}`], ['purchases', '구매 내역']];
    const body = state.tab === 'summary' ? viewSummary(s) : state.tab === 'shipping' ? viewShipping(s) : state.tab === 'refunds' ? viewRefunds(s) : viewPurchases(s);
    const keepScroll = panel.querySelector('.body') ? panel.querySelector('.body').scrollTop : 0;
    const hadFocus = root.activeElement && root.activeElement.dataset && root.activeElement.dataset.input;
    const autoRate = s.estimatedRates.USD ? Math.round(s.estimatedRates.USD) : '';
    panel.className = 'panel' + (state.open ? ' open' : '');
    panel.innerHTML = `
      <header><h1>알리 주문 통계</h1><button class="x" data-act="toggle" title="닫기">×</button></header>
      <div class="tabs">${tabs.map(([k, t]) => `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}</div>
      <div class="body">${body}</div>
      <div class="tools">
        ${state.progress ? `<div class="prog">${esc(state.progress)}</div>` : ''}
        ${state.progressDetail ? `<div class="prog">${esc(state.progressDetail)}</div>` : ''}
        ${(() => { const k = state.settings.period || '1w'; return !state.loading && !coversCutoff(cutoffOf(k)) ? `<div class="prog" style="color:var(--wa)">${esc(periodInfo(k)[1])} 내역을 아직 불러오지 않았습니다</div>` : ''; })()}
        <div class="main">
          <label class="st">기간 <select data-input="period">${PERIODS.map((p) => `<option value="${p[0]}" ${(state.settings.period || '1w') === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></label>
          ${state.loading ? '<button class="b" data-act="stop">중단</button>' : '<button class="b pri" data-act="loadall">불러오기</button>'}
          ${state.detail ? '<button class="b" data-act="stopdetail">조회 중단</button>' : '<button class="b" data-act="details">예상 배송일 조회</button>'}
          <button class="b ghost" data-act="more" style="margin-left:auto">설정 ${state.moreOpen ? '▴' : '▾'}</button>
        </div>
        ${state.moreOpen ? `<div class="more">
          <label class="st" title="체크하면 기간과 무관하게 배송 대기·진행 중인 주문을 모두 불러옵니다 (최대 75일 전까지)"><input type="checkbox" data-input="ship" ${state.settings.includeShipping !== false ? 'checked' : ''} style="width:auto"> 배송 중 주문 항상 포함</label>
          <label class="st" title="주문 페이지를 열면 자동으로 목록 + 예상 배송일을 수집"><input type="checkbox" data-input="auto" ${state.settings.auto !== false ? 'checked' : ''} style="width:auto"> 자동 실행</label>
          <label class="st"><input type="checkbox" data-input="thumbs" ${state.settings.thumbs !== false ? 'checked' : ''} style="width:auto"> 썸네일</label>
          <label class="st" title="비워두면 같은 상품의 두 통화 가격으로 자동 추정">USD 환율(원) <input type="number" min="500" max="3000" placeholder="${autoRate || '자동'}" value="${state.settings.usdRate > 0 ? state.settings.usdRate : ''}" data-input="fx"></label>
          <div class="sep"></div>
          <button class="b" data-act="rescan">다시 읽기</button>
          <button class="b" data-act="csv">CSV</button>
          <button class="b" data-act="debug" title="파싱이 이상할 때 원본 구조를 내보냅니다 (주소 등 개인정보가 포함될 수 있으니 공유 전 확인)">디버그</button>
          <button class="b" data-act="clear">초기화</button>
        </div>` : ''}
        <div class="note" style="flex:1 1 100%;margin:0">수집된 주문 ${s.totalOrders}건</div>
      </div>`;
    fab.style.display = state.open ? 'none' : '';
    const b = panel.querySelector('.body'); if (b) b.scrollTop = keepScroll;
    if (hadFocus === 'filter') { const i = panel.querySelector('[data-input="filter"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  /* ---------------------------- 이벤트 ---------------------------- */
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-tab],[data-ship]'); if (!t) return;
    if (t.dataset.tab) { state.tab = t.dataset.tab; render(); return; }
    if (t.dataset.ship) { state.shipFilter = t.dataset.ship; render(); return; }
    const act = t.dataset.act;
    if (act === 'more') { state.moreOpen = !state.moreOpen; render(); }
    else if (act === 'toggle') { state.open = !state.open; if (state.open) scanDom(); render(); }
    else if (act === 'loadall') loadAll();
    else if (act === 'stop') { state.cancel = true; }
    else if (act === 'details') fetchDetails(true);
    else if (act === 'stopdetail') { state.cancelDetail = true; try { chrome.runtime.sendMessage({ type: 'cancelDetails' }); } catch (_) {} }
    else if (act === 'rescan') { const n = scanDom(true); state.progress = `다시 읽음 (변경 ${n}건)`; render(); }
    else if (act === 'csv') exportCsv();
    else if (act === 'debug') exportDebug();
    else if (act === 'clear') { if (confirm('저장된 주문 통계 데이터를 모두 지울까요?')) { state.orders = {}; state.settings.coverage = null; state.knownAtStart = new Set(); store.clear(); state.progress = ''; scanDom(); render(); } }
  });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.input === 'filter') { state.filter = t.value; render(); }
    if (t.dataset.input === 'ship') { state.settings.includeShipping = !!t.checked; store.save(); }
    if (t.dataset.input === 'period') {
      const nk = t.value, prevK = state.settings.period || '1w';
      if (nk === prevK) return;
      if (needsConfirm(nk) && !confirmHeavy(periodInfo(nk)[1])) { render(); return; }     // 거절하면 기존 기간 유지
      state.settings.period = nk; store.save(); render();
      if (!coversCutoff(cutoffOf(nk))) loadAll({ confirmed: true });                      // 저장된 범위를 넘으면 추가분만 불러오기
      return;
    }
    if (t.dataset.input === 'auto') { state.settings.auto = !!t.checked; store.save(); }
    if (t.dataset.input === 'thumbs') { state.settings.thumbs = !!t.checked; store.save(); render(); }
    if (t.dataset.input === 'fx') {
      const v = parseFloat(t.value);
      state.settings.usdRate = v > 0 ? v : null; store.save();
      clearTimeout(state._dt); state._dt = setTimeout(render, 700);
    }
  });

  /* ---------------------------- 내보내기 ---------------------------- */
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportCsv() {
    const s = state.stats || computeNow();
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['주문번호', '주문일', '상태', '상품명', '분류', '수량', '단가', '통화', '링크'];
    const rows = s.purchases.map((p) => [p.orderId, p.date, AES.STATUS_LABEL[p.status] || p.status, p.title, p.category, p.qty, p.price ? p.price.amount : '', p.price ? (p.price.currency || s.primary) : '', p.url]);
    download('aliexpress-orders.csv', '\ufeff' + [head, ...rows].map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
  }
  function exportDebug() {
    const dump = {
      version: 2, page: location.href, ua: navigator.userAgent, at: new Date().toISOString(),
      note: '개인정보(이름/주소/전화번호 등)가 포함됐는지 공유 전에 꼭 확인하세요.',
      counts: state.counts, meta: state.meta, fast: state.fast, libInfo: state.libInfo, period: state.settings.period, coverage: state.settings.coverage, endReason: state.endReason,
      detailTpl: state.settings.detailTpl,
      mtopReqs: state.reqLog.map((r) => ({ api: r.api, at: r.at, opts: JSON.parse(JSON.stringify(r.opts, (k, v) => (typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + `…(${v.length})` : v))) })),
      diag: diagnose(),
      netLog: state.net,
      parsedOrders: Object.values(state.orders).map((o) => ({ ...o, raw: undefined })),
      domCards: state.cards.slice(0, 3),
      apiCaptures: state.captures.slice(-3).map((c) => ({ url: c.url, text: c.text.slice(0, 120000) }))
    };
    download('aliexpress-stats-debug.json', JSON.stringify(dump, null, 2), 'application/json');
  }

  /* ---------------------------- 시작 ---------------------------- */
  window.addEventListener('pagehide', () => { if (store._t) store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && store._t) store.flush(); });
  (async () => {
    await store.load();
    if (/\/p\/order\/index/i.test(location.pathname)) state.open = true;
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
