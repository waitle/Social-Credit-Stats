// 타오바오 주문 파서 - 목록(mtop.taobao.order.queryboughtlistV2), 상세(mtop.taobao.order.query.detailV2)
// 알리 주문 모델(AES 주문 객체)로 변환한다. 화면·통계 코드는 그대로 쓴다.
// 응답 형태는 2026-11 실제 계정에서 확인한 구조: 목록은 Ultron(data.data["<tag>_<주문번호>"].fields), 상세는 settlementInfo/detailInfo.
(function (g) {
  'use strict';
  const AES = g.AES || (g.AES = {});

  const LIST_API = 'mtop.taobao.order.queryboughtlistV2';
  const DETAIL_API = 'mtop.taobao.order.query.detailV2';

  /** 목록 요청 옵션 (페이지의 lib.mtop 에 그대로 전달). tab: all | waitPay | waitSend | waitConfirm | waitRate */
  function listRequest(page, tab) {
    return {
      api: LIST_API, v: '1.0', type: 'POST', ecode: 1, timeout: 20000,
      data: { tabCode: tab || 'all', page: page || 1, OrderType: 'OrderList', appName: 'tborder', appVersion: '3.0', condition: '{"directRouteToTm2Scene":"1"}' }
    };
  }
  function detailRequest(orderId) {
    return { api: DETAIL_API, v: '1.0', type: 'POST', ecode: 1, timeout: 20000, data: { bizOrderId: String(orderId), appName: 'tborder', appVersion: '3.0' } };
  }

  /* ---------------------------- 금액 ---------------------------- */
  /** "￥268.00" / "¥1,234.5" / "KRW 43146" / "USD 12.30" / "43,146원" → { amount, currency } */
  function money(v, strict) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    let cur = null;
    const code = s.match(/\b(KRW|CNY|RMB|USD|JPY|EUR|HKD|TWD)\b/i);
    if (code) cur = code[1].toUpperCase() === 'RMB' ? 'CNY' : code[1].toUpperCase();
    else if (/[￥¥]/.test(s)) cur = 'CNY';
    else if (/[₩원]/.test(s)) cur = 'KRW';
    else if (/US\$|\$/.test(s)) cur = 'USD';
    if (strict && !cur) return null;                          // 통화 표시가 없으면 실결제액으로 믿지 않는다 (위안으로 잘못 읽는 것 방지)
    const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const amount = parseFloat(m[0]);
    if (!isFinite(amount)) return null;
    return { amount, currency: cur || 'CNY' };
  }

  /* ---------------------------- 상태 ---------------------------- */
  /** 타오바오 거래 상태 문구(tradeTitle) → 확장 프로그램 상태. 상품별 환불 문구는 parseList 에서 따로 반영한다 */
  function statusOf(title) {
    const t = String(title || '').trim();
    if (/交易关闭|已关闭|订单关闭/.test(t)) return 'cancelled';
    if (/退款中|退款处理中|售后中|申请退款|退货中/.test(t)) return 'refund';
    if (/等待买家付款|待付款|等待付款/.test(t)) return 'unpaid';
    if (/买家已付款|等待卖家发货|待发货|等待发货|已付款/.test(t)) return 'pending_ship';
    if (/卖家已发货|部分发货|等待买家确认收货|待收货|已发货|运输中|派送中|待确认收货/.test(t)) return 'shipping';
    if (/交易成功|已签收|已完成|确认收货|已收货/.test(t)) return 'delivered';
    return 'unknown';
  }

  /** 상품 하나의 환불 문구 → 'done'(환불 완료) | 'closed'(환불 요청이 닫힘·거절·철회: 돈이 돌아오지 않음) | 'processing' | null(환불 관련 문구 아님)
   *  "退款关闭"는 "환불 완료"가 아니라 "환불 요청 종료"라서 진행 중으로 보면 안 된다 */
  function refundOf(refundText) {
    const r = String(refundText || '').trim();
    if (!r) return null;
    if (/退款成功|已退款|退款完成|退货退款成功/.test(r)) return 'done';
    if (/退款关闭|关闭退款|拒绝|驳回|撤销|已取消|售后关闭|售后完成/.test(r)) return 'closed';
    if (/退款|退货|售后|处理中|申请中|待处理|待卖家|等待卖家|等待买家/.test(r)) return 'processing';
    return null;
  }

  const keyOf = (it) => (AES.itemKey ? AES.itemKey(it) : it.lineId || it.id || (it.title || '').slice(0, 24).toLowerCase());

  /** 거래 상태 + 상품별 환불 문구 → { status, refund }
   *  - 환불은 상품 단위로 일어난다. 일부 상품만 환불되면 주문 상태는 그대로 두고 refund.partial 로 그 상품 금액만 표시한다
   *  - 모든 상품이 환불 중이면 주문 전체 환불(status 'refund'), 거래가 닫혔으면(交易关闭) 주문 전체 금액
   *  - 환불 요청이 닫힘·거절(退款关闭 등)은 환불이 아니다 → 무시
   *  - 주문 전체 환불은 amount 를 비워 둔다: 통계가 실제 결제액(상세에서 읽은 원화)을 쓰게 하려고 */
  function orderRefund(status, items) {
    const hit = items.filter((it) => it.refundState === 'done' || it.refundState === 'processing');
    const text = [...new Set(hit.map((it) => it.refundText))].join(' / ').slice(0, 200);
    const anyProc = hit.some((it) => it.refundState === 'processing');
    const whole = (state) => ({ state, text, amount: null, amountSrc: 'paid' });
    if (status === 'cancelled') return { status, refund: hit.length ? whole(anyProc ? 'processing' : 'done') : null };
    if (status === 'refund') return { status, refund: whole('processing') };
    if (!hit.length) return { status, refund: null };
    if (hit.length === items.length) return anyProc ? { status: 'refund', refund: whole('processing') } : { status: 'cancelled', refund: whole('done') };
    let sum = 0, cur = null;
    for (const it of hit) if (it.lineTotal) { sum += it.lineTotal.amount; cur = cur || it.lineTotal.currency; }
    return {
      status,
      refund: { state: anyProc ? 'processing' : 'done', text, partial: true, keys: hit.map(keyOf), amount: cur ? { amount: sum, currency: cur } : null, amountSrc: 'item' }
    };
  }

  /* ---------------------------- 날짜 ---------------------------- */
  /** "2024-03-05 14:22:10" / "2024-03-05" / "2024.03.05" → "2024-03-05 14:22" 또는 "2024-03-05" */
  function dateOf(v) {
    if (v == null) return null;
    const m = String(v).match(/(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})(?:[日\sT]+(\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${m[1]}-${p2(m[2])}-${p2(m[3])}` + (m[4] != null ? ` ${p2(m[4])}:${m[5]}` : '');
  }

  /* ---------------------------- 목록 ---------------------------- */
  function fieldsOf(c) { return c && typeof c === 'object' ? (c.fields && typeof c.fields === 'object' ? c.fields : c) : {}; }
  const strOf = (v) => (typeof v === 'string' ? v : v != null && typeof v !== 'object' ? String(v) : '');
  function absUrl(u) { const s = strOf(u); return s.startsWith('//') ? 'https:' + s : s; }
  function itemUrl(id) { return id ? `https://item.taobao.com/item.htm?id=${id}` : ''; }

  /** 같은 키를 가진 문자열을 객체 안쪽에서 찾는다 (환불 문구 등 위치가 일정하지 않은 값) */
  function deepFind(node, key, depth) {
    if (node == null || (depth || 0) > 8) return null;
    if (Array.isArray(node)) { for (const x of node) { const r = deepFind(x, key, (depth || 0) + 1); if (r) return r; } return null; }
    if (typeof node !== 'object') return null;
    if (typeof node[key] === 'string' && node[key]) return node[key];
    for (const k of Object.keys(node)) { const r = deepFind(node[k], key, (depth || 0) + 1); if (r) return r; }
    return null;
  }

  /** 목록 응답(JSON 객체) → { orders, hasMore, nextPage, ok } */
  function parseList(json) {
    const root = json && json.data ? json.data : json;
    const data = root && root.data && typeof root.data === 'object' ? root.data : null;
    if (!data) return { orders: [], hasMore: false, nextPage: null, ok: false };
    const byId = new Map();
    const slot = (id) => { if (!byId.has(id)) byId.set(id, { shop: null, pay: null, items: [], ext: null }); return byId.get(id); };
    for (const key of Object.keys(data)) {
      const m = key.match(/^([A-Za-z]+)_(\d{10,25})(?:_.*)?$/);
      if (!m) continue;
      const tag = m[1], id = m[2];
      const comp = data[key];
      if (tag === 'shopInfo') slot(id).shop = comp;
      else if (tag === 'orderPayment') slot(id).pay = comp;
      else if (tag === 'orderItemInfo') slot(id).items.push(comp);
      else if (tag === 'orderExt') slot(id).ext = comp;
    }
    const orders = [];
    for (const [id, s] of byId) {
      if (!s.shop && !s.pay && !s.items.length) continue;
      const sf = fieldsOf(s.shop), pf = fieldsOf(s.pay);
      const tradeTitle = strOf(sf.tradeTitle) || strOf(deepFind(s.shop, 'tradeTitle'));
      const items = [], seen = new Map();
      for (const comp of s.items) {
        const f = fieldsOf(comp), it = f.item && typeof f.item === 'object' ? f.item : f;
        const title = strOf(it.title).trim();
        const rs = (strOf(it.refundStatus) || strOf(deepFind(comp, 'refundStatus'))).trim();
        if (!title && !it.itemId) continue;
        const qty = AES.TOPUP_RE && AES.TOPUP_RE.test(title) ? 1 : (parseInt(strOf(it.quantity), 10) || 1);   // 차액·운임 보충 링크는 금액만큼 수량이 늘어나므로 1건으로
        const price = money(it.priceInfo && (it.priceInfo.actualTotalFee || it.priceInfo.promotion));
        const sku = strOf(it.skuText).trim();
        // 상품 줄 구분 키: 같은 상품의 다른 옵션(SKU)이 한 주문에 함께 있을 수 있어 상품번호만으로는 겹친다 (환불·병합이 엉뚱한 줄에 적용됨)
        let lineId = strOf(f.subOrderId || it.subOrderId) || `${strOf(it.itemId) || title.slice(0, 24)}|${sku}`;
        const dup = seen.get(lineId) || 0; seen.set(lineId, dup + 1);
        if (dup) lineId += '#' + dup;
        items.push({
          id: strOf(it.itemId), lineId, title: title || '(상품명 확인 불가)', sku, qty,
          price: price ? { amount: price.amount / qty, currency: price.currency } : null,   // 항목 금액은 수량을 곱한 합계로 내려온다
          lineTotal: price, orig: null, image: absUrl(it.pic), url: itemUrl(strOf(it.itemId)),
          refundText: rs, refundState: refundOf(rs)
        });
      }
      const actual = money(pf.actualFee), totalFee = money(pf.totalFee), disc = money(pf.discountFee);
      const total = actual || totalFee || null;
      const shipFee = money(pf.pcPostFee);
      const { status, refund } = orderRefund(statusOf(tradeTitle), items);
      const o = {
        id, date: dateOf(sf.createTime) || dateOf(sf.createDay), statusText: tradeTitle, status,
        total, totalCny: total && total.currency === 'CNY' ? total : null,
        discount: disc && disc.amount > 0 ? disc : null,
        store: strOf(sf.shopName).trim() || strOf(sf.sellerName).trim(), seller: strOf(sf.sellerName).trim(),
        shipFeeCny: shipFee && shipFee.amount > 0 ? shipFee.amount : 0,
        overseasDirect: /官方直邮|直邮/.test(strOf(pf.serviceDesc) + JSON.stringify(pf.additionalFeeList || '')),
        canViewLogistics: !!(s.ext && (fieldsOf(s.ext).canViewLogistics === true || fieldsOf(s.ext).canViewLogistics === 'true')),
        items, refund,
        raw: JSON.stringify({ t: tradeTitle, r: items.map((x) => x.refundText).filter(Boolean), a: pf.actualFee }).slice(0, 300),
        source: 'api', site: 'taobao'
      };
      orders.push(o);
    }
    const pc = (root.global && root.global.pageControl) || (json.data && json.data.global && json.data.global.pageControl) || {};
    const hasMore = pc.hasMore === true || pc.hasMore === 'true';
    const nextPage = parseInt(pc.nextPageIndex, 10) || null;
    return { orders, hasMore, nextPage, ok: true };
  }

  /* ---------------------------- 상세 ---------------------------- */
  /** 상세 응답 → 주문 보강 정보 { payment, paid(KRW 등 실제 결제액), payAt, shipAt, dest, shipMode, labels } */
  function parseDetail(json, orderId) {
    const d = json && json.data ? json.data : json;
    if (!d || typeof d !== 'object') return null;
    const out = { id: String(orderId || ''), source: 'detail' };
    const sp = (d.settlementInfo && d.settlementInfo) || {};
    const arr = (x) => (Array.isArray(x) ? x : []);
    // 실제 결제액: 결제 수단 통화(원화·달러·위안)로 표시된 "实付款"
    const pay = arr(sp.payDetails).find((p) => /实付款|实付|Paid/.test(strOf(p && p.name))) || arr(sp.payDetails)[0];
    const paid = pay ? money(pay.value, true) : null;
    if (paid) out.paid = paid;
    const prices = arr(sp.orderPriceDetails);
    const goods = prices.find((p) => /商品总价/.test(strOf(p && p.name)));
    const post = prices.find((p) => /运费/.test(strOf(p && p.name)));
    if (goods) out.goodsCny = money(goods.value);
    if (post) out.postCny = money(post.value);
    // 라벨(수령 정보·주문번호·시간)
    const labels = arr(d.detailInfo && d.detailInfo.labels);
    let recv = '';
    for (const l of labels) {
      const tag = strOf(l && l.tag), name = strOf(l && l.name), val = strOf(l && l.value);
      if (tag === 'RECEIVE_INFO') recv = val;
      else if (/付款时间|支付时间/.test(name)) out.payAt = dateOf(val);
      else if (/发货时间/.test(name)) out.shipAt = dateOf(val);
      else if (/成交时间|完成时间/.test(name)) out.doneAt = dateOf(val);
      else if (/创建时间|下单时间/.test(name) && !out.createdAt) out.createdAt = dateOf(val);
    }
    const addr = strOf(d.logisticsAddress && d.logisticsAddress.addressData && d.logisticsAddress.addressData.address);
    out.dest = classifyDest(recv + ' ' + addr);
    out.shipMode = out.dest.kind;       // 'forwarder' | 'direct' | 'unknown'
    return out;
  }

  /** 수령 주소로 배송대행(배대지)과 한국 직배송을 가른다 */
  function classifyDest(text) {
    const t = String(text || '');
    if (/中韩E递|E递|转运|集运|仓|ATTN|威海|青岛|烟台|义乌|广州|深圳|上海|北京.*(仓|转)/.test(t)) return { kind: 'forwarder', hint: 'cn-warehouse' };
    if (/[가-힣]/.test(t) || /Republic of Korea|South Korea|韩国|韩國|서울|경기|부산|인천|대구/.test(t)) return { kind: 'direct', hint: 'korea' };
    if (/省|市|区|县/.test(t)) return { kind: 'forwarder', hint: 'cn-address' };
    return { kind: 'unknown', hint: '' };
  }

  /** 상세 보강 정보 → mergeOrder 에 넘길 부분 주문 */
  function detailPatch(det) {
    if (!det) return null;
    const p = { id: det.id, source: 'detail', detailAt: Date.now() };
    if (det.paid) {
      p.paidActual = det.paid;                                   // 실제 결제액 (원화 등)
      p.total = det.paid;
    }
    if (det.goodsCny) p.goodsCny = det.goodsCny;
    if (det.payAt) p.payAt = det.payAt;
    if (det.shipAt) p.shipAt = det.shipAt;
    if (det.shipMode) { p.shipMode = det.shipMode; p.noCustoms = det.shipMode !== 'direct'; }   // 배대지·모르면 관세 경고를 내지 않는다
    return p;
  }

  /* ---------------------------- 환율 / 통계 ---------------------------- */
  /** 위안 결제와 실제 결제액(원화)이 모두 있는 주문에서 위안 → 원 환율의 중앙값을 추정 */
  function estimateCnyKrw(ordersMap) {
    const r = [];
    for (const o of Object.values(ordersMap || {})) {
      if (o.paidActual && o.paidActual.currency === 'KRW' && o.totalCny && o.totalCny.amount > 0) r.push(o.paidActual.amount / o.totalCny.amount);
    }
    if (!r.length) return null;
    const s = r.sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** 타오바오 주문은 목록이 위안 금액이고 상세에서 실제 결제액(원화)이 붙는다.
   *  통계는 원화 기준으로 내기 위해 위안 금액은 환율(설정 > 추정)로 환산 (환산 여부는 estimated 로 표시) */
  function statsOptionsFor(settings, ordersMap, extra) {
    const rate = settings && settings.cnyRate > 0 ? +settings.cnyRate : estimateCnyKrw(ordersMap);
    const opts = AES.statsOptions(settings, Object.assign({ currency: 'KRW', rates: rate ? { CNY: rate } : {} }, extra || {}));
    opts.cnyRate = rate || null;
    opts.cnyRateAuto = !(settings && settings.cnyRate > 0);
    return opts;
  }

  /** 위안으로만 남은(원화 실결제액을 아직 모르는) 주문 수 */
  function estimatedCount(ordersMap) {
    let n = 0;
    for (const o of Object.values(ordersMap || {})) {
      if (o.paidActual || !o.total || o.total.currency !== 'CNY' || o.status === 'unpaid') continue;
      if (o.status === 'cancelled' && !(o.refund && o.refund.state !== 'none')) continue;   // 결제 전 취소는 금액이 의미 없다. 환불된 주문은 환불 금액이 추정치
      n++;
    }
    return n;
  }

  /* 병합 규칙: 사이트 전용 필드를 mergeOrder 가 보존하게 하고, 실제 결제액(상세)이 있으면 목록의 위안 금액이 덮어쓰지 못하게 한다 */
  const EXTRA = ['site', 'seller', 'totalCny', 'goodsCny', 'paidActual', 'shipFeeCny', 'overseasDirect', 'canViewLogistics', 'shipMode', 'noCustoms', 'shipAt'];
  for (const k of EXTRA) if (!AES.MERGE_EXTRA.includes(k)) AES.MERGE_EXTRA.push(k);
  const prevPost = AES.MERGE_POST;
  AES.MERGE_POST = function (out, a, b) {
    if (prevPost) prevPost(out, a, b);
    if (out.paidActual) out.total = out.paidActual;
    // 목록 응답은 환불 정보의 원본이다: 환불 요청이 닫혀 없어진 경우도 반영해야 하므로 비어 있어도 덮어쓴다 (mergeOrder 는 값이 있을 때만 덮어씀)
    if (b && b.site === 'taobao' && b.source === 'api' && Array.isArray(b.items)) {
      out.refund = b.refund || null;
      // 상품 줄도 목록 값으로 통째로 바꾼다 (상세 보강은 상품 줄을 건드리지 않는다). 상품번호만 키로 쓰던 이전 저장분이 옵션별 줄과 섞이지 않게 하려는 것
      if (b.items.length) out.items = b.items.map((it) => ({ ...it }));
    }
  };

  const taobao = { LIST_API, DETAIL_API, listRequest, detailRequest, money, statusOf, refundOf, orderRefund, dateOf, parseList, parseDetail, classifyDest, detailPatch, estimateCnyKrw, statsOptionsFor, estimatedCount };
  AES.taobao = taobao;
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
