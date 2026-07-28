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
