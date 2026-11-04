// 알리 주문 통계 - 날짜·금액·상태 파싱, 텍스트 줄 파서
(function (g) {
  'use strict';
  const AES = g.AES || (g.AES = {});

  /* ------------------------------------------------------------------ *
   * 날짜 유틸
   * ------------------------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, '0');
  const DAY = 86400000;

  function toISO(d, withTime) {
    if (!d || isNaN(d)) return null;
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return withTime ? `${base}T${pad(d.getHours())}:${pad(d.getMinutes())}` : base;
  }
  function fromISO(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec';
  const MONNUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  /**
   * 문자열에서 날짜들을 찾아 등장 순서대로 반환.
   * opts.ref: 기준일(연도 없는 날짜 보정용), opts.prefer: 'future' | 'past'
   * 반환: [{ date: Date, hasTime: boolean }]
   */
  function parseDates(text, opts) {
    opts = opts || {};
    const ref = opts.ref || new Date();
    const prefer = opts.prefer || 'future';
    const t = String(text == null ? '' : text);
    const found = [];
    let m;

    const reISO = /(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/g;
    while ((m = reISO.exec(t))) found.push({ i: m.index, e: m.index + m[0].length, y: +m[1], mo: +m[2], d: +m[3], iso: true });

    const reKo = /(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = reKo.exec(t))) found.push({ i: m.index, e: m.index + m[0].length, y: m[1] ? +m[1] : 0, mo: +m[2], d: +m[3] });

    const reEn1 = new RegExp('\\b(' + MON + ')[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4})\\b)?', 'gi');
    while ((m = reEn1.exec(t))) found.push({ i: m.index, e: m.index + m[0].length, y: m[3] ? +m[3] : 0, mo: MONNUM[m[1].toLowerCase()], d: +m[2] });

    const reEn2 = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + MON + ')[a-z]*\\.?(?:\\s*,?\\s*(\\d{4})\\b)?', 'gi');
    while ((m = reEn2.exec(t))) found.push({ i: m.index, e: m.index + m[0].length, y: m[3] ? +m[3] : 0, mo: MONNUM[m[2].toLowerCase()], d: +m[1] });

    // 범위의 뒤쪽에 월이 생략된 경우: "11월 8일 - 14일", "Nov 8 - 14"
    for (const f of found.slice()) {
      if (f.iso) continue;
      const rest = t.slice(f.e);
      const r = rest.match(/^\s*[-~–—]\s*(\d{1,2})(?:\s*일)?(?![\d:월]|\s*월)/);
      if (r && +r[1] >= f.d && +r[1] <= 31) found.push({ i: f.e + rest.indexOf(r[1]), e: f.e + r[0].length, y: f.y, mo: f.mo, d: +r[1] });
    }
    found.sort((a, b) => a.i - b.i);
    // 겹치는 매치 제거
    const uniq = [];
    for (const f of found) {
      if (uniq.length && f.i < uniq[uniq.length - 1].e) continue;
      uniq.push(f);
    }

    const out = [];
    let prev = null;
    for (const f of uniq) {
      if (f.mo < 1 || f.mo > 12 || f.d < 1 || f.d > 31) continue;
      let y = f.y;
      const noYear = !y;
      if (noYear) {
        y = ref.getFullYear();
        let d0 = new Date(y, f.mo - 1, f.d);
        if (prefer === 'future' && d0 < new Date(ref.getTime() - 60 * DAY)) y += 1;
        if (prefer === 'past' && d0 > new Date(ref.getTime() + 7 * DAY)) y -= 1;
      }
      let d = new Date(y, f.mo - 1, f.d);
      if (noYear && prev && d < prev.date) d = new Date(y + 1, f.mo - 1, f.d); // 12월 20일 ~ 1월 5일
      let hasTime = false;
      const tm = t.slice(f.e, f.e + 16).match(/^\s*,?\s*(?:at\s*|\s)?(\d{1,2}):(\d{2})/i);
      if (tm && +tm[1] < 24) { d.setHours(+tm[1], +tm[2]); hasTime = true; }
      const item = { date: d, hasTime };
      out.push(item);
      prev = item;
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 금액 유틸
   * ------------------------------------------------------------------ */
  function currencyOf(sym) {
    const s = String(sym || '').replace(/\s/g, '').toUpperCase();
    if (!s) return null;
    if (s === '₩' || s === 'KRW' || s === '원') return 'KRW';
    if (s === 'US$' || s === 'USD') return 'USD';
    if (s === '$') return 'USD';
    if (s === 'CA$') return 'CAD';
    if (s === 'A$') return 'AUD';
    if (s === '€' || s === 'EUR') return 'EUR';
    if (s === '£' || s === 'GBP') return 'GBP';
    if (s === 'CN¥' || s === 'CNY' || s === 'RMB') return 'CNY';
    if (s === '¥' || s === 'JPY') return 'JPY';
    return null;
  }

  function parseAmount(numStr, cur) {
    let s = String(numStr).replace(/[^\d.,-]/g, '').replace(/[.,]+$/, '');
    if (!s) return NaN;
    if (cur === 'KRW' || cur === 'JPY') return parseFloat(s.replace(/[.,]/g, ''));
    const hasDot = s.includes('.');
    const hasCom = s.includes(',');
    if (hasDot && hasCom) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasCom) {
      s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (hasDot && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    return parseFloat(s);
  }

  const MONEY_RE = /(US\s?\$|CA\s?\$|A\$|CN¥|[₩$€£¥]|\b(?:KRW|USD|EUR|GBP|JPY|CNY|RMB)\b)\s*(-?\d[\d.,]*)|(-?\d[\d.,]*)\s*(원|€|\b(?:KRW|USD|EUR|GBP)\b)/gi;

  function findMoney(text) {
    const out = [];
    const t = String(text == null ? '' : text);
    MONEY_RE.lastIndex = 0;
    let m;
    while ((m = MONEY_RE.exec(t))) {
      const cur = currencyOf(m[1] || m[4]);
      const amount = parseAmount(m[2] || m[3], cur);
      if (isFinite(amount)) out.push({ amount, currency: cur, index: m.index, raw: m[0] });
    }
    return out;
  }

  function parseMoney(v, defCur) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? { amount: v, currency: defCur || null } : null;
    if (typeof v === 'object') {
      for (const k of ['formattedPrice', 'formatted', 'formattedAmount', 'displayPrice', 'priceText', 'text', 'display']) {
        if (typeof v[k] === 'string') { const r = findMoney(v[k]); if (r.length) return { amount: r[0].amount, currency: r[0].currency || defCur || null }; }
      }
      const a = v.amount != null ? v.amount : (v.value != null ? v.value : (v.minAmount != null ? v.minAmount : v.price));
      const c = currencyOf(v.currency || v.currencyCode || v.cur) || defCur || null;
      if (typeof a === 'number' && isFinite(a)) return { amount: a, currency: c };
      if (typeof a === 'string' && /^[\d.,]+$/.test(a.trim())) return { amount: parseAmount(a, c), currency: c };
      return null;
    }
    const s = String(v);
    const r = findMoney(s);
    if (r.length) return { amount: r[0].amount, currency: r[0].currency || defCur || null };
    if (/^\s*[\d.,]+\s*$/.test(s)) { const a = parseAmount(s, defCur); return isFinite(a) ? { amount: a, currency: defCur || null } : null; }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 주문 상태 분류
   * ------------------------------------------------------------------ */
  const BUTTON_RE = /^(cancel( order)?|주문\s*취소|취소(하기)?|취소\s*요청|refund|환불(\s*(요청|신청))?|return|반품|confirm( received| receipt)?|구매\s*확정|수령\s*확인|track( order| package)?|배송\s*조회|review|리뷰(\s*작성)?|buy again|다시\s*구매|pay now|결제하기|지금\s*결제|delete|삭제|more|더\s*보기|order details?|주문\s*상세|상세\s*보기)$/i;

  function classifyStatus(text, fromKey) {
    const t = String(text || '').replace(/<[^>]*>/g, '').trim();
    if (!t || t.length > 60) return 'unknown';
    if (!fromKey && BUTTON_RE.test(t)) return 'unknown';
    if (/참여\s*완료|이벤트/.test(t)) return 'event';
    if (/cancel|closed|취소|已取消|已关闭|주문\s*종료/i.test(t)) return 'cancelled';
    if (/refund|환불|退款/i.test(t)) return 'refund';
    if (/awaiting payment|pending payment|unpaid|결제\s*대기|결제\s*필요|지불\s*대기|待付款/i.test(t)) return 'unpaid';
    if (/shipped|in transit|awaiting delivery|out for delivery|on the way|being delivered|delivering|배송\s*중|배송\s*출발|발송\s*(됨|완료)|운송\s*중|수령\s*대기|待收货|已发货|运输中/i.test(t)) return 'shipping';
    if (/^\s*처리\s*중\s*$|awaiting shipment|to be shipped|to ship|ready to ship|processing|preparing|배송\s*(준비|대기)|발송\s*(준비|대기|전)|출고|상품\s*준비|待发货|等待发货|备货/i.test(t)) return 'pending_ship';
    if (/\bdelivered\b|completed|finished|received|배송\s*완료|배달\s*완료|수령\s*완료|구매\s*확정\s*완료|완료|已完成|已签收|交易成功/i.test(t)) return 'delivered';
    return 'unknown';
  }

  const STATUS_LABEL = {
    event: '이벤트', unpaid: '결제 대기', pending_ship: '배송 전', shipping: '배송 중',
    delivered: '배송 완료', cancelled: '취소', refund: '환불', unknown: '알 수 없음'
  };

  /* ------------------------------------------------------------------ *
   * 텍스트 줄 단위 파서 (DOM 카드 / JSON 문자열 공용)
   * ------------------------------------------------------------------ */
  const DATE_LABEL = /(주문\s*(일|날짜|일자|시간)|Order\s*(date|time|placed)|Placed\s*on|Ordered\s*on)/i;
  const TOTAL_LABEL = /(주문\s*(총액|금액)|총\s*(결제|금액|주문)?\s*금?액?|합계|결제\s*금액|Order\s*total|Total|Paid|Amount)/i;
  const TOTAL_EXCLUDE = /(할인|discount|shipping|배송비|coupon|쿠폰|saved|절약)/i;
  const DISCOUNT_LABEL = /(할인|쿠폰|절약|절감|Discount|Coupon|Saved|Savings|You saved)/i;
  const DISCOUNT_EXCLUDE = /(보상|compensation|delay|지연|적립|cashback|캐시백|사용\s*가능|받기|available|이상\s*구매|이상\s*주문|spend|구매\s*시)/i;
  const ETA_LABEL = /(예상\s*(배송|도착|배달|수령)|배송\s*(예정|기간|일정)|도착\s*(예정|날짜|일)|배달\s*예정|수령\s*예정|Estimated|Expected|Delivery\s*(by|date|estimate|time)|Deliver(y)?\s*by|Arrives?|Arrival|Get\s*it\s*by)/i;
  const ETA_WEAK = /^\s*배송\s*[:：]\s*\S/;
  const ETA_EXCLUDE = /(protection|보호|confirm|확인|auto|자동|return|반품|refund|환불|expire|만료)/i;

  /** 중앙 서버 원격 설정으로 보강하는 라벨과 기능 플래그 (확장 재배포 없이 알리 문구 변경에 대응) */
  const EXTRA = { eta: [], protect: [], flags: {} };
  /** 알리의 보안 확인(캡차/punish) 응답 판별. 응답 문구나 data 일부를 문자열로 넘긴다 */
  const CAPTCHA_RE = /USER_VALIDATE|RGV587|PUNISH|X5SEC|NOCAPTCHA|CAPTCHA|SLIDE_|被挤爆|滑动|验证/i;
  const isCaptcha = (text) => CAPTCHA_RE.test(String(text || ''));

  /** 기본 중앙 서버 (설정 페이지에서 다른 주소로 바꿀 수 있다) */
  const DEFAULT_SERVER = 'https://social-credit.156048.xyz';
  function applyRemoteConfig(cfg) {
    const compile = (arr) => (Array.isArray(arr) ? arr : []).slice(0, 20).filter((x) => typeof x === 'string' && x.length <= 200)
      .map((x) => { try { return new RegExp(x, 'i'); } catch (_) { return null; } }).filter(Boolean);
    const p = (cfg && cfg.parser) || {};
    EXTRA.eta = compile(p.etaLabels);
    EXTRA.protect = compile(p.protectLabels);
    EXTRA.flags = (cfg && cfg.flags && typeof cfg.flags === 'object') ? cfg.flags : {};
    return EXTRA;
  }

  function pickEta(lines, ref, allowWeak) {
    const mk = (ds, text) => ({ start: toISO(ds[0].date, ds[0].hasTime), end: toISO(ds[ds.length - 1].date, ds[ds.length - 1].hasTime), text: String(text).slice(0, 80) });
    const joinedAt = (i) => (!/\d/.test(lines[i]) && lines[i + 1] ? lines[i] + ' ' + lines[i + 1] : lines[i]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 200 || !(ETA_LABEL.test(l) || EXTRA.eta.some((r) => r.test(l))) || ETA_EXCLUDE.test(l)) continue;
      const jl = joinedAt(i);
      const ds = parseDates(jl, { ref, prefer: 'future' });
      if (ds.length) return mk(ds, jl);
    }
    if (allowWeak) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.length > 120 || !ETA_WEAK.test(l) || ETA_EXCLUDE.test(l)) continue;
        const ds = parseDates(l, { ref, prefer: 'future' });
        if (ds.length) return mk(ds, l);
      }
    }
    return null;
  }

  /**
   * 구매자 보호 기간 종료일. "구매자 보호 기간 확인 11월 30일" 같은 날짜 또는
   * "자동 구매 확정까지 12일 3시간" 같은 남은 시간 → ISO
   */
  const PROTECT_LABEL = /(구매자\s*보호|보호\s*기간|buyer\s*protection|자동\s*(구매\s*)?(확정|확인|수령)|auto[-\s]*(confirm|complete)|confirm\s*(receipt|delivery|received)[^\n]{0,30}(within|before|by)|수령\s*확인[^\n]{0,20}(까지|이내|남)|확인\s*기한)/i;
  function pickProtection(lines, ref) {
    ref = ref || new Date();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.length > 200 || !(PROTECT_LABEL.test(l) || EXTRA.protect.some((r) => r.test(l)))) continue;
      const jl = !/\d/.test(l) && lines[i + 1] ? l + ' ' + lines[i + 1] : l;
      const ds = parseDates(jl, { ref, prefer: 'future' });
      if (ds.length) { const d = ds[ds.length - 1]; return toISO(d.date, d.hasTime); }
      const r = jl.match(/(\d{1,3})\s*(?:일|days?|d(?![a-z]))\s*(?:(\d{1,2})\s*(?:시간|hours?|h(?![a-z])))?/i);
      if (r) return toISO(new Date(ref.getTime() + (+r[1]) * DAY + (+(r[2] || 0)) * 3600000), true);
    }
    return null;
  }

  function parseLines(lines, opts) {
    opts = opts || {};
    const ref = opts.ref || new Date();
    const res = { date: null, status: 'unknown', statusText: '', total: null, discount: null, eta: null };
    const joined = (i) => {
      const l = lines[i];
      if (!/\d/.test(l) && lines[i + 1]) return l + ' ' + lines[i + 1];
      return l;
    };

    // 상태: 위에서부터 처음 분류되는 짧은 줄
    for (const l of lines) {
      if (l.length > 40) continue;
      const c = classifyStatus(l);
      if (c !== 'unknown') { res.status = c; res.statusText = l; break; }
    }

    let discSum = 0, discCur = null, discFound = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 160) continue;
      const jl = joined(i);

      // 주문일
      if (!res.date && DATE_LABEL.test(l)) {
        const d = parseDates(jl, { ref, prefer: 'past' })[0];
        if (d) res.date = toISO(d.date, d.hasTime);
      }

      // 할인
      if (DISCOUNT_LABEL.test(l) && !DISCOUNT_EXCLUDE.test(l)) {
        const mo = findMoney(jl);
        if (mo.length) { discSum += Math.abs(mo[0].amount); discCur = discCur || mo[0].currency; discFound = true; }
      }

      // 총액
      if (!res.total && TOTAL_LABEL.test(l) && !TOTAL_EXCLUDE.test(l)) {
        const mo = findMoney(jl);
        if (mo.length) res.total = { amount: mo[0].amount, currency: mo[0].currency };
      }
    }
    if (discFound && discSum > 0) res.discount = { amount: discSum, currency: discCur };
    res.eta = pickEta(lines, ref, false);
    res.protectEnd = pickProtection(lines, ref);

    // 주문일 라벨이 없으면 앞쪽 줄에서 첫 날짜 (ETA 줄 제외)
    if (!res.date && !opts.noDateFallback) {
      for (const l of lines.slice(0, 10)) {
        if (ETA_LABEL.test(l)) continue;
        const d = parseDates(l, { ref, prefer: 'past' })[0];
        if (d) { res.date = toISO(d.date, d.hasTime); break; }
      }
    }
    return res;
  }


  Object.assign(AES, { CAPTCHA_RE, isCaptcha, DEFAULT_SERVER, EXTRA, applyRemoteConfig, PROTECT_LABEL, pickProtection, pad, DAY, toISO, fromISO, MON, MONNUM, parseDates, currencyOf, parseAmount, MONEY_RE, findMoney, parseMoney, BUTTON_RE, classifyStatus, STATUS_LABEL, DATE_LABEL, TOTAL_LABEL, TOTAL_EXCLUDE, DISCOUNT_LABEL, DISCOUNT_EXCLUDE, ETA_LABEL, ETA_WEAK, ETA_EXCLUDE, pickEta, parseLines });
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
