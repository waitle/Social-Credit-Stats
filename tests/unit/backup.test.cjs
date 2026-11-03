'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { AES } = require('./helpers.cjs');

test('암호화 백업: 같은 비밀번호 = 같은 ID, 왕복 일치, 다른 비밀번호 거부', async () => {
  const k1 = await AES.deriveBackupKeys('correct horse battery', 1000);
  const k2 = await AES.deriveBackupKeys('correct horse battery', 1000);
  const k3 = await AES.deriveBackupKeys('wrong password!!', 1000);
  assert.strictEqual(k1.id, k2.id);
  assert.notStrictEqual(k1.id, k3.id);
  assert.notStrictEqual(k1.id, k1.token);
  assert.match(k1.id, /^[0-9a-f]{64}$/);
  const data = { format: 'aliexpress-stats-backup', orders: { a: { id: 'a', title: '테스트'.repeat(500) } } };
  const blob = await AES.sealBackup(data, k1.key);
  assert.strictEqual(Buffer.from(blob.slice(0, 5)).toString(), 'AESB1');
  assert.ok(!Buffer.from(blob).includes(Buffer.from('테스트')), '암호문에 평문이 없어야 함');
  assert.deepStrictEqual(await AES.openBackup(blob, k2.key), data);
  await assert.rejects(() => AES.openBackup(blob, k3.key), /비밀번호/);
});

test('짧은 비밀번호 거부', async () => {
  await assert.rejects(() => AES.deriveBackupKeys('short'), /8자/);
});
