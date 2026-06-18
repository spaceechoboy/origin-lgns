# Origin LGNS — 듀얼체인 대시보드

두 도구를 하나로 합친 설치형(PWA) 대시보드. 헤더의 `시세 | 이율` 탭으로 전환합니다.

- **시세** (`index.html`) — Polygon·Anubis LGNS/USD 가격, DexTools 차트, 프리미엄, 매도세,
  리베이스 카운트다운, USD/KRW·김프·메이저 코인. 30초 자동 갱신.
- **이율** (`rates.html`) — 듀얼체인 스테이킹 3종 이율(일반 rebase·장기 base·extra), 매도세·터빈세
  온체인 실측, 율별 온체인 근거 링크, localStorage 델타 자기보정. 온체인 read-only.

라이브: https://spaceechoboy.github.io/origin-lgns/

## 구조
```
index.html   시세 대시보드
rates.html   이율 대시보드
assets/
  shell.css  공통 헤더 탭 · 브랜드 심볼 · 시그니처
  symbol.png 네온 심볼(투명)
icons/       PWA·파비콘 아이콘
manifest.json · sw.js · .nojekyll
```
- 각 페이지는 독립 self-contained HTML(빌드·번들 없음, vanilla JS). 전환은 단순 링크.
- 온체인 데이터는 클라이언트에서 공개 RPC/API로 직접 fetch. 키·서명·트랜잭션 없음(read-only).
- 디자인: ANUBIS NEON 토큰. 폰트는 Pretendard·JetBrains Mono·Cormorant Garamond(CDN).

## 심볼 자산 재생성
브랜드 심볼은 원본 로고(Awake ORIGIN)의 실제 픽셀을 주황→네온 `#9FE870`으로 치환하고
흰 배경을 투명화한 것이다(모양 변경 없음). `assets/symbol.png`(투명 마스터)에서 Pillow로
`icons/*`(다크 배경 + 심볼 + 발광)를 생성한다.

---
SpaceEchoBoy
