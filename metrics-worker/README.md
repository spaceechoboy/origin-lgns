# origin-metrics — origin-lgns 접속·사용량 계측 워커

`assets/px.js` 비콘이 여기로 POST하면 D1 `hits` 테이블에 익명 1행을 남깁니다.
`GET /dash?k=<DASH_KEY>` 로 집계를 봅니다. 설계 근거는 vault
`30_Projects/origin-lgns-analytics-design-2026-07.md`.

## 수집하는 것 / 안 하는 것

- 수집: 페이지·이벤트명·유입 **호스트만**·국가(CF)·지역(CF 시/도 수준, 2026-08-13부터)·
  mobile|desktop·app|web·월간 익명 ID
- **미수집**: 지갑주소·잔액·입력값·쿼리스트링·전체 referrer·IP/UA 원본
- 월간 익명 ID = `SHA-256('YYYY-MM' + VID_SALT + IP + UA)` 앞 16자. 달이 바뀌면 같은 사람이
  다른 ID가 되어 **달을 넘어선 추적은 구조적으로 불가능**합니다. 쿠키·기기 저장 식별자는 없습니다.

### 2026-08-13 — 일일 → 월간 확대

원래는 해시 재료에 날짜가 들어가 하루만 지나면 같은 사람이 다른 ID였고, 그래서 "고유 이용자
수"를 셀 수 없었습니다(같은 사람이 날마다 재계수). 재료를 `YYYY-MM`으로 바꿔 **한 달 안에서는
한 사람 = 한 ID**가 되며, `/dash`의 「월별 고유 이용자(MAU)」가 그 값입니다.

- **소급 불가**: 2026-08-13 이전 행은 일일 해시라 사람 단위로 되돌릴 수 없습니다.
  그 구간의 MAU는 **과대집계**이며 대시보드에도 그렇게 표시됩니다.
- 2026-08은 월 중간에 바뀌었으므로 8월 MAU도 신뢰 불가. **첫 정상값은 2026-09**.
- 일별 방문자 수는 영향 없음(날짜로 GROUP BY 하므로 여전히 하루 1회 계수).

### 2026-08-13 — 시간대별·지역별 집계

- **시간대별(KST)**: `ts`가 처음부터 초 단위라 **전 기간 소급 적용**. 시간대 분포만 KST고
  기간 경계·일별 날짜는 UTC(=KST 09시 시작) — 대시보드에도 명시.
- **지역**: CF `request.cf.region`(시/도 수준, 예: Seoul)을 `region` 컬럼에 저장. IP 원본과
  무관하며 국가보다 한 단계 세밀할 뿐. **08-13 이전 행은 지역이 없어 국가만으로 표시**
  (`KR`와 `KR·Seoul` 병존이 정상). 원격 DB에는 08-13에 `ALTER TABLE hits ADD COLUMN region
  TEXT` 적용 완료.
- 기간 프리셋에 1일·30일 추가.

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

## 운영 주의: DASH_KEY 노출 경로

`/dash`·`/stats`는 `?k=<DASH_KEY>` 쿼리스트링으로 인증합니다. `wrangler.jsonc`의
`observability`가 켜져 있어 이 URL이 **Cloudflare Workers Logs에 그대로 남고**,
브라우저 히스토리에도 남습니다(쿼리스트링이라).

- 대시보드 URL을 공유·스크린샷·화면공유 등으로 노출했다면 즉시 회전:
  ```bash
  npx wrangler secret put DASH_KEY
  ```

## 자기 트래픽 제외

자기 트래픽은 삭제하지 않고 `internal=1`로 **표시만** 합니다(대시보드 기본 집계에서 제외).
- 서버측: 시크릿 `INTERNAL_IPS`의 IP와 일치
- 클라이언트측: 브라우저에서 `?px=off`로 한 번 방문하면 그 기기가 계속 내부로 표시

## 테스트

```bash
cd ~/origin-lgns && node --test "metrics-worker/test/*.mjs" "test/*.mjs"
```

⚠ 디렉토리 인자(`node --test metrics-worker/test/ test/`)는 **Node 26에서 깨집니다**
(디렉토리를 모듈로 로드하려다 `MODULE_NOT_FOUND`). 위 글롭 형태는 구·신 버전 모두에서 동작합니다.
