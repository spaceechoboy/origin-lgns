// px.js와 worker.js의 이벤트 화이트리스트가 어긋나면, 프런트는 보내는데 서버가 "기타"로
// 뭉개 조용히 데이터가 사라진다. 그 회귀를 막는 계약 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pickEvents = (src) => JSON.parse(src.match(/EVENTS\s*=\s*(\[[^\]]*\])/)[1].replace(/'/g, '"'));

test('★px.js와 worker.js의 EVENTS 목록이 정확히 같다', () => {
  const front = pickEvents(read('../assets/px.js'));
  const back = pickEvents(read('../metrics-worker/src/worker.js'));
  assert.deepEqual(front, back);
});

test('배선된 이벤트가 전부 화이트리스트에 있다', () => {
  const wl = pickEvents(read('../assets/px.js'));
  const wired = [read('../rates.html'), read('../contact.html')]
    .join('\n').match(/px\.ev\(['"]([^'"]+)['"]\)/g) || [];
  const names = wired.map((s) => s.match(/px\.ev\(['"]([^'"]+)['"]\)/)[1]);
  assert.ok(names.length >= 4, '최소 4개 배선: ' + names.join(','));
  for (const n of names) assert.ok(wl.includes(n), `화이트리스트에 없는 이벤트: ${n}`);
});

test('★HTML 어디에서도 지갑주소·잔액을 px에 넘기지 않는다', () => {
  const html = [read('../index.html'), read('../rates.html'), read('../contact.html')].join('\n');
  const calls = html.match(/px\.ev\([^)]*\)/g) || [];
  for (const c of calls) {
    assert.match(c, /^px\.ev\(['"][a-z:]+['"]\)$/, `px.ev는 상수 이벤트명만 받는다: ${c}`);
  }
});
