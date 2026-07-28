// assets/px.js 페이로드 테스트. 브라우저 전역을 가짜 window로 주입해 node에서 평가한다.
// 실행: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../assets/px.js', import.meta.url), 'utf8');

function loadPx({ path = '/origin-lgns/index.html', search = '', ref = '', standalone = false, store = {} } = {}) {
  const sent = [];
  const g = {
    location: { pathname: path, search, hostname: 'spaceechoboy.github.io' },
    document: { referrer: ref },
    navigator: { sendBeacon: (url, blob) => { sent.push({ url, blob }); return true; } },
    matchMedia: () => ({ matches: standalone }),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } },
    addEventListener: () => {},
    fetch: () => Promise.resolve(),
  };
  new Function('window', SRC)(g);
  return { px: g.px, sent, store };
}

test('페이로드는 화이트리스트 필드만 담는다', () => {
  const { px } = loadPx();
  const p = px._build('view', { pathname: '/origin-lgns/rates.html', hostname: 'h' }, '', false, false);
  assert.deepEqual(Object.keys(p).sort(), ['ev', 'internal', 'mode', 'page', 'ref', 'site']);
  assert.equal(p.site, 'origin-lgns');
  assert.equal(p.page, 'rates');
  assert.equal(p.ev, 'view');
});

test('★referrer는 호스트만 — 경로·쿼리가 절대 실리지 않는다', () => {
  const { px } = loadPx();
  const p = px._build('view', { pathname: '/index.html', hostname: 'h' },
    'https://t.me/room?wallet=0xC7Ed57d3fb98', false, false);
  assert.equal(p.ref, 't.me');
  assert.ok(!JSON.stringify(p).includes('0xC7Ed'));
});

test('같은 출처 referrer는 빈 값(자기 이동은 유입이 아니다)', () => {
  const { px } = loadPx();
  const p = px._build('view', { pathname: '/index.html', hostname: 'spaceechoboy.github.io' },
    'https://spaceechoboy.github.io/origin-lgns/rates.html', false, false);
  assert.equal(p.ref, '');
});

test('설치형 PWA면 mode=app', () => {
  const { px } = loadPx({ standalone: true });
  assert.equal(px._build('view', { pathname: '/index.html', hostname: 'h' }, '', true, false).mode, 'app');
});

test('로드 시 view 비콘 1발', () => {
  const { sent } = loadPx();
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /origin-metrics\..*workers\.dev/);
});

test('★페이로드에 쿼리스트링이 실리지 않는다', async () => {
  const { sent } = loadPx({ search: '?wallet=0xC7Ed57d3fb98&x=1' });
  const body = await sent[0].blob.text();     // Blob은 node 18+ 전역
  assert.ok(!body.includes('0xC7Ed'), '쿼리스트링이 페이로드에 새면 안 됨');
  assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ['ev', 'internal', 'mode', 'page', 'ref', 'site']);
});

test('?px=off 방문은 내부 플래그를 세우고 이후 internal=1로 보낸다', () => {
  const { store } = loadPx({ search: '?px=off' });
  assert.equal(store.px_internal, '1');
  const { px } = loadPx({ store });
  assert.equal(px._build('view', { pathname: '/index.html', hostname: 'h' }, '', false, true).internal, 1);
});

test('화이트리스트 밖 이벤트명은 보내지 않는다', () => {
  const { px, sent } = loadPx();
  const before = sent.length;
  px.ev('steal:keys');
  assert.equal(sent.length, before, '알 수 없는 이벤트는 전송 금지');
});

test('★비콘이 터져도 예외가 페이지로 전파되지 않는다', () => {
  const sent = [];
  const g = {
    location: { pathname: '/index.html', search: '', hostname: 'h' },
    document: { referrer: '' },
    navigator: { sendBeacon: () => { throw new Error('blocked'); } },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    fetch: () => { throw new Error('blocked'); },
  };
  assert.doesNotThrow(() => new Function('window', SRC)(g));
  assert.doesNotThrow(() => g.px.ev('rates:refresh'));
  assert.equal(sent.length, 0);
});
