# origin-metrics — origin-lgns 접속·사용량 계측 워커

`assets/px.js` 비콘이 여기로 POST하면 D1 `hits` 테이블에 익명 1행을 남깁니다.
`GET /dash?k=<DASH_KEY>` 로 집계를 봅니다. 설계 근거는 vault
`30_Projects/origin-lgns-analytics-design-2026-07.md`.

## 수집하는 것 / 안 하는 것

- 수집: 페이지·이벤트명·유입 **호스트만**·국가(CF)·mobile|desktop·app|web·일일 익명 ID
- **미수집**: 지갑주소·잔액·입력값·쿼리스트링·전체 referrer·IP/UA 원본
- 일일 익명 ID = `SHA-256(날짜 + VID_SALT + IP + UA)` 앞 16자. 날짜가 바뀌면 같은 사람이
  다른 ID가 되어 장기 추적이 **구조적으로 불가능**합니다.

## 배포 (Workers Free 플랜)

```bash
cd ~/origin-lgns/metrics-worker
npx wrangler d1 create origin_metrics          # 출력된 database_id를 wrangler.jsonc에 기입
npx wrangler d1 execute origin_metrics --remote --file=schema.sql
npx wrangler secret put VID_SALT               # 임의 32바이트 문자열
npx wrangler secret put DASH_KEY               # 대시보드 토큰
npx wrangler secret put INTERNAL_IPS           # (선택) 자기 IP 콤마 목록
npx wrangler deploy
```

⚠ **워커를 먼저 배포하고 그 다음에 프런트를 push** 하세요. 순서가 뒤집히면
비콘이 404가 되고 그 기간 데이터가 유실됩니다(앱 동작에는 영향 없음).

## 자기 트래픽 제외

자기 트래픽은 삭제하지 않고 `internal=1`로 **표시만** 합니다(대시보드 기본 집계에서 제외).
- 서버측: 시크릿 `INTERNAL_IPS`의 IP와 일치
- 클라이언트측: 브라우저에서 `?px=off`로 한 번 방문하면 그 기기가 계속 내부로 표시

## 테스트

```bash
cd ~/origin-lgns && node --test metrics-worker/test/ test/
```
