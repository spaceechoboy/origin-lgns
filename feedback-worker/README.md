# origin-feedback — 제안·문의 폼 백엔드

`contact.html`의 제안·문의 폼이 여기로 POST하면, **Resend REST API**로
`contact@awakeorigin.direct`에 메일을 보냅니다. 방문자 메일 앱을 열지 않고 사이트에서 바로 전송됩니다.

> **왜 Resend?** CF 네이티브 Email Sending은 **Workers 유료 플랜($5/월)** 필요.
> Resend는 무료 한도(월 3,000통)로 충분하고, 워커는 **Workers Free 플랜 그대로** 동작합니다
> (Resend는 바인딩이 아니라 `fetch` 호출이라 유료 불필요).

- 발신: `noreply@awakeorigin.direct` (Resend에서 From 인증된 주소)
- 수신: `contact@awakeorigin.direct` (Email Routing이 실제 받은편지함으로 포워딩)
- 회신: 방문자가 이메일을 적었으면 `Reply-To`로 설정 → 답장 시 바로 그 주소로

---

## 배포 (당신 Cloudflare 계정에서)

> 모든 명령은 이 `feedback-worker/` 폴더에서. 로그인은 이미 됨(`wrangler login`).

### 1) Resend 키를 워커 시크릿으로 주입
keychain 항목 `resend-origin-send`의 발송전용 키를 붙여넣습니다:
```bash
cd ~/origin-lgns/feedback-worker
npx wrangler secret put RESEND_API_KEY
# 프롬프트에 키 붙여넣기 (예: re_xxx...)
```
키 확인(맥 keychain):
```bash
security find-generic-password -s resend-origin-send -w
```

### 2) 배포
```bash
npx wrangler deploy
```
- URL은 이미 `https://origin-feedback.awakeorigindirect.workers.dev` (contact.html에 연결됨).

### 3) 전송 테스트 (프런트 push 전에!)
```bash
curl -s -X POST https://origin-feedback.awakeorigindirect.workers.dev \
  -H "content-type: application/json" \
  -H "Origin: https://spaceechoboy.github.io" \
  -d '{"type":"일반 문의","email":"dldmawnf@gmail.com","message":"워커 전송 테스트"}'
```
- 기대: `{"ok":true}` + `contact@awakeorigin.direct` 받은편지함에 도착.
- `{"ok":false,"error":"send",...detail...}` 면 → Resend 응답의 `detail`을 확인(대개 From 미인증/키 권한).
- `error:"config"` → 1) 시크릿 미설정.

### 4) 프런트 push
```bash
cd ~/origin-lgns && git push
```

### 5) 수신 확인
`contact@awakeorigin.direct`가 Email Routing으로 **실제 받은편지함(예: Gmail)**으로
포워딩되는지 대시보드에서 확인(없으면 규칙 추가). 라이브 폼에서 1건 제출 → 도착 확인.

---

## (선택) Turnstile 스팸 방지 강화

기본은 **허니팟**(숨은 필드)만으로 봇 대부분을 거릅니다. 더 강하게:

1. Cloudflare 대시보드 → Turnstile → 위젯 생성(도메인 `spaceechoboy.github.io` 추가)
   → **사이트키**(공개) · **시크릿키** 획득.
2. `npx wrangler secret put TURNSTILE_SECRET` (설정되면 워커가 자동으로 토큰 검증).
3. `../contact.html`의 `CFG.turnstileSitekey`에 사이트키 입력 → 위젯이 폼에 표시.

---

## 사전 조건 (이미 되어 있어야 함)
- Resend에 `awakeorigin.direct` 도메인 인증(DKIM) + `noreply@awakeorigin.direct` From 발신 가능.
- `contact@awakeorigin.direct` Email Routing 규칙이 실제 받은편지함으로 포워딩.

CORS 허용 출처·발신/수신 주소는 `src/worker.js` 상단 상수에서 조정합니다.
