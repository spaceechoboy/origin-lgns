// origin-lgns 접속·사용량 계측 워커 (Workers Free + D1).
// 프라이버시 불변식: 지갑정보 미전송 · 식별 쿠키 없음 · IP/UA 원본 미저장(일일 해시 재료로만) · referrer는 호스트만.
// 배포·운영은 README.md 참고.

const ALLOWED_ORIGINS = [
  "https://spaceechoboy.github.io",   // origin-lgns 라이브
  "https://awakeorigin.direct",       // apex 임베드 대비
];
const MAX_BODY = 1024;                 // bytes — 페이로드는 200B 남짓이면 충분
const BOT_UA = /bot|crawler|spider|crawling|headless|monitor|preview|curl|wget|python-requests|node-fetch/i;

const SITE   = "origin-lgns";
const PAGES  = ["index", "rates", "contact"];
// ★ 이 목록은 assets/px.js의 EVENTS와 **반드시 동일**하다 (test/contract.test.mjs가 강제).
const EVENTS = ["view", "rates:refresh", "rates:evidence", "contact:copy", "contact:submit", "pwa:install"];

function refHost(v) {
  const s = String(v || "").trim().slice(0, 200);
  if (!s) return "";
  try {
    // 클라이언트는 호스트만 보내지만, 전체 URL이 와도 호스트만 남긴다(2중 방어).
    return new URL(s.includes("://") ? s : "https://" + s).hostname.slice(0, 80);
  } catch (e) { return ""; }
}

export function normalize(data, meta) {
  const d = data && typeof data === "object" ? data : {};
  return {
    ts: Math.floor(meta.now / 1000),
    day: new Date(meta.now).toISOString().slice(0, 10),
    site: SITE,
    page: PAGES.includes(d.page) ? d.page : "기타",
    ev: EVENTS.includes(d.ev) ? d.ev : "기타",
    ref: refHost(d.ref),
    mode: d.mode === "app" ? "app" : "web",
    country: String(meta.country || "ZZ").slice(0, 2),
    device: /Mobile|Android|iPhone|iPad|iPod/i.test(meta.ua) ? "mobile" : "desktop",
  };
}

