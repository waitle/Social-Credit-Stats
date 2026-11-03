// 디버그 파일(실제 알리 응답)을 공개 저장소에 넣을 수 있는 테스트 데이터로 정제한다.
// 구조와 형식(키 이름, 중첩, 금액/날짜 표기, 상태·환불 문구)은 유지하고 개인을 알 수 있는 값은 모두 바꾼다.
//   - 주문/상품/결제 번호 → 가짜 번호 (일관되게 매핑)
//   - 상품명/상점명/옵션 → "상품 1", "Store 1", "옵션"
//   - URL/이미지 → example.invalid, 토큰/서명/추적 ID → 자리표시자
//   - 금액 → 같은 비율(0.8)로 조정, 날짜 → 14일 앞당김
// 사용: node tests/tools/sanitize.cjs <debug.json> <capture url 정규식> > fixture.json
'use strict';
const fs = require('fs');

const [, , file, capRe = 'order\\.list|mtopjsonp1'] = process.argv;
const dbg = JSON.parse(fs.readFileSync(file, 'utf8'));
const caps = (dbg.apiCaptures || []).filter((c) => new RegExp(capRe).test(c.url));

const idMap = new Map(), titleMap = new Map(), storeMap = new Map();
const fakeId = (real) => { if (!idMap.has(real)) idMap.set(real, (real.startsWith('1005') ? '1005' : '1123') + String(100000000000 + idMap.size * 7919).padStart(real.length - 4, '0')); return idMap.get(real); };
const mapTitle = (t) => { if (!titleMap.has(t)) titleMap.set(t, `상품 ${titleMap.size + 1}`); return titleMap.get(t); };
const mapStore = (t) => { if (!storeMap.has(t)) storeMap.set(t, `Store ${storeMap.size + 1}`); return storeMap.get(t); };

const SCALE = 0.8;
function scaleMoney(s) {
  return s.replace(/(₩|US \$|\$)\s?([\d,]+(?:\.\d+)?)/g, (m, sym, num) => {
    const v = parseFloat(num.replace(/,/g, '')) * SCALE;
    return sym + (sym === '₩' ? Math.round(v).toLocaleString('en-US') : v.toFixed(2));
  });
}
function shiftDate(s) {
  return s.replace(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g, (m, y, mo, d) => {
    const t = new Date(+y, +mo - 1, +d - 14);
    return `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일`;
  });
}

const DROP = /^(paymentOutId|sellerConnectUrl|utParams|traceId|spm-cnt|credentialUrl|credentialIcon|shopIcon|storePageUrl|features|skuAttrKeys|skuId|tci)$/;
const TOKEN = /^(queryParams|submitParams|validateParams|signature)$/;
const TITLE = /^(itemTitle|productTitle|subject|title)$/;

function clean(node, key) {
  if (Array.isArray(node)) return node.map((x) => clean(x, key));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP.test(k)) continue;
      const nk = k.replace(/\d{12,20}/g, fakeId);
      out[nk] = clean(v, k);
    }
    return out;
  }
  if (typeof node === 'number') return /^\d{12,20}$/.test(String(node)) ? Number(fakeId(String(node))) : node;
  if (typeof node !== 'string') return node;
  let s = node;
  if (TOKEN.test(key)) return `TOKEN_${key}`;
  if (key === 'storeName') return mapStore(s);
  if (TITLE.test(key) && !/^(환불|refund)/i.test(s) && s.length > 12) return mapTitle(s);
  if (key === 'text' && /^(Color|Bundle|Material|Size|옵션)/i.test(String(key))) return '옵션';
  if (/^(https?:)?\/\//.test(s)) {
    const id = (s.match(/(\d{12,20})/) || [])[1];
    return /\.(jpg|jpeg|png|webp|gif)/i.test(s) ? 'https://example.invalid/img.jpg' : `https://example.invalid/${id ? 'x/' + fakeId(id) : 'x'}`;
  }
  s = s.replace(/https?:\/\/[^\s"'\\<>]+/g, 'https://example.invalid/x');   // 문장/HTML 안의 주소
  s = s.replace(/\d{12,20}/g, fakeId);
  s = scaleMoney(s);
  if (key === 'formatPriceInfo') { const m = s.match(/^(.*?)\|/); if (m) s = `${m[1]}|${m[1].replace(/[^\d.]/g, '').replace('.', '|')}`; }
  s = shiftDate(s);
  return s;
}

const out = caps.map((c) => {
  const json = JSON.parse(c.text);
  // 옵션 텍스트(skuAttrs[].text)는 구매 상품을 드러내므로 일반 문구로
  (function walk(n) { if (n && typeof n === 'object') { if (Array.isArray(n.skuAttrs)) n.skuAttrs = n.skuAttrs.map((a) => ({ ...a, name: '옵션 이름', text: '옵션' })); for (const v of Object.values(n)) walk(v); } })(json);
  return { url: 'fixture:' + (c.url.match(/mtop\.[\w.]+|jsonp:\w+/) || ['capture'])[0], text: JSON.stringify(clean(json)) };
});
process.stdout.write(JSON.stringify({ note: '실제 알리 응답 구조를 정제한 테스트 데이터 (개인 정보 없음)', captures: out }, null, 1) + '\n');
