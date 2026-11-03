// 알리익스프레스 주문 데이터 파서 / 통계 계산기
// - 브라우저(content script)와 Node(테스트) 양쪽에서 동작하도록 UMD 스타일로 작성
(function (global) {
  'use strict';

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

  function pickEta(lines, ref, allowWeak) {
    const mk = (ds, text) => ({ start: toISO(ds[0].date, ds[0].hasTime), end: toISO(ds[ds.length - 1].date, ds[ds.length - 1].hasTime), text: String(text).slice(0, 80) });
    const joinedAt = (i) => (!/\d/.test(lines[i]) && lines[i + 1] ? lines[i] + ' ' + lines[i + 1] : lines[i]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.length > 200 || !ETA_LABEL.test(l) || ETA_EXCLUDE.test(l)) continue;
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

  /* ------------------------------------------------------------------ *
   * DOM 스크래핑
   * ------------------------------------------------------------------ */
  const ORDER_ID_RE = /(?:주문\s*(?:ID|아이디|번호|넘버)|Order\s*(?:ID|No\.?|number|#)|订单号?)[\s:：#]*(\d{12,20})/i;
  const ITEM_HREF_RE = /\/(?:item|i)\/(?:[^/?#]*\/)?(\d{8,})/;

  function qtyFromText(t) {
    let m = t.match(/(?:수량|Qty|Quantity)\s*[:：]?\s*(\d{1,3})/i);
    if (m) return +m[1];
    m = t.match(/(?:^|\s)[x×X]\s?(\d{1,3})(?=\s|$)/);
    if (m) return +m[1];
    m = t.match(/(?:^|\s)(\d{1,3})\s*(?:개|pcs|pieces)(?=\s|$)/i);
    if (m) return +m[1];
    return 1;
  }

  function isStrike(el, win) {
    try {
      let n = el;
      for (let i = 0; i < 3 && n; i++, n = n.parentElement) {
        const tag = n.tagName;
        if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return true;
        const cs = win.getComputedStyle(n);
        if (cs && String(cs.textDecorationLine || cs.textDecoration).includes('line-through')) return true;
      }
    } catch (_) {}
    return false;
  }

  function scrapeDom(doc, opts) {
    opts = opts || {};
    const win = doc.defaultView || global;
    const ref = opts.ref || new Date();
    const ids = new Map();
    const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue;
      if (!t || t.length > 200) continue;
      if (!/\d{12}/.test(t) && !/주문|Order|订单/i.test(t)) continue;
      let el = n.parentElement;
      for (let lv = 0; lv < 3 && el; lv++, el = el.parentElement) {
        const txt = (el.textContent || '').trim();
        if (txt.length > 150) break;
        const m = txt.match(ORDER_ID_RE) || (lv === 0 ? txt.match(/^(1123\d{12}|8\d{15})$/) : null);
        if (m) { if (!ids.has(m[1])) ids.set(m[1], el); break; }
      }
    }
    const allIds = [...ids.keys()];
    const orders = [];
    const cards = [];

    for (const [id, el] of ids) {
      // 카드 = 다른 주문 ID 를 포함하지 않는 가장 큰 조상
      let best = el, cur = el;
      for (let depth = 0; depth < 15 && cur.parentElement; depth++) {
        const p = cur.parentElement;
        if (p === doc.body || p === doc.documentElement) break;
        const txt = p.textContent || '';
        let other = false;
        for (const oid of allIds) if (oid !== id && txt.includes(oid)) { other = true; break; }
        if (other) break;
        best = p; cur = p;
      }
      const card = best;
      const text = card.innerText || card.textContent || '';
      const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const info = parseLines(lines, { ref });

      // 상품
      const anchors = [...card.querySelectorAll('a[href]')].filter((a) => ITEM_HREF_RE.test(a.getAttribute('href') || ''));
      const byItem = new Map();
      for (const a of anchors) {
        const iid = a.getAttribute('href').match(ITEM_HREF_RE)[1];
        if (!byItem.has(iid)) byItem.set(iid, []);
        byItem.get(iid).push(a);
      }
      const items = [];
      for (const [iid, as] of byItem) {
        // 해당 상품만 포함하는 가장 큰 컨테이너
        let box = as[0].parentElement || card;
        while (box !== card && box.parentElement) {
          const up = box.parentElement;
          const hasOther = [...byItem.keys()].some((k) => k !== iid && up.querySelector(`a[href*="${k}"]`));
          if (hasOther) break;
          box = up;
        }
        const bl = (box.innerText || '').split(/\n+/).map((s) => s.trim()).filter(Boolean);
        let title = '';
        for (const a of as) {
          const cand = (a.getAttribute('title') || a.innerText || (a.querySelector('img') || {}).alt || '').trim();
          if (cand.length > title.length && !findMoney(cand).length) title = cand;
        }
        if (!title) title = bl.filter((l) => l.length > 8 && !findMoney(l).length)[0] || '';
        // 가격: 취소선 = 정가
        let price = null, orig = null;
        const leafs = [...box.querySelectorAll('*')].filter((e) => !e.children.length && e.textContent && findMoney(e.textContent).length).slice(0, 12);
        for (const e of leafs) {
          const mo = findMoney(e.textContent)[0];
          if (isStrike(e, win)) { if (!orig) orig = { amount: mo.amount, currency: mo.currency }; }
          else if (!price) price = { amount: mo.amount, currency: mo.currency };
        }
        if (!price) { const mo = findMoney(bl.join(' '))[0]; if (mo) price = { amount: mo.amount, currency: mo.currency }; }
        const img = box.querySelector('img');
        let image = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
        if (image.startsWith('//')) image = 'https:' + image;
        items.push({
          id: iid, title, qty: qtyFromText(bl.join('  ')),
          price, orig: orig && price && orig.amount > price.amount ? orig : null,
          image: /^https?:/.test(image) ? image : '', url: `https://www.aliexpress.com/item/${iid}.html`
        });
      }

      orders.push({
        id, date: info.date, statusText: info.statusText, status: info.status,
        total: info.total, discount: info.discount, eta: info.eta, items,
        refund: (info.status === 'cancelled' || info.status === 'refund') ? refundFromLines(lines) : null,
        raw: lines.slice(0, 40).join(' | ').slice(0, 1500), source: 'dom'
      });
      cards.push({ id, lines: lines.slice(0, 60) });
    }
    return { orders, cards };
  }

  /* ------------------------------------------------------------------ *
   * JSON(API 응답) 추출
   * ------------------------------------------------------------------ */
  const ID_KEYS = ['orderId', 'tradeOrderId', 'mainOrderId', 'bizOrderId', 'orderNo', 'tradeId', 'order_id'];
  const isId = (v) => (typeof v === 'string' || typeof v === 'number') && /^\d{12,20}$/.test(String(v));
  const firstOf = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return null; };

  function itemFromObject(o) {
    let title = firstOf(o, ['itemTitle', 'productTitle', 'productName', 'itemName', 'subject', 'title']);
    if (typeof title !== 'string' || title.trim().length < 3) return null;
    const idv = firstOf(o, ['itemId', 'productId', 'itemID', 'item_id']);
    const image = firstOf(o, ['itemImgUrl', 'itemImageUrl', 'imageUrl', 'imgUrl', 'productImage', 'itemImage', 'image']);
    const priceRaw = firstOf(o, ['itemPrice', 'price', 'productPrice', 'unitPrice', 'itemPriceText', 'priceText']);
    if (!idv && !image && priceRaw == null) return null;
    if (!idv && !image) return null; // 'title' 만 있는 일반 노드 제외
    const origRaw = firstOf(o, ['originalPrice', 'originPrice', 'itemOriginalPrice', 'originalPriceText']);
    const qtyRaw = firstOf(o, ['quantity', 'itemCount', 'buyNum', 'count', 'productCount', 'itemQuantity']);
    let qty = 1;
    if (qtyRaw != null) { const q = parseInt(String(qtyRaw).replace(/[^\d]/g, ''), 10); if (q > 0 && q < 1000) qty = q; }
    const price = parseMoney(priceRaw);
    const orig = parseMoney(origRaw);
    let img = typeof image === 'string' ? image : '';
    if (img.startsWith('//')) img = 'https:' + img;
    const lineId = firstOf(o, ['orderLineId', 'skuId', 'subOrderId']);
    return {
      id: idv ? String(idv) : '', lineId: lineId ? String(lineId) : '', title: title.trim(), qty,
      price, orig: orig && price && orig.amount > price.amount ? orig : null,
      image: /^https?:/.test(img) ? img : '',
      url: idv ? `https://www.aliexpress.com/item/${idv}.html` : ''
    };
  }

  const KEY_DATE = /^(orderDateText|orderDate|orderTime|orderCreateTime|gmtCreate|gmtCreateTime|createTime|createDate|gmtPayTime|payTime)$/i;
  const KEY_STATUS = /^(statusText|orderStatusText|orderStatusDesc|statusDesc|statusName|orderStatus|status|tradeStatus|fulfillStatus|logisticsStatusText|logisticStatus)$/i;
  const KEY_TOTAL = /(totalPrice|totalAmount|orderAmount|orderTotal|payAmount|actualPay|paidAmount|orderPrice|payPrice)/i;
  const KEY_TOTAL_EXCL = /(item|shipping|freight|text.*rate)/i;
  const KEY_DISC = /(discount|saved|saving|coupon|promotion|reduce)(Amount|Price|Text|Fee)?$/i;
  const KEY_DISC_EXCL = /(rate|percent|type|id|name|desc|code|tag|label|title)/i;
  const KEY_ETA = /((estimat|expect|arriv|deliver).*(time|date|text|day))|((time|date|text).*(estimat|expect|arriv))/i;

  function epochToDate(v) {
    const n = Number(v);
    if (!isFinite(n)) return null;
    if (n > 1e12 && n < 4e12) return new Date(n);
    if (n > 1e9 && n < 4e9) return new Date(n * 1000);
    return null;
  }

  const stripHtml = (v) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : v);

  function subtreeStrings(node, out, depth) {
    if (node == null || depth > 7 || out.length > 200) return out;
    if (typeof node === 'string') { const t = stripHtml(node); if (t && t.length < 200) out.push(t); }
    else if (typeof node === 'object') for (const k of Object.keys(node)) subtreeStrings(node[k], out, depth + 1);
    return out;
  }

  /**
   * 환불 상태 판별. title: "환불 처리"(진행 중) / "환불 완료", content: 안내문, extendContent: "환불 금액: US $39.67"
   */
  function refundState(title, content) {
    const t = String(title || ''), c = String(content || '');
    if (/환불\s*완료|환불\s*성공|refund(ed)?\s*(complete|success)/i.test(t)) return 'done';
    if (/환불\s*(처리|중|진행)|refund.*(process|progress|pending)/i.test(t)) return 'processing';
    if (/환불되었|환불이\s*완료|has been refunded|refund(ed)?\s*(has been\s*)?(completed|issued)/i.test(c)) return 'done';
    if (/환불.*(처리\s*중|예상됩니다|진행)|refund.*(in progress|processing|expected)/i.test(c)) return 'processing';
    return 'unknown';
  }
  function refundFromObject(o) {
    const t = stripHtml(o.title);
    if (typeof t !== 'string' || !/환불|refund/i.test(t)) return null;
    if (/^(예상\s*)?환불\s*금액|^refund\s*amount/i.test(t)) return null;   // 금액만 표시하는 항목은 상태 항목이 아님
    const content = stripHtml(o.content) || '', ext = stripHtml(o.extendContent) || '';
    if (!content && !ext) return null;
    // 알리가 표시한 환불 금액: extendContent("환불 금액: US $39.67") 우선, 없으면 안내문에 "환불 금액"이 있을 때
    let m = findMoney(ext)[0] || null;
    if (!m && /환불\s*금액|refund\s*amount/i.test(content)) m = findMoney(content)[0] || null;
    return { state: refundState(t, content), title: t.slice(0, 40), text: content.slice(0, 200), amount: m ? { amount: m.amount, currency: m.currency } : null };
  }
  /** "환불 금액" 만 따로 표시하는 항목 ({title:'환불 금액', content:'US $39.67'} 등) */
  function refundAmountFromObject(o) {
    const t = stripHtml(o.title);
    if (typeof t !== 'string' || !/^(예상\s*)?환불\s*금액|^refund\s*amount/i.test(t)) return null;
    const m = findMoney(stripHtml(o.content) || '')[0] || findMoney(stripHtml(o.extendContent) || '')[0] || findMoney(t)[0] || null;
    return m ? { amount: m.amount, currency: m.currency } : null;
  }

  /** 텍스트 줄(DOM 카드)에서 환불 상태 추정 */
  function refundFromLines(lines) {
    let state = null, text = '', amount = null;
    for (const l of lines) {
      if (l.length > 160) { if (/환불|refund/i.test(l) && !text) text = l.slice(0, 200); continue; }
      if (/^환불\s*완료$|^refund(ed)?\s*(complete|success)/i.test(l)) state = 'done';
      else if (/^환불\s*(처리|중|진행)/.test(l) && !state) state = 'processing';
      if (/환불\s*금액|refund\s*amount/i.test(l)) { const m = findMoney(l)[0]; if (m) amount = { amount: m.amount, currency: m.currency }; }
    }
    if (!state && text) { const st = refundState('', text); if (st !== 'unknown') state = st; }
    return state ? { state, title: state === 'done' ? '환불 완료' : '환불 처리', text, amount } : null;
  }

  /** 별도 항목으로 표시된 환불 금액을 환불 정보에 합친다 */
  function finishRefund(rf, amountOnly, status) {
    if (rf && !rf.amount && amountOnly) return { ...rf, amount: amountOnly };
    if (!rf && amountOnly && (status === 'cancelled' || status === 'refund')) return { state: 'unknown', title: '환불', text: '', amount: amountOnly };
    return rf;
  }

  /** 주문 목록 응답의 페이지 정보 (hasMore / pageIndex) */
  function findListMeta(root) {
    let meta = null;
    (function walk(n, d) {
      if (!n || typeof n !== 'object' || d > 12 || meta) return;
      if (!Array.isArray(n) && 'hasMore' in n && ('pageIndex' in n || 'pageSize' in n)) {
        meta = { hasMore: n.hasMore === true || n.hasMore === 'true', pageIndex: +n.pageIndex || 0, pageSize: +n.pageSize || 0, moreText: typeof n.hasMoreText === 'string' ? n.hasMoreText : '' };
        return;
      }
      for (const k of Object.keys(n)) walk(n[k], d + 1);
    })(root, 0);
    return meta;
  }

  function extractFromJson(root, opts) {
    opts = opts || {};
    const ref = opts.ref || new Date();
    const bags = new Map();
    const bag = (id) => { if (!bags.has(id)) bags.set(id, { leaves: [], items: [], refund: null, refundAmount: null }); return bags.get(id); };

    function walk(node, ctx, key, depth) {
      if (depth > 40 || node == null) return;
      if (typeof node !== 'object') { if (ctx) bag(ctx).leaves.push([key, node]); return; }
      let c = ctx;
      if (key && /order/i.test(String(key))) { const m = String(key).match(/(\d{12,20})/); if (m) c = m[1]; }
      if (!Array.isArray(node)) {
        for (const k of ID_KEYS) if (isId(node[k])) { c = String(node[k]); break; }
        if (c) {
          const rf = refundFromObject(node); if (rf && !(bag(c).refund && bag(c).refund.state !== 'unknown' && rf.state === 'unknown')) bag(c).refund = rf;
          const ra = refundAmountFromObject(node); if (ra) bag(c).refundAmount = ra;
        }
        if (c) {
          const it = itemFromObject(node);
          if (it) { const e = pickEta(subtreeStrings(node, [], 0), ref, true); if (e) it.eta = e; bag(c).items.push(it); }
        }
      }
      for (const k of Object.keys(node)) walk(node[k], c, Array.isArray(node) ? key : k, depth + 1);
    }
    walk(root, null, null, 0);

    const orders = [];
    for (const [id, b] of bags) {
      // 상품 중복 제거
      const seen = new Map();
      for (const it of b.items) { const k = it.lineId || it.id || it.title.slice(0, 30); if (!seen.has(k)) seen.set(k, it); }
      const items = [...seen.values()];

      const strLeaves = b.leaves.filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, stripHtml(v)]).filter(([, v]) => v && v.length < 200);
      const lines = strLeaves.map(([, v]) => v);
      const info = parseLines(lines, { ref, noDateFallback: true });   // API 응답에서는 문장 속 날짜를 주문일로 추측하지 않음

      // 키 기반 보강
      let date = info.date, status = info.status, statusText = info.statusText, total = info.total, discount = info.discount, eta = info.eta;
      let discSum = 0, discCur = null, discFound = false;
      const statusCands = [];
      for (const [k, v] of b.leaves) {
        if (!k) continue;
        if (KEY_DATE.test(k)) {
          let d = null, ht = true;
          if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) d = epochToDate(v);
          else { const p = parseDates(v, { ref, prefer: 'past' })[0]; if (p) { d = p.date; ht = p.hasTime; } }
          if (d) date = toISO(d, ht);
        } else if (KEY_STATUS.test(k) && typeof v === 'string') {
          statusCands.push(v);
        } else if (KEY_TOTAL.test(k) && !KEY_TOTAL_EXCL.test(k) && !total) {
          const m = parseMoney(v); if (m) total = m;
        } else if (KEY_DISC.test(k) && !KEY_DISC_EXCL.test(k)) {
          const m = parseMoney(v); if (m && m.amount) { discSum += Math.abs(m.amount); discCur = discCur || m.currency; discFound = true; }
        } else if (KEY_ETA.test(k) && !eta && !/(deliveredTime|deliveryTime.*actual)/i.test(k)) {
          let ds = [];
          if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) { const d = epochToDate(v); if (d) ds = [{ date: d, hasTime: true }]; }
          else if (typeof v === 'string') ds = parseDates(v, { ref, prefer: 'future' });
          if (ds.length) eta = { start: toISO(ds[0].date, ds[0].hasTime), end: toISO(ds[ds.length - 1].date, ds[ds.length - 1].hasTime), text: String(v).slice(0, 80) };
        }
      }
      for (const s of statusCands) { const c = classifyStatus(s, true); if (c !== 'unknown') { status = c; statusText = s; break; } }
      if (!discount && discFound && discSum > 0) discount = { amount: discSum, currency: discCur };

      if (!eta) eta = pickEta(lines, ref, true);
      if (!items.length && !date && status === 'unknown') continue;
      orders.push({
        id, date, statusText, status, total, discount, eta, items,
        refund: finishRefund(b.refund || ((status === 'cancelled' || status === 'refund') ? refundFromLines(lines) : null), b.refundAmount, status),
        raw: '', source: 'api'
      });
    }
    return orders;
  }

  /**
   * 주문 상세 페이지에서 예상 배송일 추출.
   * lines: 화면 텍스트 줄들, captures: [{url, text}] API 응답들
   */
  function extractDetail(orderId, lines, captures, opts) {
    const ref = (opts && opts.ref) || new Date();
    let eta = pickEta(lines, ref, false);
    let etaSrc = eta ? 'dom' : null;
    let items = [];
    let apiLines = [];
    for (const c of captures || []) {
      const json = parseResponseText(c.text);
      if (!json) continue;
      apiLines = apiLines.concat(subtreeStrings(json, [], 0));
      try {
        const os = extractFromJson(json, { ref });
        const o = os.find((x) => x.id === String(orderId)) || null;
        if (o) {
          if (!eta && o.eta) { eta = o.eta; etaSrc = 'api'; }
          for (const it of o.items) if (it.eta) items.push({ id: it.id, eta: it.eta });
        }
      } catch (_) {}
    }
    if (!eta) { const e = pickEta(apiLines, ref, true); if (e) { eta = e; etaSrc = 'api'; } }
    return { eta, etaSrc, items, rawLines: lines.slice(0, 120), apiLines: apiLines.slice(0, 150) };
  }

  /** fetch 응답 텍스트(JSON / JSONP) → 객체 */
  function parseResponseText(text) {
    if (typeof text !== 'string') return null;
    const s = text.trim();
    try { return JSON.parse(s); } catch (_) { /* JSONP 시도 */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) {} }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 병합
   * ------------------------------------------------------------------ */
  const itemKey = (it) => it.lineId || it.id || (it.title || '').slice(0, 24).toLowerCase();

  function mergeItems(a, b) {
    const list = a.map((it) => ({ ...it }));
    for (const it of b) {
      let targets = list.filter((o) => itemKey(o) === itemKey(it));
      if (!targets.length && !it.lineId && it.id) targets = list.filter((o) => o.id === it.id); // 옵션 구분 없는 정보는 같은 상품 전체에 적용
      if (!targets.length) { if (it.title) list.push({ ...it }); continue; }
      for (const old of targets) {
        for (const f of ['title', 'price', 'orig', 'image', 'url', 'id', 'lineId', 'eta']) if (it[f] && (!old[f] || f === 'price' || f === 'orig' || f === 'eta')) old[f] = it[f];
        if (it.qty && it.qty > 1 && targets.length === 1) old.qty = it.qty;
      }
    }
    return list;
  }

  /**
   * 병합 규칙
   * - API(source 'api')가 화면(DOM) 값보다 우선 (상태/금액/날짜)
   * - 예상 배송일은 상세 페이지(etaSrc 'detail')에서 온 값이 최우선
   */
  function mergeOrder(a, b) {
    if (!a) return { ...b, updated: Date.now() };
    const out = { ...a };
    const keepA = b.source === 'dom' && a.source && a.source !== 'dom'; // DOM 이 API 값을 덮어쓰지 않도록
    for (const k of ['date', 'total', 'discount', 'statusText']) if (b[k] && !(keepA && a[k])) out[k] = b[k];
    if (b.status && b.status !== 'unknown' && !(keepA && a.status && a.status !== 'unknown')) out.status = b.status;
    if (b.eta && !(a.eta && a.etaSrc === 'detail' && b.etaSrc !== 'detail')) { out.eta = b.eta; out.etaSrc = b.etaSrc || (b.source === 'detail' ? 'detail' : b.source); }
    if (b.refund && !(keepA && a.refund)) out.refund = b.refund;
    if (b.detailAt) { out.detailAt = b.detailAt; out.detailRaw = b.detailRaw || out.detailRaw; }
    out.items = keepA && (a.items || []).length ? a.items : mergeItems(a.items || [], b.items || []);
    out.raw = b.raw || a.raw;
    out.source = a.source === b.source ? a.source : (a.source === 'api' || b.source === 'api' ? 'api' : 'both');
    out.updated = Date.now();
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 카테고리 분류 / 키워드
   * ------------------------------------------------------------------ */
  const CATEGORIES = [
    ['휴대폰·충전·오디오', /phone|iphone|galaxy|samsung|xiaomi|케이스|휴대폰|스마트폰|충전|charger|charging|cable|케이블|\busb\b|type-?c|lightning|magsafe|screen protector|강화유리|필름|earphone|이어폰|earbud|헤드폰|headphone|airpods|power ?bank|보조배터리|\btws\b|bluetooth|블루투스/i],
    ['컴퓨터·IT·전자부품', /keyboard|키보드|mouse|마우스|\bssd\b|laptop|노트북|hdmi|adapter|어댑터|monitor|모니터|raspberry|arduino|esp32|esp8266|\bsensor\b|센서|module|모듈|\bpcb\b|resistor|capacitor|\bchip\b|webcam|웹캠|router|\bhub\b|\bnas\b|\bram\b|usb ?드라이브|메모리|sd ?card|micro ?sd|flash drive|3d ?print|필라멘트|filament/i],
    ['가전·조명·스마트기기', /\bled\b|light|lamp|조명|램프|전구|camera|카메라|projector|프로젝터|speaker|스피커|smart|스마트|watch band|스마트워치|smartwatch|drone|드론|battery|배터리|\bfan\b|선풍기|heater|히터|humidifier|가습기|vacuum|청소기|\brobot\b|\bremote\b|리모컨|\bwifi\b/i],
    ['패션의류', /shirt|t-shirt|tee\b|dress|jacket|pants|trousers|jeans|티셔츠|셔츠|바지|원피스|자켓|재킷|후드|hoodie|sweater|스웨터|cardigan|가디건|socks|양말|속옷|underwear|bra\b|coat|코트|패딩|청바지|skirt|치마|leggings|레깅스|pajama|잠옷|옷|의류|clothing|clothes/i],
    ['신발·가방', /shoes?\b|sneakers?|신발|운동화|슬리퍼|slippers?|sandals?|샌들|boots?\b|부츠|\bbag\b|backpack|가방|백팩|wallet|지갑|크로스백|handbag|핸드백|파우치|pouch|luggage|캐리어/i],
    ['액세서리·주얼리', /\bring\b|반지|necklace|목걸이|bracelet|팔찌|earrings?|귀걸이|jewelry|jewellery|주얼리|\bwatch\b|시계|sunglasses|선글라스|\bhat\b|\bcap\b|모자|\bbelt\b|벨트|scarf|스카프|머플러|gloves?|장갑|brooch|브로치|keychain|키링|pendant|펜던트/i],
    ['뷰티·건강', /makeup|make-up|화장품|cream|크림|lipstick|립|\bnail\b|네일|brush|브러시|massage|마사지|\bhair\b|헤어|skin|스킨|마스크팩|shaver|면도|trimmer|트리머|perfume|향수|serum|세럼|eyelash|속눈썹|vitamin|비타민|toothbrush|칫솔|beauty|뷰티/i],
    ['홈·주방·생활', /kitchen|주방|storage|수납|organizer|정리|towel|수건|bedding|침구|curtain|커튼|\bcup\b|컵|bottle|텀블러|\bpan\b|냄비|knife|칼|청소|cleaning|bathroom|욕실|거치대|holder|\bhook\b|후크|hanger|행거|shelf|선반|container|용기|mat\b|매트|rug|러그|pillow|베개|basket|바구니|home|가정|생활|storage box|tape measure/i],
    ['공구·DIY·자동차', /\btools?\b|공구|drill|드릴|screw|나사|\bcar\b|자동차|차량|\bauto\b|\bbike\b|자전거|motorcycle|오토바이|wrench|렌치|repair|수리|solder|납땜|headlight|bolt|볼트|\bnut\b|너트|plier|플라이어|screwdriver|드라이버|glue|접착|welding|용접|multimeter|멀티미터|dash ?cam|블랙박스/i],
    ['스포츠·아웃도어', /sports?\b|스포츠|운동|fitness|피트니스|yoga|요가|camping|캠핑|fishing|낚시|outdoor|아웃도어|등산|hiking|running|러닝|cycling|사이클|golf|골프|tent|텐트|swim|수영|dumbbell|덤벨|badminton|배드민턴|tennis|테니스/i],
    ['완구·취미', /\btoy\b|toys|장난감|lego|레고|figure|피규어|puzzle|퍼즐|\bgame\b|게임|\brc\b|model|모형|craft|취미|인형|doll|plush|diy kit|diamond painting|보석십자수|magnet|자석|building block|블록/i],
    ['반려동물', /\bpet\b|\bdog\b|\bcat\b|강아지|고양이|반려|puppy|kitten/i],
    ['문구·사무', /\bpen\b|\b펜\b|notebook|노트|stationery|문구|sticker|스티커|paper|종이|\btape\b|테이프|label|라벨|marker|마커|planner|플래너|stamp|스탬프/i],
    ['유아·아동', /baby|아기|유아|\bkids?\b|아동|어린이|toddler|children/i]
  ];

  function categorize(title) {
    const t = String(title || '');
    for (const [name, re] of CATEGORIES) if (re.test(t)) return name;
    return '기타';
  }

  const STOP = new Set(('for with and the new hot sale pcs pc set high quality free shipping from style fashion women men woman man mini large small size color colour universal portable original official upgrade upgraded model type best premium super lot pack piece pieces unit units one two three each ' +
    '및 용 신상 새로운 인기 판매 무료 배송 세트 개 고품질 정품 공식 남성 여성 남자 여자 미니 대형 소형 휴대용 범용 업그레이드 스타일 패션 다양한').split(/\s+/));

  function topKeywords(titles, limit) {
    const cnt = new Map();
    for (const { title, qty } of titles) {
      const toks = new Set(String(title || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2 && !/^\d+$/.test(w) && !STOP.has(w)));
      for (const w of toks) cnt.set(w, (cnt.get(w) || 0) + (qty || 1));
    }
    return [...cnt.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit || 20).map(([word, count]) => ({ word, count }));
  }

  /* ------------------------------------------------------------------ *
   * 통계 계산
   * ------------------------------------------------------------------ */
  const addTo = (obj, cur, amt) => { if (!isFinite(amt)) return; obj[cur] = (obj[cur] || 0) + amt; };
  const normTitle = (t) => String(t || '').toLowerCase().replace(/\s+/g, '').slice(0, 40);
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

  function primaryCurrency(orders) {
    const c = {};
    for (const o of orders) {
      if (o.total && o.total.currency) c[o.total.currency] = (c[o.total.currency] || 0) + 1;
      for (const it of o.items || []) if (it.price && it.price.currency) c[it.price.currency] = (c[it.price.currency] || 0) + 1;
    }
    const e = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return e.length ? e[0][0] : null;
  }

  /** 같은 상품이 서로 다른 통화로 기록된 경우 환율 추정 (다른통화 1단위 = primary 얼마) */
  function estimateRates(ordersMap, primary) {
    const byTitle = new Map();
    for (const o of Object.values(ordersMap || {})) {
      for (const it of o.items || []) {
        if (!it.price || !it.price.currency || !(it.price.amount > 0)) continue;
        const k = normTitle(it.title);
        if (!byTitle.has(k)) byTitle.set(k, {});
        const m = byTitle.get(k);
        (m[it.price.currency] = m[it.price.currency] || []).push(it.price.amount / 1);
      }
    }
    const ratios = {};
    for (const m of byTitle.values()) {
      if (!m[primary]) continue;
      for (const cur of Object.keys(m)) {
        if (cur === primary) continue;
        (ratios[cur] = ratios[cur] || []).push(median(m[primary]) / median(m[cur]));
      }
    }
    const out = {};
    for (const cur of Object.keys(ratios)) out[cur] = median(ratios[cur]);
    return out;
  }

  function computeStats(ordersMap, opts) {
    opts = opts || {};
    const now = opts.now || new Date();
    let all = Object.values(ordersMap || {}).map((o) => ({ ...o, cls: o.status && o.status !== 'unknown' ? o.status : classifyStatus(o.statusText) }));
    // 조회 기간 필터: 기간 밖이어도 배송 중·환불 진행 중인 주문은 항상 포함
    if (opts.since) all = all.filter((o) => !o.date || String(o.date).slice(0, 10) >= opts.since || o.cls === 'pending_ship' || o.cls === 'shipping' || (o.refund && o.refund.state === 'processing'));
    const primary = opts.currency || primaryCurrency(all) || 'KRW';
    const est = estimateRates(ordersMap, primary);
    const rates = { ...est, ...(opts.rates || {}) };
    Object.keys(rates).forEach((k) => { if (!(rates[k] > 0)) delete rates[k]; });
    // 환율을 아는 통화는 primary 로 환산, 모르면 그대로 둠
    const conv = (m) => {
      if (!m) return null;
      const c = m.currency || primary;
      if (c === primary) return { amount: m.amount, currency: primary };
      if (rates[c]) return { amount: m.amount * rates[c], currency: primary };
      return { amount: m.amount, currency: c };
    };

    const statusOrders = { unpaid: 0, pending_ship: 0, shipping: 0, delivered: 0, cancelled: 0, refund: 0, event: 0, unknown: 0 };
    const statusItems = { ...statusOrders };
    for (const o of all) {
      statusOrders[o.cls] = (statusOrders[o.cls] || 0) + 1;
      const q = (o.items || []).reduce((s, it) => s + (it.qty || 1), 0) || 1;
      statusItems[o.cls] = (statusItems[o.cls] || 0) + q;
    }

    const valid = all.filter((o) => !['cancelled', 'unpaid', 'refund', 'event'].includes(o.cls));
    const spent = {}, discount = {};
    let itemCount = 0, discountOrders = 0, primaryOrders = 0;
    const catMap = new Map(), purchases = [], titles = [], monthly = new Map();

    for (const o of valid) {
      const qtyOrder = (o.items || []).reduce((s, it) => s + (it.qty || 1), 0);
      itemCount += qtyOrder || 1;

      // 상품 금액 합 (할인 전 표시가)
      let itemSum = 0, itemCur = null;
      for (const it of o.items || []) if (it.price) { itemSum += it.price.amount * (it.qty || 1); itemCur = itemCur || (it.price.currency || primary); }
      const totalRaw = o.total || (itemSum ? { amount: itemSum, currency: itemCur } : null);
      const total = conv(totalRaw);
      if (total) {
        addTo(spent, total.currency, total.amount);
        if (total.currency === primary) primaryOrders++;
        if (total.currency === primary && o.date) {
          const mk = String(o.date).slice(0, 7);
          const mm = monthly.get(mk) || { month: mk, spend: 0, orders: 0 };
          mm.spend += total.amount; mm.orders += 1; monthly.set(mk, mm);
        }
      }

      // 할인액: 명시값 > (상품 표시가 합 - 실결제액) > 정가 대비 차이
      let dsum = 0, dcur = null;
      if (o.discount && o.discount.amount > 0) { const d = conv(o.discount); dsum = d.amount; dcur = d.currency; }
      else if (o.total && itemSum > 0 && (o.total.currency || primary) === (itemCur || primary) && itemSum > o.total.amount + 0.001) {
        const d = conv({ amount: itemSum - o.total.amount, currency: itemCur || primary }); dsum = d.amount; dcur = d.currency;
      } else {
        for (const it of o.items || []) if (it.orig && it.price) { const d = conv({ amount: (it.orig.amount - it.price.amount) * (it.qty || 1), currency: it.price.currency }); dsum += d.amount; dcur = dcur || d.currency; }
      }
      if (dsum > 0) { addTo(discount, dcur, dsum); discountOrders++; }

      for (const it of o.items || []) {
        const cat = categorize(it.title);
        const qty = it.qty || 1;
        const pc = conv(it.price);
        const c = catMap.get(cat) || { name: cat, count: 0, spend: 0 };
        c.count += qty;
        if (pc && pc.currency === primary) c.spend += pc.amount * qty;
        catMap.set(cat, c);
        titles.push({ title: it.title, qty });
        purchases.push({
          orderId: o.id, date: o.date, title: it.title, qty, price: it.price, category: cat,
          status: o.cls, image: it.image, url: it.url
        });
      }
    }

    // 진행 중 배송: 예상 도착일은 주문 상세 페이지의 값만 사용 (추정하지 않음)
    const inProgress = [];
    for (const o of all) {
      if (o.cls !== 'pending_ship' && o.cls !== 'shipping') continue;
      const items = o.items && o.items.length ? o.items : [{ title: '(상품명 확인 불가)', qty: 1 }];
      for (const it of items) {
        const e = it.eta || o.eta;
        const start = e ? fromISO(e.start) : null;
        const end = e ? fromISO(e.end) : null;
        const daysLeft = end ? Math.ceil((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY) : null;
        inProgress.push({
          orderId: o.id, title: it.title, qty: it.qty || 1, image: it.image || '', url: it.url || '',
          status: o.cls, statusText: o.statusText, orderDate: o.date,
          etaStart: e ? e.start : null, etaEnd: e ? e.end : null, etaFromDetail: !!(o.etaSrc === 'detail' || it.eta),
          detailTried: !!o.detailAt, daysLeft, _s: start
        });
      }
    }
    inProgress.sort((a, b) => ((a.etaEnd || '9999') < (b.etaEnd || '9999') ? -1 : (a.etaEnd || '9999') > (b.etaEnd || '9999') ? 1 : 0));
    inProgress.forEach((r) => delete r._s);

    // 배송 완료된 주문 (조회 기간 안의 주문)
    const delivered = [];
    for (const o of all) {
      if (o.cls !== 'delivered') continue;
      const items = o.items && o.items.length ? o.items : [{ title: '(상품명 확인 불가)', qty: 1 }];
      for (const it of items) delivered.push({ orderId: o.id, title: it.title, qty: it.qty || 1, image: it.image || '', url: it.url || '', status: 'delivered', orderDate: o.date });
    }
    delivered.sort((a, b) => ((b.orderDate || '') > (a.orderDate || '') ? 1 : (b.orderDate || '') < (a.orderDate || '') ? -1 : 0));

    // 취소·환불 주문: 환불 진행 중 / 완료 / 정보 없음(결제 전 취소 등)
    const refunds = [];
    const refundSum = { processing: {}, done: {}, none: {} };
    const refundCount = { processing: 0, done: 0, none: 0 };
    for (const o of all) {
      if (o.cls !== 'cancelled' && o.cls !== 'refund') continue;
      let st = o.refund && o.refund.state !== 'unknown' ? o.refund.state : (o.cls === 'refund' ? 'processing' : 'none');
      const itemSum = (o.items || []).reduce((sum, it) => sum + (it.price ? it.price.amount * (it.qty || 1) : 0), 0);
      // 환불 금액: ① 알리가 표시한 환불 금액 ② 실제 결제한 총 금액 ③ (둘 다 없을 때만) 상품 표시가 합계
      const shown = o.refund && o.refund.amount ? o.refund.amount : null;
      const amtSrc = shown ? 'shown' : (o.total ? 'paid' : 'list');
      const amt = conv(shown || o.total || (itemSum ? { amount: itemSum, currency: primary } : null));
      if (amt) addTo(refundSum[st], amt.currency, amt.amount);
      refundCount[st]++;
      const first = (o.items || [])[0] || {};
      refunds.push({
        orderId: o.id, date: o.date, state: st, title: (o.items || []).map((it) => it.title).join(' / ') || '(상품명 확인 불가)',
        image: first.image || '', url: first.url || '', amount: amt, amountSrc: amtSrc, text: (o.refund && o.refund.text) || ''
      });
    }
    const order = { processing: 0, done: 1, none: 2 };
    refunds.sort((a, b) => order[a.state] - order[b.state] || ((b.date || '') > (a.date || '') ? 1 : -1));

    const categories = [...catMap.values()].sort((a, b) => b.count - a.count);
    purchases.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));

    return {
      primary, rates, estimatedRates: est,
      orderCount: valid.length, totalOrders: all.length, itemCount, primaryOrders,
      spent, discount, discountOrders,
      statusOrders, statusItems,
      inProgress,
      delivered, deliveredItems: delivered.reduce((s, r) => s + r.qty, 0),
      inProgressItems: inProgress.reduce((s, r) => s + r.qty, 0),
      pendingItems: inProgress.filter((r) => r.status === 'pending_ship').reduce((s, r) => s + r.qty, 0),
      shippingItems: inProgress.filter((r) => r.status === 'shipping').reduce((s, r) => s + r.qty, 0),
      etaMissingOrders: [...new Set(inProgress.filter((r) => !r.etaEnd).map((r) => r.orderId))],
      refunds, refundSum, refundCount,
      categories, keywords: topKeywords(titles, 20),
      monthly: [...monthly.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      purchases
    };
  }

  const api = {
    parseDates, parseMoney, findMoney, classifyStatus, STATUS_LABEL, parseLines,
    scrapeDom, refundFromLines, refundState, extractFromJson, extractDetail, findListMeta, pickEta, parseResponseText, mergeOrder, mergeItems,
    categorize, topKeywords, computeStats, toISO, fromISO, CATEGORIES
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.AES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
