// 페이지(MAIN world)에서 실행: 주문 관련 fetch / XHR 응답을 복사해 content script 로 전달한다.
(() => {
  if (window.__aesHooked) return;
  window.__aesHooked = true;

  const URL_RE = /order|trade|logistic|tracking|mtop|acs\./i;
  const MAX = 6 * 1024 * 1024;

  // content script 는 document_idle 에 시작하므로, 그 전에 도착한 응답도 다시 보내줄 수 있게 보관
  const buf = [];
  function post(url, text, via, body) {
    try {
      if (typeof text !== 'string') return;
      const net = { source: 'aes-net', url: String(url).slice(0, 300), len: text.length, via, body: typeof body === 'string' ? body.slice(0, 4000) : undefined };
      window.postMessage(net, '*');
      if (text.length < 20 || text.length > MAX) return;
      const hook = { source: 'aes-hook', url: String(url), text };
      if (!/recommend|cart\.count|cookie\.render/i.test(url)) { buf.push(net, hook); if (buf.length > 24) buf.splice(0, 2); }
      window.postMessage(hook, '*');
    } catch (_) { /* ignore */ }
  }
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'aes-replay') { for (const m of buf.slice()) window.postMessage(m, '*'); for (const m of reqLog.slice()) window.postMessage(m, '*'); }
  });

  // ---- 알리 페이지의 mtop 클라이언트(window.lib.mtop.request)를 감싼다 ----
  // 서명/토큰/보안(isSec) 처리를 페이지 자신의 클라이언트가 해주므로, 같은 요청을 data 만 바꿔 다시 호출하면 된다.
  const reqLog = [];
  let origRequest = null;
  const safeClone = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (_) { return null; } };
  function hookLib() {
    try {
      const lib = window.lib;
      if (!lib || !lib.mtop || typeof lib.mtop.request !== 'function') return false;
      if (lib.mtop.request.__aes) return true;
      const orig = lib.mtop.request;
      origRequest = orig;
      const w = function (opts) {
        try {
          const c = safeClone(opts);
          if (c && c.api) {
            const rec = { source: 'aes-req', api: c.api, opts: c, at: Date.now() };
            reqLog.push(rec); if (reqLog.length > 80) reqLog.shift();
            window.postMessage(rec, '*');
          }
        } catch (_) {}
        return orig.apply(this, arguments);
      };
      w.__aes = true;
      lib.mtop.request = w;
      return true;
    } catch (_) { return false; }
  }
  function libInfo() {
    const lib = window.lib;
    return {
      hasLib: !!lib, libKeys: lib ? Object.keys(lib).slice(0, 40) : [],
      hasMtop: !!(lib && lib.mtop), mtopKeys: lib && lib.mtop ? Object.keys(lib.mtop).slice(0, 40) : [],
      requestType: lib && lib.mtop ? typeof lib.mtop.request : null,
      hooked: !!(lib && lib.mtop && lib.mtop.request && lib.mtop.request.__aes),
      mtopLikeGlobals: Object.keys(window).filter((k) => /mtop/i.test(k)).slice(0, 20)
    };
  }
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'aes-libinfo-req') { hookLib(); window.postMessage({ source: 'aes-libinfo', info: libInfo() }, '*'); }
  });
  hookLib();
  const libTimer = setInterval(() => { hookLib(); }, 30);
  setTimeout(() => clearInterval(libTimer), 60000);
  let infoCount = 0;
  const infoTimer = setInterval(() => { window.postMessage({ source: 'aes-libinfo', info: libInfo() }, '*'); if (++infoCount > 40) clearInterval(infoTimer); }, 1000);

  // content script 의 요청 대행: 페이지의 lib.mtop.request 를 (기록 없이) 그대로 호출
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'aes-mtop' || !d.opts) return;
    const reply = (ok, json) => window.postMessage({ source: 'aes-mtop-res', id: d.id, ok, json: safeClone(json) }, '*');
    try {
      hookLib();
      const fn = origRequest || (window.lib && window.lib.mtop && window.lib.mtop.request);
      if (typeof fn !== 'function') return reply(false, { error: 'lib.mtop.request 없음' });
      let done = false;
      const fin = (ok, json) => { if (!done) { done = true; reply(ok, json); } };
      const ret = fn.call(window.lib.mtop, d.opts, (res) => fin(true, res), (err) => fin(false, err));
      if (ret && typeof ret.then === 'function') ret.then((res) => fin(true, res), (err) => fin(false, err));
    } catch (err) { reply(false, { error: String(err) }); }
  });

  // fetch
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      const p = origFetch.apply(this, arguments);
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (URL_RE.test(url)) {
          p.then((res) => { try { res.clone().text().then((t) => post(url, t, 'fetch')).catch(() => {}); } catch (_) {} })
            .catch(() => {});
        }
      } catch (_) { /* ignore */ }
      return p;
    };
  }

  // XMLHttpRequest
  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__aesUrl = String(url); this.__aesMethod = String(method); } catch (_) {}
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try { this.__aesBody = typeof body === 'string' ? body : ''; } catch (_) {}
    try {
      if (this.__aesUrl && URL_RE.test(this.__aesUrl)) {
        this.addEventListener('load', () => {
          try {
            if (this.responseType === '' || this.responseType === 'text') post(this.__aesUrl, this.responseText, 'xhr', this.__aesMethod + ' ' + this.__aesBody);
            else if (this.responseType === 'json' && this.response) post(this.__aesUrl, JSON.stringify(this.response), 'xhr');
          } catch (_) {}
        });
      }
    } catch (_) {}
    return XS.apply(this, arguments);
  };

  // JSONP(mtop) 콜백 가로채기: window.mtopjsonpN / jsonp 콜백 함수가 정의될 때 감싼다
  try {
    const wrapped = new WeakSet();
    const scan = () => {
      for (const k of Object.keys(window)) {
        if (!/^(mtopjsonp|jsonp)/i.test(k)) continue;
        const f = window[k];
        if (typeof f !== 'function' || wrapped.has(f)) continue;
        const w = function (data) {
          try { post('jsonp:' + k, JSON.stringify(data), 'jsonp'); } catch (_) {}
          return f.apply(this, arguments);
        };
        wrapped.add(w);
        try { window[k] = w; } catch (_) {}
      }
    };
    setInterval(scan, 150);
    // 응답이 아주 빨리 오는 경우를 대비해 mtopjsonpN 이름을 미리 선점: 대입되는 순간 함수를 감싼다
    for (let i = 1; i <= 400; i++) {
      const k = 'mtopjsonp' + i;
      let val;
      try {
        Object.defineProperty(window, k, {
          configurable: true, enumerable: true,
          get() { return val; },
          set(f) {
            if (typeof f === 'function' && !wrapped.has(f)) {
              const w = function (data) { try { post('jsonp:' + k, JSON.stringify(data), 'jsonp'); } catch (_) {} return f.apply(this, arguments); };
              wrapped.add(w); val = w;
            } else val = f;
          }
        });
      } catch (_) {}
    }
  } catch (_) {}

  // 페이지 전역 변수(SSR 초기 데이터)에 주문 정보가 있는지 탐색
  function scanGlobals() {
    try {
      const ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      (document.body || document.documentElement).appendChild(ifr);
      const base = new Set(Object.getOwnPropertyNames(ifr.contentWindow));
      ifr.remove();
      for (const k of Object.keys(window)) {
        if (base.has(k) || /^(aes|__aes|webpack|chrome|__)/i.test(k)) continue;
        let v;
        try { v = window[k]; } catch (_) { continue; }
        if (!v || typeof v !== 'object') continue;
        let s;
        try { s = JSON.stringify(v); } catch (_) { continue; }
        if (s && s.length > 200 && s.length < MAX && /orderId|order_id|orderLines|tradeOrder/i.test(s)) post('global:' + k, s, 'global');
      }
    } catch (_) {}
  }
  setTimeout(scanGlobals, 3000);
  setTimeout(scanGlobals, 9000);
})();
