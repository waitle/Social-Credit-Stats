// 알리 주문 통계 - 화면(DOM)·API(JSON)·주문 상세 추출, 주문 병합
(function (g) {
  'use strict';
  const AES = g.AES || (g.AES = {});
  const { classifyStatus, findMoney, parseDates, parseLines, parseMoney, pickEta, pickProtection, toISO } = AES;

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
        protectEnd: info.protectEnd || null,
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
  const KEY_STORE = /^(storeName|sellerName|shopName|storeTitle|sellerShopName)$/i;
  const KEY_TRACKNO = /^(trackingNumber|trackingNo|trackNo|logisticsNo|logisticsNumber|mailNo|waybillNo|expressNo|trackingCode)$/i;
  const KEY_CARRIER = /^(logisticsCompany|logisticsCompanyName|carrierName|carrier|logisticsServiceName|serviceName|companyName|logisticsName|deliveryProviderName)$/i;
  const TRACK_LABEL = /(운송장|송장\s*번호|tracking\s*(no\.?|number|#|code)|트래킹\s*번호)/i;
  const DELIVERED_EVENT = /(배달\s*완료|배송\s*완료|수령\s*완료|delivered|signed|received by)/i;

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
      let date = info.date, status = info.status, statusText = info.statusText, total = info.total, discount = info.discount, eta = info.eta, store = null;
      let discSum = 0, discCur = null, discFound = false;
      const statusCands = [];
      for (const [k, v] of b.leaves) {
        if (!k) continue;
        if (KEY_DATE.test(k)) {
          let d = null, ht = true;
          if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) d = epochToDate(v);
          else { const p = parseDates(v, { ref, prefer: 'past' })[0]; if (p) { d = p.date; ht = p.hasTime; } }
          if (d) date = toISO(d, ht);
        } else if (KEY_STORE.test(k) && typeof v === 'string' && !store) {
          store = v.trim().slice(0, 80);
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
        id, date, statusText, status, total, discount, eta, items, store,
        protectEnd: info.protectEnd || null,
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
  /**
   * 결제수단: 상세 페이지/상세 API 에서 "결제 수단 …" 표시를 찾는다 (예: Visa ****1234, PayPal, 카카오페이).
   * 실제 상세 페이지의 항목 이름은 아직 확인하지 못해, 흔한 키 이름과 표시 문구를 넓게 인식한다.
   */
  const KEY_PAYMENT = /^(paymentMethod(Name|Text|Desc)?|payMethod(Name|Text)?|paymentChannel(Name|Text)?|payChannel(Name|Text)?|payTypeName|paymentTypeName|paymentToolName|payToolName|cashierChannelName|paymentInstrument(Name)?)$/i;
  const PAYMENT_LABEL = /^(결제\s*(수단|방법|방식)|지불\s*(수단|방법)|payment\s*(method|type|channel)|paid\s*(with|by)|pay\s*(with|by))\s*[:：]?\s*(.*)$/i;
  const payOk = (v) => typeof v === 'string' && (() => { const t = stripHtml(v).trim(); return t.length >= 2 && t.length <= 60 && !/^\d+$/.test(t) && !/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(t) && !/^(true|false|null|undefined)$/i.test(t); })();
  function pickPayment(jsons, lines) {
    let found = null;
    (function walk(n, d) {
      if (found || !n || typeof n !== 'object' || d > 30) return;
      if (!Array.isArray(n)) for (const k of Object.keys(n)) if (KEY_PAYMENT.test(k) && payOk(n[k])) { found = stripHtml(n[k]).trim(); return; }
      for (const k of Object.keys(n)) walk(n[k], d + 1);
    })(jsons, 0);
    if (found) return found;
    const ls = lines || [];
    for (let i = 0; i < ls.length; i++) {
      const m = String(ls[i]).trim().match(PAYMENT_LABEL);
      if (!m) continue;
      const same = (m[m.length - 1] || '').trim();
      const v = same || (ls[i + 1] ? String(ls[i + 1]).trim() : '');       // 라벨만 있는 줄이면 다음 줄이 값
      if (payOk(v) && !PAYMENT_LABEL.test(v)) return stripHtml(v).trim();
    }
    return null;
  }

  /** 운송장 번호, 택배사, 마지막 배송 이벤트(시간 최신) */
  function pickTracking(jsons, lines, ref) {
    let no = null, carrier = null, last = null;
    const textOf = (o) => { for (const k of Object.keys(o)) if (/(desc|detail|content|status|event|title|message|action)/i.test(k) && typeof o[k] === 'string') { const t = stripHtml(o[k]); if (t.length >= 2 && t.length <= 200) return t; } return null; };
    const timeOf = (o) => {
      for (const k of Object.keys(o)) {
        if (!/(time|date|gmt)/i.test(k)) continue;
        const v = o[k];
        if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) { const d = epochToDate(v); if (d) return d; }
        if (typeof v === 'string') { const p = parseDates(v, { ref, prefer: 'past' })[0]; if (p) return p.date; }
      }
      return null;
    };
    (function walk(n, d) {
      if (!n || typeof n !== 'object' || d > 30) return;
      if (Array.isArray(n)) {
        for (const e of n) {
          if (e && typeof e === 'object' && !Array.isArray(e)) {
            const t = timeOf(e), x = textOf(e);
            if (t && x && (!last || t > last.t)) last = { t, text: x };
          }
        }
      } else {
        for (const k of Object.keys(n)) {
          const v = n[k];
          if (!no && KEY_TRACKNO.test(k) && typeof v === 'string' && /^[A-Z0-9-]{8,40}$/i.test(v.trim())) no = v.trim();
          else if (!carrier && KEY_CARRIER.test(k) && typeof v === 'string' && v.trim().length < 60) carrier = stripHtml(v);
        }
      }
      for (const k of Object.keys(n)) walk(n[k], d + 1);
    })(jsons, 0);
    if (!no) {
      for (const l of lines) {
        if (!TRACK_LABEL.test(l) || l.length > 160) continue;
        const m = l.replace(TRACK_LABEL, ' ').match(/\b([A-Z]{2}\d{9}[A-Z]{2}|[A-Z0-9]{10,30})\b/);
        if (m && !/^\d{15,}$/.test(m[1])) { no = m[1]; break; }
      }
    }
    if (!no && !last) return null;
    return { no, carrier, last: last ? { text: last.text, time: toISO(last.t, true) } : null };
  }

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
    const jsons = (captures || []).map((c) => parseResponseText(c.text)).filter(Boolean);
    const tracking = pickTracking(jsons, lines, ref);
    const protectEnd = pickProtection(lines, ref) || pickProtection(apiLines, ref);
    const payment = pickPayment(jsons, lines) || pickPayment([], apiLines);
    return { eta, etaSrc, items, tracking, protectEnd, payment, rawLines: lines.slice(0, 120), apiLines: apiLines.slice(0, 150) };
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
    if (b.store && !(keepA && a.store)) out.store = b.store;
    if (b.protectEnd) out.protectEnd = b.protectEnd;
    if (b.track) out.track = b.track;
    if (b.payment) out.payment = b.payment;
    // 배송 완료 시점: 추적 이벤트의 배달 완료 시간 > 상태가 배송 완료로 바뀐 것을 처음 본 시점
    const tl = out.track && out.track.last;
    if (tl && tl.time && DELIVERED_EVENT.test(tl.text || '') && out.deliveredSrc !== 'tracking') { out.deliveredAt = tl.time; out.deliveredSrc = 'tracking'; }
    else if (out.status === 'delivered' && !out.deliveredAt && a.status && a.status !== 'delivered' && a.status !== 'unknown') { out.deliveredAt = toISO(new Date(), true); out.deliveredSrc = 'observed'; }
    if (b.detailAt) { out.detailAt = b.detailAt; out.detailRaw = b.detailRaw || out.detailRaw; }
    out.items = keepA && (a.items || []).length ? a.items : mergeItems(a.items || [], b.items || []);
    out.raw = b.raw || a.raw;
    out.source = a.source === b.source ? a.source : (a.source === 'api' || b.source === 'api' ? 'api' : 'both');
    out.updated = Date.now();
    return out;
  }


  Object.assign(AES, { KEY_STORE, KEY_TRACKNO, KEY_CARRIER, TRACK_LABEL, DELIVERED_EVENT, pickTracking, pickPayment, ORDER_ID_RE, ITEM_HREF_RE, qtyFromText, isStrike, scrapeDom, ID_KEYS, isId, firstOf, itemFromObject, KEY_DATE, KEY_STATUS, KEY_TOTAL, KEY_TOTAL_EXCL, KEY_DISC, KEY_DISC_EXCL, KEY_ETA, epochToDate, stripHtml, subtreeStrings, refundState, refundFromObject, refundAmountFromObject, refundFromLines, finishRefund, findListMeta, extractFromJson, extractDetail, parseResponseText, itemKey, mergeItems, mergeOrder });
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