// 쿠키 없는 일일 익명 ID. IP·UA는 여기서 해시 재료로만 쓰이고 **저장되지 않는다**.
// day가 재료에 들어가므로 날짜가 바뀌면 같은 사람이 다른 ID가 된다(= 장기 추적 불가, 의도된 설계).
export async function makeVid(day, salt, ip, ua) {
  const buf = new TextEncoder().encode(`${day}|${salt}|${ip}|${ua}`);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isInternal(ip, list) {
  if (!ip) return false;
  return String(list || "").split(",").map((s) => s.trim()).filter(Boolean).includes(ip);
}

const VID_CAP = 300;   // 같은 vid의 당일 최대 기록 수 — 무료 한도 폭주 방어

export async function record(env, row, ip, ua, hint) {
  if (!env || !env.DB) return;
  try {
    const vid = await makeVid(row.day, env.VID_SALT || "", ip, ua);
    const internal = (isInternal(ip, env.INTERNAL_IPS) || hint === 1) ? 1 : 0;

    const seen = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM hits WHERE day=? AND vid=?")
      .bind(row.day, vid).first();
    if (seen && Number(seen.n) >= VID_CAP) return;

    await env.DB.prepare(
      "INSERT INTO hits (ts,day,site,page,ev,vid,country,device,mode,ref,internal) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(row.ts, row.day, row.site, row.page, row.ev, vid,
           row.country, row.device, row.mode, row.ref, internal).run();
  } catch (e) {
    // 계측 실패는 조용히 삼킨다 — 재시도 큐 없음(YAGNI).
  }
}

export function tokenOk(given, expected) {
  const a = new TextEncoder().encode(String(given == null ? "" : given));
  const b = new TextEncoder().encode(String(expected || ""));
  if (b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const W = "day>=? AND internal<=?";     // 모든 집계가 공유하는 조건
const Q = {
  daily:     `SELECT day, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ev='view' AND ${W} GROUP BY day ORDER BY day`,
  pages:     `SELECT page AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY page ORDER BY n DESC`,
  countries: `SELECT country AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY country ORDER BY n DESC LIMIT 12`,
  devices:   `SELECT device AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY device ORDER BY n DESC`,
  modes:     `SELECT mode AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY mode ORDER BY n DESC`,
  refs:      `SELECT ref AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ref<>'' AND ${W} GROUP BY ref ORDER BY n DESC LIMIT 12`,
  events:    `SELECT ev AS k, COUNT(*) AS n FROM hits WHERE ev<>'view' AND ${W} GROUP BY ev ORDER BY n DESC`,
};

export async function stats(env, days, withInternal) {
  const d = Math.min(90, Math.max(1, Number(days) || 14));
  const inc = withInternal ? 1 : 0;
  const since = new Date(Date.now() - (d - 1) * 86400000).toISOString().slice(0, 10);
  const bind = (sql) => env.DB.prepare(sql).bind(since, inc);

  const totals = await bind(
    `SELECT COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ev='view' AND ${W}`
  ).first();
  const out = { days: d, since, internal: inc, totals: totals || { views: 0, visitors: 0 } };
  for (const [key, sql] of Object.entries(Q)) out[key] = (await bind(sql).all()).results || [];
  return out;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
}

function bars(rows, total) {
  if (!rows.length) return '<p class="dim">데이터 없음</p>';
  const max = Math.max(...rows.map((r) => Number(r.n) || 0), 1);
  return rows.map((r) => {
    const n = Number(r.n) || 0;
    const pct = total ? ((n / total) * 100).toFixed(1) : "0.0";
    return `<div class="row"><span class="k">${esc(r.k || "—")}</span>` +
           `<span class="bar"><i style="width:${((n / max) * 100).toFixed(1)}%"></i></span>` +
           `<span class="n">${n} <em>${pct}%</em></span></div>`;
  }).join("");
}

export function renderDash(d, k) {
  const t = d.totals || { views: 0, visitors: 0 };
  const kq = encodeURIComponent(k);
  const daily = (d.daily || []).map((r) =>
    `<div class="row"><span class="k">${esc(r.day)}</span>` +
    `<span class="bar"><i style="width:${((Number(r.views) || 0) / Math.max(...(d.daily || []).map((x) => Number(x.views) || 0), 1) * 100).toFixed(1)}%"></i></span>` +
    `<span class="n">${r.views} <em>${r.visitors}명</em></span></div>`).join("");

  const sec = (title, rows) => `<section><h2>${esc(title)}</h2>${bars(rows || [], t.views)}</section>`;

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>origin-lgns 계측</title><style>
:root{--bg:#050805;--card:#0e1610;--bd:rgba(159,232,112,.18);--neon:#9FE870;--tx:#E8F5E0;--dim:#9CA89A}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--tx);font-family:-apple-system,system-ui,'Pretendard',sans-serif;padding:16px;line-height:1.5}
h1{font-size:17px;color:var(--neon);margin-bottom:2px}h2{font-size:13px;color:var(--neon);margin-bottom:8px;font-weight:600}
.dim{color:var(--dim);font-size:12px}
.tot{display:flex;gap:10px;margin:12px 0}
.tot div{flex:1;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px}
.tot b{display:block;font-size:24px;color:var(--neon)}
section{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px;margin-bottom:10px}
.row{display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0}
.k{flex:0 0 34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{flex:1;height:8px;background:rgba(255,255,255,.05);border-radius:4px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--neon);opacity:.75}
.n{flex:0 0 84px;text-align:right;font-variant-numeric:tabular-nums}
.n em{color:var(--dim);font-style:normal;font-size:11px}
a{color:var(--neon)}
</style></head><body>
<h1>origin-lgns 계측</h1>
<p class="dim">${esc(d.since)} ~ 오늘 · ${d.days}일 · 자기 트래픽 ${d.internal ? "포함" : "제외"}</p>
<div class="tot"><div><b>${t.views || 0}</b><span class="dim">조회</span></div>
<div><b>${t.visitors || 0}</b><span class="dim">방문자(일 단위 고유)</span></div></div>
<p class="dim">기간: <a href="/dash?k=${kq}&days=7&internal=${d.internal}">7일</a> ·
<a href="/dash?k=${kq}&days=14&internal=${d.internal}">14일</a> ·
<a href="/dash?k=${kq}&days=90&internal=${d.internal}">90일</a> ·
<a href="/dash?k=${kq}&days=${d.days}&internal=${d.internal ? 0 : 1}">자기 트래픽 ${d.internal ? "제외" : "포함"}</a></p>
<section><h2>일별</h2>${daily || '<p class="dim">데이터 없음</p>'}</section>
${sec("페이지", d.pages)}${sec("기능 사용", d.events)}${sec("국가", d.countries)}
${sec("기기", d.devices)}${sec("앱/웹", d.modes)}${sec("유입", d.refs)}
<p class="dim">쿠키·식별자 없음 · IP/UA 원본 미저장 · 지갑정보 미수집</p>
</body></html>`;
}

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function collect(request, env, ctx, origin) {
  if (!ALLOWED_ORIGINS.includes(origin)) return new Response(null, { status: 403, headers: cors(origin) });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 413, headers: cors(origin) });

  let data;
  try { data = JSON.parse(raw); } catch (e) { return new Response(null, { status: 400, headers: cors(origin) }); }

  const ua = request.headers.get("User-Agent") || "";
  if (BOT_UA.test(ua)) return new Response(null, { status: 204, headers: cors(origin) });

  const row = normalize(data, {
    now: Date.now(),
    country: request.headers.get("CF-IPCountry") || (request.cf && request.cf.country) || "ZZ",
    ua,
  });
  const ip = request.headers.get("CF-Connecting-IP") || "";
  ctx.waitUntil(record(env, row, ip, ua, data && data.internal === 1 ? 1 : 0));
  return new Response(null, { status: 204, headers: cors(origin) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method === "POST" && url.pathname === "/") return collect(request, env, ctx, origin);

    if (request.method === "GET" && (url.pathname === "/stats" || url.pathname === "/dash")) {
      if (!tokenOk(url.searchParams.get("k"), env.DASH_KEY)) {
        return new Response("unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
      }
      const data = await stats(env, url.searchParams.get("days"), url.searchParams.get("internal") === "1");
      if (url.pathname === "/stats") {
        return new Response(JSON.stringify(data), {
          headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store",
                     "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
        });
      }
      return new Response(renderDash(data, url.searchParams.get("k") || ""), {
        headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store",
                   "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};
