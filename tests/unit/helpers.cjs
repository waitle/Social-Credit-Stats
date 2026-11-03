'use strict';
const path = require('path');
const LIB = path.join(__dirname, '..', '..', 'aliexpress-stats', 'lib');
require(path.join(LIB, 'core.js'));
require(path.join(LIB, 'extract.js'));
require(path.join(LIB, 'stats.js'));
const AES = require(path.join(LIB, 'backup.js'));

/** 정제된 실제 응답 → 주문 맵 */
function loadFixture(name, ref) {
  const fx = require(path.join(__dirname, '..', 'fixtures', name + '.json'));
  const map = {};
  for (const c of fx.captures) {
    const j = AES.parseResponseText(c.text);
    for (const o of AES.extractFromJson(j, { ref })) map[o.id] = AES.mergeOrder(map[o.id], o);
  }
  return map;
}

module.exports = { AES, loadFixture };
