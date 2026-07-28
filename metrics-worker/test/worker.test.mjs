// metrics-worker 계약 테스트. 실행: node --test metrics-worker/test/
// D1은 가짜 객체로 대체한다 — 실제 DB에 쓰지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ORIGIN = 'https://spaceechoboy.github.io';
const ctx = { waitUntil(p) { return p; } };

function hit(body, { origin = ORIGIN, ua = 'Mozilla/5.0', ip = '1.2.3.4' } = {}) {
  return new Request('https://m.dev/', {
    method: 'POST',
    headers: { Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': ip, 'CF-IPCountry': 'KR' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('정상 수집 요청은 204 + CORS 헤더', async () => {
  const res = await worker.fetch(hit({ site: 'origin-lgns', page: 'index', ev: 'view' }), {}, ctx);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('허용 목록 밖 Origin은 403', async () => {
  const res = await worker.fetch(hit({ ev: 'view' }, { origin: 'https://evil.example' }), {}, ctx);
  assert.equal(res.status, 403);
});

test('OPTIONS 프리플라이트는 204', async () => {
  const res = await worker.fetch(new Request('https://m.dev/', {
    method: 'OPTIONS', headers: { Origin: ORIGIN },
  }), {}, ctx);
  assert.equal(res.status, 204);
});

test('본문 1KB 초과는 413', async () => {
  const res = await worker.fetch(hit('x'.repeat(1100)), {}, ctx);
  assert.equal(res.status, 413);
});

test('깨진 JSON은 400', async () => {
  const res = await worker.fetch(hit('{nope'), {}, ctx);
  assert.equal(res.status, 400);
});

test('봇 UA는 조용히 204(기록 없음)', async () => {
  const res = await worker.fetch(hit({ ev: 'view' }, { ua: 'Googlebot/2.1' }), {}, ctx);
  assert.equal(res.status, 204);
});

test('모르는 경로는 404', async () => {
  const res = await worker.fetch(new Request('https://m.dev/nope'), {}, ctx);
  assert.equal(res.status, 404);
});

import { normalize } from '../src/worker.js';

const META = { now: Date.UTC(2026, 6, 28, 5, 0, 0), country: 'KR', ua: 'Mozilla/5.0 (Macintosh)' };

test('정규화: 화이트리스트 값은 통과', () => {
  const r = normalize({ page: 'rates', ev: 'rates:refresh', ref: 't.me', mode: 'app' }, META);
  assert.equal(r.day, '2026-07-28');
  assert.equal(r.ts, Math.floor(META.now / 1000));
  assert.equal(r.site, 'origin-lgns');
  assert.equal(r.page, 'rates');
  assert.equal(r.ev, 'rates:refresh');
  assert.equal(r.ref, 't.me');
  assert.equal(r.mode, 'app');
  assert.equal(r.country, 'KR');
  assert.equal(r.device, 'desktop');
});

test('정규화: 화이트리스트 밖 이벤트·페이지는 "기타"', () => {
  const r = normalize({ page: 'admin', ev: 'steal:keys', mode: 'x' }, META);
  assert.equal(r.page, '기타');
  assert.equal(r.ev, '기타');
  assert.equal(r.mode, 'web');
});

test('★금지 필드 회귀: 지갑주소·잔액·쿼리는 결과에 존재하지 않는다', () => {
  const r = normalize({
    page: 'index', ev: 'view',
    addr: '0xC7Ed57d3fb98e4Ee5ADd4b8F6A0AD9E86eCbe6d1',
    balance: 4851.23, query: '?wallet=0xabc', extra: 'x',
  }, META);
  assert.deepEqual(Object.keys(r).sort(),
    ['country', 'day', 'device', 'ev', 'mode', 'page', 'ref', 'site', 'ts']);
  assert.ok(!JSON.stringify(r).includes('0xC7Ed'), '주소가 어떤 필드로도 새면 안 됨');
  assert.ok(!JSON.stringify(r).includes('4851'), '잔액이 새면 안 됨');
});

test('★referrer는 호스트만 — 전체 URL이 와도 경로·쿼리가 잘린다', () => {
  const r = normalize({ page: 'index', ev: 'view', ref: 'https://t.me/room?wallet=0xabc#x' }, META);
  assert.equal(r.ref, 't.me');
});

test('기기 판정: 모바일 UA', () => {
  const r = normalize({ page: 'index', ev: 'view' }, { ...META, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  assert.equal(r.device, 'mobile');
});

import { makeVid, isInternal } from '../src/worker.js';

test('vid: 같은 날·같은 IP·UA면 같은 값, 16자 hex', async () => {
  const a = await makeVid('2026-07-28', 'salt', '1.2.3.4', 'UA');
  const b = await makeVid('2026-07-28', 'salt', '1.2.3.4', 'UA');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('★vid: 날짜가 바뀌면 다른 값 — 장기 추적 불가가 설계 의도', async () => {
  const a = await makeVid('2026-07-28', 'salt', '1.2.3.4', 'UA');
  const b = await makeVid('2026-07-29', 'salt', '1.2.3.4', 'UA');
  assert.notEqual(a, b);
});

test('vid: IP나 UA가 다르면 다른 값', async () => {
  const a = await makeVid('2026-07-28', 'salt', '1.2.3.4', 'UA');
  assert.notEqual(a, await makeVid('2026-07-28', 'salt', '9.9.9.9', 'UA'));
  assert.notEqual(a, await makeVid('2026-07-28', 'salt', '1.2.3.4', 'OTHER'));
});

test('vid: 솔트가 다르면 다른 값(솔트 유출 시 역산 방어)', async () => {
  assert.notEqual(
    await makeVid('2026-07-28', 'salt-a', '1.2.3.4', 'UA'),
    await makeVid('2026-07-28', 'salt-b', '1.2.3.4', 'UA'));
});

test('내부 IP 판정: 목록에 있으면 true, 공백 허용', () => {
  assert.equal(isInternal('222.98.140.185', '1.1.1.1, 222.98.140.185'), true);
  assert.equal(isInternal('8.8.8.8', '1.1.1.1, 222.98.140.185'), false);
  assert.equal(isInternal('8.8.8.8', undefined), false);
  assert.equal(isInternal('', '1.1.1.1'), false);
});
