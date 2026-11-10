// 알리 주문 통계 - 품목 분류, 통계 계산
(function (g) {
  'use strict';
  const AES = g.AES || (g.AES = {});
  const { DAY, classifyStatus, fromISO } = AES;

  /* ------------------------------------------------------------------ *
   * 카테고리 분류 / 키워드
   * ------------------------------------------------------------------ */
  const CATEGORIES = [
    ['휴대폰·충전·오디오', /phone|iphone|galaxy|samsung|xiaomi|케이스|휴대폰|스마트폰|충전|charger|charging|cable|케이블|\busb\b|type-?c|lightning|magsafe|screen protector|강화유리|필름|earphone|이어폰|earbud|헤드폰|headphone|airpods|power ?bank|보조배터리|\btws\b|bluetooth|블루투스|手机|苹果|华为|小米|充电|数据线|快充|充电器|充电宝|移动电源|耳机|蓝牙|音响|手机壳|钢化膜|贴膜|麦克风|音频|话筒/i],
    ['컴퓨터·IT·전자부품', /keyboard|키보드|mouse|마우스|\bssd\b|laptop|노트북|hdmi|adapter|어댑터|monitor|모니터|raspberry|arduino|esp32|esp8266|\bsensor\b|센서|module|모듈|\bpcb\b|resistor|capacitor|\bchip\b|webcam|웹캠|router|\bhub\b|\bnas\b|\bram\b|usb ?드라이브|메모리|sd ?card|micro ?sd|flash drive|3d ?print|필라멘트|filament|电脑|笔记本|键盘|鼠标|硬盘|固态|内存|显卡|主板|服务器|散热|处理器|机箱|电源|显示器|摄像头|路由|交换机|网卡|网线|转接|扩展坞|读卡器|U盘|存储|传感器|模块|开发板|单片机|芯片|电阻|电容|排线|接口|集成电路|工控|拆机|矿卡|CPU|GPU|DDR|NVME|SATA|PCIE|HDMI/i],
    ['가전·조명·스마트기기', /\bled\b|light|lamp|조명|램프|전구|camera|카메라|projector|프로젝터|speaker|스피커|smart|스마트|watch band|스마트워치|smartwatch|drone|드론|battery|배터리|\bfan\b|선풍기|heater|히터|humidifier|가습기|vacuum|청소기|\brobot\b|\bremote\b|리모컨|\bwifi\b|灯|照明|台灯|投影|音箱|智能|手表|手环|无人机|电池|风扇|取暖|加湿|电饭|电水壶|电器|家电|吸尘|空调|电动|相机|显示屏/i],
    ['패션의류', /shirt|t-shirt|tee\b|dress|jacket|pants|trousers|jeans|티셔츠|셔츠|바지|원피스|자켓|재킷|후드|hoodie|sweater|스웨터|cardigan|가디건|socks|양말|속옷|underwear|bra\b|coat|코트|패딩|청바지|skirt|치마|leggings|레깅스|pajama|잠옷|옷|의류|clothing|clothes|衣|裤|裙|外套|T恤|卫衣|毛衣|羽绒|袜|内衣|内裤|夹克|西装|睡衣|连衣/i],
    ['신발·가방', /shoes?\b|sneakers?|신발|운동화|슬리퍼|slippers?|sandals?|샌들|boots?\b|부츠|\bbag\b|backpack|가방|백팩|wallet|지갑|크로스백|handbag|핸드백|파우치|pouch|luggage|캐리어|鞋|靴|拖鞋|凉鞋|包包|背包|书包|挎包|腰包|钱包|行李箱|旅行箱/i],
    ['액세서리·주얼리', /\bring\b|반지|necklace|목걸이|bracelet|팔찌|earrings?|귀걸이|jewelry|jewellery|주얼리|\bwatch\b|시계|sunglasses|선글라스|\bhat\b|\bcap\b|모자|\bbelt\b|벨트|scarf|스카프|머플러|gloves?|장갑|brooch|브로치|keychain|키링|pendant|펜던트|戒指|项链|手链|耳环|饰品|首饰|眼镜|帽|腰带|围巾|手套|胸针|挂件|吊坠/i],
    ['뷰티·건강', /makeup|make-up|화장품|cream|크림|lipstick|립|\bnail\b|네일|brush|브러시|massage|마사지|\bhair\b|헤어|skin|스킨|마스크팩|shaver|면도|trimmer|트리머|perfume|향수|serum|세럼|eyelash|속눈썹|vitamin|비타민|toothbrush|칫솔|beauty|뷰티|化妆|护肤|面膜|口红|美甲|美妆|香水|精华|洗发|护发|按摩|剃须|理发|牙刷|维生素|保健|眼罩/i],
    ['홈·주방·생활', /kitchen|주방|storage|수납|organizer|정리|towel|수건|bedding|침구|curtain|커튼|\bcup\b|컵|bottle|텀블러|\bpan\b|냄비|knife|칼|청소|cleaning|bathroom|욕실|거치대|holder|\bhook\b|후크|hanger|행거|shelf|선반|container|용기|mat\b|매트|rug|러그|pillow|베개|basket|바구니|home|가정|생활|storage box|tape measure|厨房|收纳|整理|毛巾|床|窗帘|杯|水壶|保温|锅|刀|清洁|浴室|挂钩|支架|置物|衣架|架子|桌|椅|家居|垃圾|拖把/i],
    ['공구·DIY·자동차', /\btools?\b|공구|drill|드릴|screw|나사|\bcar\b|자동차|차량|\bauto\b|\bbike\b|자전거|motorcycle|오토바이|wrench|렌치|repair|수리|solder|납땜|headlight|bolt|볼트|\bnut\b|너트|plier|플라이어|screwdriver|드라이버|glue|접착|welding|용접|multimeter|멀티미터|dash ?cam|블랙박스|工具|螺丝|螺栓|螺母|电钻|扳手|焊|维修|汽车|车载|车用|摩托|自行车|五金|钳|胶|批头|万用表|示波器/i],
    ['스포츠·아웃도어', /sports?\b|스포츠|운동|fitness|피트니스|yoga|요가|camping|캠핑|fishing|낚시|outdoor|아웃도어|등산|hiking|running|러닝|cycling|사이클|golf|골프|tent|텐트|swim|수영|dumbbell|덤벨|badminton|배드민턴|tennis|테니스|运动|健身|瑜伽|露营|钓|户外|登山|骑行|跑步|球|帐篷|游泳|哑铃|羽毛/i],
    ['완구·취미', /\btoy\b|toys|장난감|lego|레고|figure|피규어|puzzle|퍼즐|\bgame\b|게임|\brc\b|model|모형|craft|취미|인형|doll|plush|diy kit|diamond painting|보석십자수|magnet|자석|building block|블록|玩具|积木|手办|模型|摆件|拼图|游戏|遥控|玩偶|公仔|钻石画|磁铁|航模|盲盒/i],
    ['반려동물', /\bpet\b|\bdog\b|\bcat\b|강아지|고양이|반려|puppy|kitten|宠物|猫|狗|犬/i],
    ['문구·사무', /\bpen\b|\b펜\b|notebook|노트|stationery|문구|sticker|스티커|paper|종이|\btape\b|테이프|label|라벨|marker|마커|planner|플래너|stamp|스탬프|笔|本子|笔记|文具|贴纸|纸|胶带|标签|马克|计划|印章|打印/i],
    ['유아·아동', /baby|아기|유아|\bkids?\b|아동|어린이|toddler|children|婴儿|宝宝|儿童|童装|幼儿|母婴|孩/i]
  ];

  /** 항공권·승차권·입장권 같은 티켓류: 실물 배송이 없으므로 배송 현황에서 뺀다 (구매·지출 통계에는 그대로 포함) */
  const TICKET_RE = /항공권|항공편|비행기\s*표|탑승권|기차표|열차표|승차권|버스표|입장권|전자\s*티켓|e-?ticket|air\s*ticket|flight|airfare|airline|boarding\s*pass|티켓|\bticket/i;
  const TICKET_ACCESSORY_RE = /홀더|케이스|커버|스티커|클립|지갑|파일|holder|case|cover|sticker|clip|wallet|pouch|organizer|printer|프린터|용지|paper|roll|롤/i;
  function isTicket(title) {
    const t = String(title || '');
    return TICKET_RE.test(t) && !TICKET_ACCESSORY_RE.test(t);
  }

  /** 운송장 번호가 같은 서로 다른 주문들을 묶는다 → [{ no, carrier, orderIds, members: 행 목록 }] (큰 묶음 먼저) */
  function groupByTracking(rows) {
    const map = new Map();
    for (const r of rows) {
      const no = r.track && r.track.no ? String(r.track.no).trim().toUpperCase() : '';
      if (no.length < 8) continue;
      let g = map.get(no);
      if (!g) { g = { no, carrier: (r.track && r.track.carrier) || '', orderIds: [], members: [] }; map.set(no, g); }
      if (!g.orderIds.includes(r.orderId)) g.orderIds.push(r.orderId);
      if (!g.carrier && r.track.carrier) g.carrier = r.track.carrier;
      g.members.push(r);
    }
    return [...map.values()].filter((g) => g.orderIds.length >= 2).sort((a, b) => b.orderIds.length - a.orderIds.length || a.no.localeCompare(b.no));
  }

  /** 차액·운임 보충용 결제 링크("补差价", "补运费" 등)는 금액만큼 수량을 늘려 결제한다 (예: 1600개). 실제 물건 수가 아니므로 1건으로 센다 */
  const TOPUP_RE = /补差价|补运费|补邮费|补款|差价链接|运费链接|邮费链接|差价专用|补拍/;
  const qtyOf = (it) => (it && TOPUP_RE.test(String(it.title || '')) ? 1 : (it && it.qty) || 1);

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
    // 일부 상품만 환불 진행 중인 기간 밖 주문(배송 완료 등)은 환불 목록에만 넣는다 (결제액·구매 수에 기간 밖 주문이 섞이지 않게)
    let refundOnly = [];
    if (opts.since) {
      const inP = (o) => !o.date || String(o.date).slice(0, 10) >= opts.since || o.cls === 'pending_ship' || o.cls === 'shipping';
      const rfProc = (o) => !!(o.refund && o.refund.state === 'processing');
      refundOnly = all.filter((o) => !inP(o) && rfProc(o) && o.refund.partial);
      all = all.filter((o) => inP(o) || (rfProc(o) && !o.refund.partial));
    }
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
      const q = (o.items || []).reduce((s, it) => s + (qtyOf(it)), 0) || 1;
      statusItems[o.cls] = (statusItems[o.cls] || 0) + q;
    }

    const valid = all.filter((o) => !['cancelled', 'unpaid', 'refund', 'event'].includes(o.cls));
    const spent = {}, discount = {};
    let itemCount = 0, discountOrders = 0, primaryOrders = 0;
    const catMap = new Map(), purchases = [], titles = [], monthly = new Map();

    for (const o0 of valid) {
      // 일부 상품만 환불된 주문(타오바오 refund.partial): 환불된 상품은 구매 수·분류에서 빼고, 환불 금액만큼 결제액에서 뺀다
      const rfKeys = o0.refund && o0.refund.partial && o0.refund.state !== 'none' ? new Set(o0.refund.keys || []) : null;
      const o = rfKeys ? { ...o0, items: (o0.items || []).filter((it) => !rfKeys.has(AES.itemKey(it))) } : o0;
      const qtyOrder = (o.items || []).reduce((s, it) => s + (qtyOf(it)), 0);
      itemCount += qtyOrder || 1;

      // 상품 금액 합 (할인 전 표시가)
      let itemSum = 0, itemCur = null;
      for (const it of o.items || []) if (it.price) { itemSum += it.price.amount * (qtyOf(it)); itemCur = itemCur || (it.price.currency || primary); }
      const totalRaw = o.total || (itemSum ? { amount: itemSum, currency: itemCur } : null);
      let total = conv(totalRaw);
      if (total && rfKeys && o.refund.amount) {
        const ra = conv(o.refund.amount);
        const base = o.totalCny && o.refund.amount.currency === 'CNY' ? o.totalCny : null;     // 환율을 몰라 원화로 못 바꾸면 위안 결제액에서 빼고 환산
        if (ra && ra.currency === total.currency) total = { amount: Math.max(0, total.amount - ra.amount), currency: total.currency };
        else if (base) total = conv({ amount: Math.max(0, base.amount - o.refund.amount.amount), currency: 'CNY' });
      }
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
        for (const it of o.items || []) if (it.orig && it.price) { const d = conv({ amount: (it.orig.amount - it.price.amount) * (qtyOf(it)), currency: it.price.currency }); dsum += d.amount; dcur = dcur || d.currency; }
      }
      if (dsum > 0) { addTo(discount, dcur, dsum); discountOrders++; }

      for (const it of o.items || []) {
        const catKey = AES.itemKey(it);
        const cat = (opts.catOverrides && opts.catOverrides[catKey]) || categorize(it.title);
        const qty = qtyOf(it);
        const pc = conv(it.price);
        const c = catMap.get(cat) || { name: cat, count: 0, spend: 0 };
        c.count += qty;
        if (pc && pc.currency === primary) c.spend += pc.amount * qty;
        catMap.set(cat, c);
        titles.push({ title: it.title, qty });
        purchases.push({
          orderId: o.id, date: o.date, title: it.title, qty, price: it.price, category: cat, catKey, catEdited: !!(opts.catOverrides && opts.catOverrides[catKey]),
          status: o.cls, image: it.image, url: it.url
        });
      }
    }

    // 진행 중 배송: 예상 도착일은 주문 상세 페이지의 값만 사용 (추정하지 않음)
    const inProgress = [];
    // 주문 상태는 아직 "배송 중"인데 배송 조회(트래킹)의 마지막 이벤트가 배달 완료인 주문: 도착했지만 수령 확인(배송 완료 확인)을 누르기 전
    const arrived = (o) => o.cls === 'shipping' && !!(o.track && (o.track.delivered === true || (o.track.last && AES.DELIVERED_EVENT.test(o.track.last.text || ''))));
    for (const o of all) {
      if (o.cls !== 'pending_ship' && o.cls !== 'shipping') continue;
      if (arrived(o)) continue;
      const rk = o.refund && o.refund.partial ? new Set(o.refund.keys || []) : null;   // 일부 환불된 상품은 배송 현황에서 뺀다
      const live = rk ? (o.items || []).filter((it) => !rk.has(AES.itemKey(it))) : o.items;
      const items = live && live.length ? live : [{ title: '(상품명 확인 불가)', qty: 1 }];
      for (const it of items) {
        if (isTicket(it.title)) continue;
        const e = it.eta || o.eta;
        const start = e ? fromISO(e.start) : null;
        const end = e ? fromISO(e.end) : null;
        const daysLeft = end ? Math.ceil((new Date(end.getFullYear(), end.getMonth(), end.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / DAY) : null;
        inProgress.push({
          orderId: o.id, title: it.title, qty: qtyOf(it), image: it.image || '', url: it.url || '',
          status: o.cls, statusText: o.statusText, orderDate: o.date,
          etaStart: e ? e.start : null, etaEnd: e ? e.end : null, etaFromDetail: !!(o.etaSrc === 'detail' || it.eta),
          detailTried: !!o.detailAt, daysLeft, _s: start,
          store: o.store || '', track: o.track || null, payment: o.payment || '', protectEnd: o.protectEnd || null,
          protectDaysLeft: o.protectEnd ? Math.ceil((fromISO(o.protectEnd) - now) / DAY) : null
        });
      }
    }
    inProgress.sort((a, b) => ((a.etaEnd || '9999') < (b.etaEnd || '9999') ? -1 : (a.etaEnd || '9999') > (b.etaEnd || '9999') ? 1 : 0));
    inProgress.forEach((r) => delete r._s);

    // 배송 완료: 주문 상태가 "배송 중"이면서 배송 조회상 이미 도착한 주문만.
    // 주문 상태가 "완료"인 주문은 사용자가 직접 수령 확인을 누른 것이므로 배송 현황에 넣지 않는다 (구매 내역에는 그대로 있음)
    const delivered = [];
    for (const o of all) {
      if (!arrived(o)) continue;
      const items = o.items && o.items.length ? o.items : [{ title: '(상품명 확인 불가)', qty: 1 }];
      for (const it of items) if (!isTicket(it.title)) delivered.push({ orderId: o.id, title: it.title, qty: qtyOf(it), image: it.image || '', url: it.url || '', status: 'delivered', statusText: o.statusText, orderDate: o.date, deliveredAt: (o.track.last && o.track.last.time) || o.deliveredAt || null, track: o.track || null, payment: o.payment || '', awaitingConfirm: true });
    }
    delivered.sort((a, b) => ((b.orderDate || '') > (a.orderDate || '') ? 1 : (b.orderDate || '') < (a.orderDate || '') ? -1 : 0));

    // 합배송: 같은 운송장 번호로 함께 오는 주문(서로 다른 주문 2건 이상)을 묶는다. 운송장 번호는 주문 상세에서 읽은 값만 쓴다.
    const shipGroups = groupByTracking([...inProgress, ...delivered]);
    const groupOf = new Map();
    for (const g of shipGroups) for (const m of g.members) groupOf.set(m.orderId, g);
    for (const r of inProgress) { const g = groupOf.get(r.orderId); r.groupSize = g ? g.orderIds.length : 0; }
    for (const r of delivered) { const g = groupOf.get(r.orderId); r.groupSize = g ? g.orderIds.length : 0; }

    // 취소·환불 주문: 환불 진행 중 / 완료 / 정보 없음(결제 전 취소 등)
    const refunds = [];
    const refundSum = { processing: {}, done: {}, none: {} };
    const refundCount = { processing: 0, done: 0, none: 0 };
    for (const o of [...all, ...refundOnly]) {
      const partial = !!(o.refund && o.refund.partial);
      if (o.cls !== 'cancelled' && o.cls !== 'refund' && !partial) continue;
      let st = o.refund && o.refund.state !== 'unknown' ? o.refund.state : (o.cls === 'refund' ? 'processing' : 'none');
      // 일부 상품만 환불: 그 상품들만 보여주고 금액도 그 상품 금액만 (주문 전체 금액으로 대신하지 않는다)
      const keys = partial ? new Set(o.refund.keys || []) : null;
      const its = keys ? (o.items || []).filter((it) => keys.has(AES.itemKey(it))) : (o.items || []);
      const itemSum = its.reduce((sum, it) => sum + (it.price ? it.price.amount * (qtyOf(it)) : 0), 0);
      // 환불 금액: ① 사이트가 표시한 환불 금액(또는 환불된 상품 금액) ② 실제 결제한 총 금액 ③ (둘 다 없을 때만) 상품 표시가 합계
      const shown = o.refund && o.refund.amount ? o.refund.amount : null;
      const amtSrc = shown ? (o.refund.amountSrc || 'shown') : partial ? 'item' : o.total ? 'paid' : 'list';
      const rawAmt = shown || (partial ? null : o.total) || (itemSum ? { amount: itemSum, currency: (its.find((it) => it.price) || {}).price.currency || primary } : null);
      const amt = conv(rawAmt);
      if (amt) addTo(refundSum[st], amt.currency, amt.amount);
      refundCount[st]++;
      const first = its[0] || {};
      refunds.push({
        orderId: o.id, date: o.date, state: st, title: its.map((it) => it.title).join(' / ') || '(상품명 확인 불가)',
        image: first.image || '', url: first.url || '', amount: amt, amountSrc: amtSrc, text: (o.refund && o.refund.text) || '', payment: o.payment || '',
        partial, estimated: !!(rawAmt && amt && (rawAmt.currency || primary) !== primary && amt.currency === primary)   // 다른 통화를 환율로 환산한 금액
      });
    }
    const order = { processing: 0, done: 1, none: 2 };
    refunds.sort((a, b) => order[a.state] - order[b.state] || ((b.date || '') > (a.date || '') ? 1 : -1));

    // 구매자 보호 기간 임박 (배송 전·배송 중 주문)
    const protectDays = opts.protectDays != null ? opts.protectDays : 7;
    const protectSoon = [];
    for (const o of all) {
      if ((o.cls !== 'pending_ship' && o.cls !== 'shipping') || !o.protectEnd) continue;
      const left = Math.ceil((fromISO(o.protectEnd) - now) / DAY);
      if (left > protectDays) continue;
      const first = (o.items || [])[0] || {};
      protectSoon.push({ orderId: o.id, title: first.title || '(상품명 확인 불가)', image: first.image || '', protectEnd: o.protectEnd, daysLeft: left });
    }
    protectSoon.sort((a, b) => a.daysLeft - b.daysLeft);

    // 관세 면세 한도: 주문 1건이 한도 초과 / 같은 상점·같은 날 주문 합계가 한도 초과 (아직 도착 전인 주문만)
    const limit = opts.customsLimit || 150;
    const krwPerUsd = (primary === 'KRW' && rates.USD) || opts.fallbackKrwPerUsd || 1400;
    const toUsd = (m) => { if (!m) return null; const c = m.currency || primary; if (c === 'USD') return m.amount; if (c === 'KRW') return m.amount / krwPerUsd; const p = conv(m); return p && p.currency === 'KRW' ? p.amount / krwPerUsd : null; };
    const customs = { limit, krwPerUsd: Math.round(krwPerUsd), approxRate: !(primary === 'KRW' && rates.USD), single: [], groups: [] };
    const groups = new Map();
    for (const o of all) {
      if (o.cls !== 'pending_ship' && o.cls !== 'shipping') continue;
      if (o.site === 'taobao' && !o.detailAt) continue;   // 배송 방식을 알기 전의 타오바오 주문은 판단하지 않는다
      if (o.noCustoms) continue;                          // 배송대행지로 가는 주문(타오바오 등)은 한국 관세 대상이 아니다
      const usd = toUsd(o.total);
      if (usd == null) continue;
      const first = (o.items || [])[0] || {};
      if (usd > limit) customs.single.push({ orderId: o.id, title: first.title || '', usd });
      if (o.store && o.date) {
        const k = o.store + '|' + String(o.date).slice(0, 10);
        const g = groups.get(k) || { store: o.store, date: String(o.date).slice(0, 10), usd: 0, orderIds: [] };
        g.usd += usd; g.orderIds.push(o.id); groups.set(k, g);
      }
    }
    for (const g of groups.values()) if (g.orderIds.length >= 2 && g.usd > limit) customs.groups.push(g);
    customs.count = customs.single.length + customs.groups.length;

    // 상점별: 주문 수, 결제액(기본 통화), 취소 수
    const storeMap = new Map();
    for (const o of all) {
      if (!o.store) continue;
      const st = storeMap.get(o.store) || { name: o.store, orders: 0, spend: 0, cancelled: 0 };
      if (o.cls === 'cancelled' || o.cls === 'refund') st.cancelled++;
      else if (o.cls !== 'unpaid' && o.cls !== 'event') {
        st.orders++;
        const t = conv(o.total);
        if (t && t.currency === primary) st.spend += t.amount;
      }
      storeMap.set(o.store, st);
    }
    const stores = [...storeMap.values()].filter((x) => x.orders > 0).sort((a, b) => b.orders - a.orders || b.spend - a.spend).slice(0, 10);

    // 실제 배송 소요일: 배송 완료 시점이 기록된 주문
    const dDays = [], etaDiff = [], byStore = new Map();
    for (const o of all) {
      if (o.cls !== 'delivered' || !o.deliveredAt || !o.date) continue;
      const days = Math.round((fromISO(o.deliveredAt) - fromISO(String(o.date).slice(0, 10))) / DAY);
      if (!(days >= 0 && days < 200)) continue;
      dDays.push(days);
      if (o.eta && o.eta.end) etaDiff.push(Math.round((fromISO(String(o.deliveredAt).slice(0, 10)) - fromISO(String(o.eta.end).slice(0, 10))) / DAY));
      if (o.store) { const b = byStore.get(o.store) || []; b.push(days); byStore.set(o.store, b); }
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const delivery = {
      count: dDays.length, avgDays: avg(dDays), medianDays: dDays.length ? median(dDays) : null,
      etaCount: etaDiff.length, etaDiffAvg: avg(etaDiff),
      byStore: [...byStore.entries()].filter(([, v]) => v.length >= 2).map(([name, v]) => ({ name, n: v.length, avgDays: avg(v) })).sort((a, b) => b.n - a.n).slice(0, 6)
    };

    const categories = [...catMap.values()].sort((a, b) => b.count - a.count);
    purchases.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));

    return {
      primary, rates, estimatedRates: est,
      orderCount: valid.length, totalOrders: all.length, itemCount, primaryOrders,
      spent, discount, discountOrders,
      statusOrders, statusItems,
      inProgress, shipGroups,
      delivered, deliveredItems: delivered.reduce((s, r) => s + r.qty, 0),
      inProgressItems: inProgress.reduce((s, r) => s + r.qty, 0),
      pendingItems: inProgress.filter((r) => r.status === 'pending_ship').reduce((s, r) => s + r.qty, 0),
      shippingItems: inProgress.filter((r) => r.status === 'shipping').reduce((s, r) => s + r.qty, 0),
      etaMissingOrders: [...new Set(inProgress.filter((r) => !r.etaEnd).map((r) => r.orderId))],
      refunds, refundSum, refundCount, protectSoon, customs, stores, delivery,
      categories, keywords: topKeywords(titles, 20),
      monthly: [...monthly.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
      purchases
    };
  }


  /** 저장된 설정 → computeStats 옵션 (콘텐츠 스크립트와 백그라운드가 같은 기준으로 계산) */
  function statsOptions(settings, extra) {
    const s = settings || {};
    return Object.assign({
      rates: s.usdRate > 0 ? { USD: s.usdRate } : {}, catOverrides: s.catOverrides || {},
      protectDays: s.protectDays != null ? s.protectDays : 7, customsLimit: s.customsLimit || 150
    }, extra || {});
  }

  Object.assign(AES, { qtyOf, TOPUP_RE, statsOptions, CATEGORIES, categorize, isTicket, groupByTracking,  STOP, topKeywords, addTo, normTitle, median, primaryCurrency, estimateRates, computeStats });
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
