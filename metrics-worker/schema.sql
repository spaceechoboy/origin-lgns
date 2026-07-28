-- origin-lgns 계측 스키마. 적용:
--   npx wrangler d1 execute origin_metrics --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS hits (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,          -- epoch seconds
  day      TEXT    NOT NULL,          -- 'YYYY-MM-DD' (UTC)
  site     TEXT    NOT NULL,          -- 'origin-lgns' (확장 대비)
  page     TEXT    NOT NULL,          -- index | rates | contact | 기타
  ev       TEXT    NOT NULL,          -- view | 기능 이벤트명 | 기타
  vid      TEXT    NOT NULL,          -- 일일 익명 해시 16자 (IP·UA 원본 아님)
  country  TEXT,
  device   TEXT,                      -- mobile | desktop
  mode     TEXT,                      -- app | web (설치형 PWA 여부)
  ref      TEXT,                      -- 유입 호스트만
  internal INTEGER NOT NULL DEFAULT 0 -- 1 = 자기 트래픽(삭제하지 않고 표시만)
);
CREATE INDEX IF NOT EXISTS hits_day_vid_idx ON hits(day, vid);
CREATE INDEX IF NOT EXISTS hits_day_ev_idx  ON hits(day, ev);
