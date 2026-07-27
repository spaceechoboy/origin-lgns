// feedback-worker/test/worker.test.mjs — 워커 계약 테스트. 실행: node --test feedback-worker/test/
// 외부 호출(Resend)은 globalThis.fetch 스텁으로 가로채 **메일이 실제로 나가지 않는다**.
// ★이 워커는 origin-lgns 폼과 origin-console 폼이 **같이** 쓴다(같은 인박스) —
//   그래서 `source`(출처 라벨)와 TYPES(유형 원문)가 두 클라이언트의 공유 계약이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ORIGIN = 'https://awakeorigin.direct'; // origin-console(apex)
const env = { RESEND_API_KEY: 'test-key' };

/* Resend 호출을 가로채 payload를 돌려준다. 실제 발송 없음. */
async function post(body) {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { sent.push({ url, body: JSON.parse(opt.body) }); return { ok: true, json: async () => ({ id: 'x' }) }; };
  try {
    const res = await worker.fetch(new Request('https://w.dev', {
      method: 'POST', headers: { 'content-type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body),
    }), env);
    return { res, json: await res.json(), sent };
  } finally { globalThis.fetch = real; }
}

test('출처 라벨: 폼이 보낸 source가 메일 본문에 실린다(같은 인박스에서 도구 구분)', async () => {
  const { json, sent } = await post({ type: '기타', message: '테스트', source: 'origin-console 문의하기' });
  assert.deepEqual(json, { ok: true });
  assert.equal(sent.length, 1, 'Resend 1회 호출');
  assert.match(sent[0].body.text, /출처: origin-console 문의하기/);
  assert.match(sent[0].body.html, /출처: origin-console 문의하기/);
});

test('하위호환: source 미전송이면 기존 라벨(origin-lgns) 유지 — 구 폼 무수정 동작', async () => {
  const { sent } = await post({ type: '기타', message: '테스트' });
  assert.match(sent[0].body.text, /출처: origin-lgns/);
});

test('★"결제 문의"가 유효 유형 — 콘솔 폼의 유형이 "기타"로 뭉개지지 않는다', async () => {
  const { sent } = await post({ type: '결제 문의', message: '결제가 안 됩니다', source: 'origin-console 문의하기' });
  assert.match(sent[0].body.subject, /\[결제 문의\]/);
  assert.match(sent[0].body.text, /유형: 결제 문의/);
});

test('알 수 없는 유형은 여전히 "기타"로 정규화(임의 문자열 주입 차단)', async () => {
  const { sent } = await post({ type: '<script>', message: 'x' });
  assert.match(sent[0].body.subject, /\[기타\]/);
});

test('출처 라벨도 이스케이프·길이 제한(HTML 주입 차단)', async () => {
  const { sent } = await post({ type: '기타', message: 'x', source: '<b>origin</b>' });
  assert.ok(!sent[0].body.html.includes('<b>origin</b>'), 'html에 원문 태그가 그대로 들어가면 안 됨');
  const { sent: s2 } = await post({ type: '기타', message: 'x', source: 'A'.repeat(200) });
  assert.ok(/출처: A{80}(?!A)/.test(s2[0].body.text), '80자 상한');
});

test('허니팟이 채워지면 발송 없이 성공처럼 응답(기존 동작 보존)', async () => {
  const { json, sent } = await post({ type: '기타', message: 'x', website: 'bot' });
  assert.deepEqual(json, { ok: true });
  assert.equal(sent.length, 0, 'Resend 미호출');
});

test('빈 내용은 400 empty(기존 동작 보존)', async () => {
  const { res, json, sent } = await post({ type: '기타', message: '   ' });
  assert.equal(res.status, 400);
  assert.equal(json.error, 'empty');
  assert.equal(sent.length, 0);
});
