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
    ['country', 'day', 'device', 'ev', 'mode', 'page', 'ref', 'region', 'site', 'ts']);
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

test('지역: CF region이 오면 저장, 없으면 빈 값 — IP 원본과 무관한 시/도 수준', () => {
  assert.equal(normalize({ page: 'index', ev: 'view' }, { ...META, region: 'Seoul' }).region, 'Seoul');
  assert.equal(normalize({ page: 'index', ev: 'view' }, META).region, '');
  assert.equal(normalize({ page: 'index', ev: 'view' }, { ...META, region: 'x'.repeat(99) }).region.length, 40);
});

import { makeVid, isInternal, record } from '../src/worker.js';

test('vid: 같은 달·같은 IP·UA면 같은 값, 16자 hex', async () => {
  const a = await makeVid('2026-07', 'salt', '1.2.3.4', 'UA');
  const b = await makeVid('2026-07', 'salt', '1.2.3.4', 'UA');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('★vid: 달이 바뀌면 다른 값 — 달을 넘는 추적 불가가 설계 의도', async () => {
  const a = await makeVid('2026-07', 'salt', '1.2.3.4', 'UA');
  const b = await makeVid('2026-08', 'salt', '1.2.3.4', 'UA');
  assert.notEqual(a, b);
});

test('vid: IP나 UA가 다르면 다른 값', async () => {
  const a = await makeVid('2026-07', 'salt', '1.2.3.4', 'UA');
  assert.notEqual(a, await makeVid('2026-07', 'salt', '9.9.9.9', 'UA'));
  assert.notEqual(a, await makeVid('2026-07', 'salt', '1.2.3.4', 'OTHER'));
});

test('vid: 솔트가 다르면 다른 값(솔트 유출 시 역산 방어)', async () => {
  assert.notEqual(
    await makeVid('2026-07-a', 'salt-a', '1.2.3.4', 'UA'),
    await makeVid('2026-07-a', 'salt-b', '1.2.3.4', 'UA'));
});

test('★record: 같은 달의 다른 날이면 같은 vid — MAU 집계의 근거', async () => {
  const seen = [];
  const env = {
    DB: { prepare: (sql) => ({ bind: (...a) => ({
      first: async () => ({ n: 0 }),
      run: async () => { if (sql.startsWith('INSERT')) seen.push(a[5]); },
    }) }) },
    VID_SALT: 'salt',
  };
  const base = { ts: 0, site: 'origin-lgns', page: 'index', ev: 'view',
                 country: 'KR', device: 'mobile', mode: 'web', ref: '' };
  await record(env, { ...base, day: '2026-08-01' }, '1.2.3.4', 'UA');
  await record(env, { ...base, day: '2026-08-31' }, '1.2.3.4', 'UA');
  await record(env, { ...base, day: '2026-09-01' }, '1.2.3.4', 'UA');
  assert.equal(seen[0], seen[1]);       // 같은 달 → 한 사람으로 집계
  assert.notEqual(seen[1], seen[2]);    // 달이 바뀌면 리셋
});

test('내부 IP 판정: 목록에 있으면 true, 공백 허용', () => {
  assert.equal(isInternal('222.98.140.185', '1.1.1.1, 222.98.140.185'), true);
  assert.equal(isInternal('8.8.8.8', '1.1.1.1, 222.98.140.185'), false);
  assert.equal(isInternal('8.8.8.8', undefined), false);
  assert.equal(isInternal('', '1.1.1.1'), false);
});

/* 가짜 D1 — prepare().bind().run()/first() 만 흉내낸다. */
function fakeDB(counts = 0) {
  const inserts = [], queries = [];
  return {
    inserts, queries,
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...args) {
          return {
            async run() { if (/^INSERT/i.test(sql.trim())) inserts.push({ sql, args }); return { success: true }; },
            async first() { return { n: counts }; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
}
const ENV = (db, extra = {}) => ({ DB: db, VID_SALT: 'test-salt', ...extra });

async function send(body, opts = {}, env) {
  const pending = [];
  const c = { waitUntil(p) { pending.push(p); } };
  const res = await worker.fetch(hit(body, opts), env, c);
  await Promise.all(pending);
  return res;
}

test('수집: D1에 1행 INSERT — 컬럼 순서와 값', async () => {
  const db = fakeDB();
  await send({ page: 'rates', ev: 'rates:refresh', ref: 't.me', mode: 'app' }, {}, ENV(db));
  assert.equal(db.inserts.length, 1);
  const a = db.inserts[0].args;
  assert.equal(a[2], 'origin-lgns');       // site
  assert.equal(a[3], 'rates');             // page
  assert.equal(a[4], 'rates:refresh');     // ev
  assert.match(a[5], /^[0-9a-f]{16}$/);    // vid
  assert.equal(a[6], 'KR');                // country
  assert.equal(a[8], 'app');               // mode
  assert.equal(a[9], 't.me');              // ref
  assert.equal(a[10], 0);                  // internal
  assert.equal(a[11], '');                 // region (테스트 Request엔 cf가 없다)
  assert.equal(a.length, 12);
});

test('★금지 필드 회귀: 지갑주소를 보내도 D1 인자에 존재하지 않는다', async () => {
  const db = fakeDB();
  await send({ page: 'index', ev: 'view', addr: '0xC7Ed57d3fb98', balance: 4851 }, {}, ENV(db));
  assert.ok(!JSON.stringify(db.inserts[0].args).includes('0xC7Ed'));
  assert.ok(!JSON.stringify(db.inserts[0].args).includes('4851'));
});

test('내부 IP는 드롭이 아니라 internal=1로 기록', async () => {
  const db = fakeDB();
  await send({ page: 'index', ev: 'view' }, { ip: '222.98.140.185' },
    ENV(db, { INTERNAL_IPS: '222.98.140.185' }));
  assert.equal(db.inserts[0].args[10], 1);
});

test('클라이언트 internal 힌트도 1로 기록(서버 판정과 OR)', async () => {
  const db = fakeDB();
  await send({ page: 'index', ev: 'view', internal: 1 }, {}, ENV(db));
  assert.equal(db.inserts[0].args[10], 1);
});

test('같은 vid의 당일 300건 초과분은 드롭(무료 한도 방어)', async () => {
  const db = fakeDB(300);
  await send({ page: 'index', ev: 'view' }, {}, ENV(db));
  assert.equal(db.inserts.length, 0);
});

test('D1 바인딩이 없어도 요청은 204(앱을 절대 방해하지 않는다)', async () => {
  const res = await send({ page: 'index', ev: 'view' }, {}, { VID_SALT: 's' });
  assert.equal(res.status, 204);
});

test('D1이 던져도 요청은 204', async () => {
  const db = { prepare() { throw new Error('D1 down'); } };
  const res = await send({ page: 'index', ev: 'view' }, {}, ENV(db));
  assert.equal(res.status, 204);
});

import { tokenOk } from '../src/worker.js';

/* 집계용 가짜 D1 — SQL 조각으로 결과를 골라 돌려준다. */
function statsDB(sink = []) {
  return {
    prepare(sql) {
      return { bind(...args) {
        sink.push({ sql, args });
        return {
          async first() { return { views: 10, visitors: 4 }; },
          async all() {
            if (/GROUP BY day/.test(sql)) return { results: [{ day: '2026-07-28', views: 10, visitors: 4 }] };
            return { results: [{ k: 'index', n: 7 }] };
          },
        };
      } };
    },
  };
}

test('/stats: 토큰 없으면 401', async () => {
  const res = await worker.fetch(new Request('https://m.dev/stats'), ENV(statsDB()), ctx);
  assert.equal(res.status, 401);
});

test('/stats: 토큰 틀리면 401', async () => {
  const res = await worker.fetch(new Request('https://m.dev/stats?k=wrong'),
    ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal(res.status, 401);
});

test('/stats: 올바른 토큰이면 집계 JSON', async () => {
  const res = await worker.fetch(new Request('https://m.dev/stats?k=right&days=7'),
    ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.days, 7);
  assert.deepEqual(j.totals, { views: 10, visitors: 4 });
  assert.deepEqual(j.daily, [{ day: '2026-07-28', views: 10, visitors: 4 }]);
  assert.ok(Array.isArray(j.countries) && Array.isArray(j.events));
  assert.ok(Array.isArray(j.hourly) && Array.isArray(j.regions) && Array.isArray(j.monthly));
});

test('★기본은 자기 트래픽 제외(internal<=0), internal=1이면 포함', async () => {
  const sink = [];
  await worker.fetch(new Request('https://m.dev/stats?k=right'), ENV(statsDB(sink), { DASH_KEY: 'right' }), ctx);
  assert.ok(sink.every((q) => q.args[1] === 0), '기본 bind는 0');

  const sink2 = [];
  await worker.fetch(new Request('https://m.dev/stats?k=right&internal=1'), ENV(statsDB(sink2), { DASH_KEY: 'right' }), ctx);
  assert.ok(sink2.every((q) => q.args[1] === 1), 'internal=1이면 bind 1');
});

test('days는 1~90으로 클램프', async () => {
  const big = await worker.fetch(new Request('https://m.dev/stats?k=right&days=9999'), ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal((await big.json()).days, 90);
  const zero = await worker.fetch(new Request('https://m.dev/stats?k=right&days=0'), ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal((await zero.json()).days, 14, '0이나 빈 값은 기본 14일');
});

test('토큰 비교는 길이가 달라도 예외 없이 false', () => {
  assert.equal(tokenOk('a', 'abc'), false);
  assert.equal(tokenOk(undefined, 'abc'), false);
  assert.equal(tokenOk('abc', ''), false);
  assert.equal(tokenOk('abc', 'abc'), true);
});

import { renderDash } from '../src/worker.js';

const DATA = {
  days: 14, since: '2026-07-15', internal: 0,
  totals: { views: 120, visitors: 45 },
  daily: [{ day: '2026-07-28', views: 10, visitors: 4 }],
  hourly: [{ k: '21', views: 6, visitors: 3 }],
  regions: [{ k: 'KR·Seoul', n: 22 }],
  pages: [{ k: 'index', n: 80 }], countries: [{ k: 'US', n: 50 }],
  devices: [{ k: 'mobile', n: 90 }], modes: [{ k: 'app', n: 30 }],
  refs: [{ k: 't.me', n: 12 }], events: [{ k: 'rates:refresh', n: 9 }],
};

test('/dash: 토큰 없으면 401', async () => {
  const res = await worker.fetch(new Request('https://m.dev/dash'), ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal(res.status, 401);
});

test('/dash: HTML과 보호 헤더를 함께 준다', async () => {
  const res = await worker.fetch(new Request('https://m.dev/dash?k=right'), ENV(statsDB(), { DASH_KEY: 'right' }), ctx);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
});

test('렌더: 핵심 수치가 HTML에 들어간다', () => {
  const html = renderDash(DATA, 'right');
  assert.match(html, /120/);            // 총 조회
  assert.match(html, /45/);             // 고유 방문자
  assert.match(html, /rates:refresh/);
  assert.match(html, /t\.me/);
  assert.match(html, /KR·Seoul/);       // 지역
});

test('렌더: 시간대는 KST 24행으로 채워진다(빈 시간 0 포함)', () => {
  const html = renderDash(DATA, 'right');
  assert.match(html, /21시/);
  assert.match(html, /00시/);           // 데이터 없는 시간대도 행이 있어야 분포가 보인다
  assert.equal((html.match(/"k">\d\d시</g) || []).length, 24);
});

test('★XSS 회귀: 오염된 ref가 그대로 실행되지 않는다', () => {
  const html = renderDash({ ...DATA, refs: [{ k: '<script>alert(1)</script>', n: 1 }] }, 'right');
  assert.ok(!html.includes('<script>alert(1)</script>'), '원문 태그가 살아 있으면 안 됨');
  assert.match(html, /&lt;script&gt;/);
});

test('렌더: 내부 트래픽 토글 링크가 현재 토큰을 유지한다', () => {
  const html = renderDash(DATA, 'right');
  assert.match(html, /\/dash\?k=right&days=14&internal=1/);
});
