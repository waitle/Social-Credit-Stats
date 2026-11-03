// 알리 주문 통계 - 종단간 암호화 백업
// 비밀번호 → PBKDF2(SHA-256, 310,000회) → 512비트
//   앞 256비트: AES-GCM 키 (브라우저 밖으로 나가지 않음)
//   뒤 256비트: 서버 ID / 쓰기 토큰을 만드는 재료 (서버는 ID 와 토큰의 해시만 안다)
// 서버에는 "AESB1" + IV(12바이트) + 암호문(gzip 된 JSON) 만 저장된다. 서버는 내용을 복호화할 수 없다.
(function (g) {
  'use strict';
  const AES = g.AES || (g.AES = {});
  const enc = new TextEncoder(), dec = new TextDecoder();
  const MAGIC = enc.encode('AESB1');
  const SALT = enc.encode('aliexpress-stats/backup/v1');
  const ITER = 310000;

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const concat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const sha256 = async (bytes) => new Uint8Array(await g.crypto.subtle.digest('SHA-256', bytes));

  async function streamBytes(bytes, stream) {
    const s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /** 비밀번호 → { key, id, token } */
  async function deriveBackupKeys(passphrase, iterations) {
    if (!passphrase || passphrase.length < 8) throw new Error('비밀번호는 8자 이상이어야 합니다');
    const base = await g.crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await g.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: iterations || ITER }, base, 512));
    const key = await g.crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const material = bits.slice(32);
    return { key, id: hex(await sha256(concat(enc.encode('id:'), material))), token: hex(await sha256(concat(enc.encode('write:'), material))) };
  }

  async function sealBackup(obj, key) {
    const iv = g.crypto.getRandomValues(new Uint8Array(12));
    const plain = await streamBytes(enc.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
    const ct = new Uint8Array(await g.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
    return concat(MAGIC, iv, ct);
  }

  async function openBackup(bytes, key) {
    const b = new Uint8Array(bytes);
    if (b.length < 18 || dec.decode(b.slice(0, 5)) !== 'AESB1') throw new Error('백업 형식이 아닙니다');
    let plain;
    try { plain = new Uint8Array(await g.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(5, 17) }, key, b.slice(17))); }
    catch (_) { throw new Error('비밀번호가 다르거나 백업이 손상됐습니다'); }
    return JSON.parse(dec.decode(await streamBytes(plain, new DecompressionStream('gzip'))));
  }

  /** 서버 업로드/다운로드 */
  async function uploadBackup(base, keys, obj) {
    const body = await sealBackup(obj, keys.key);
    const r = await fetch(`${base}/v1/backup/${keys.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Write-Token': keys.token }, body });
    if (!r.ok) throw new Error(`업로드 실패 (${r.status})`);
    return body.length;
  }
  async function downloadBackup(base, keys) {
    const r = await fetch(`${base}/v1/backup/${keys.id}`, { cache: 'no-store' });
    if (r.status === 404) throw new Error('서버에 이 비밀번호의 백업이 없습니다');
    if (!r.ok) throw new Error(`다운로드 실패 (${r.status})`);
    return openBackup(new Uint8Array(await r.arrayBuffer()), keys.key);
  }

  Object.assign(AES, { deriveBackupKeys, sealBackup, openBackup, uploadBackup, downloadBackup });
  if (typeof module !== 'undefined' && module.exports) module.exports = AES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
