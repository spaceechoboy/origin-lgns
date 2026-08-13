// origin-lgns 접속·사용량 계측 워커 (Workers Free + D1).
// 프라이버시 불변식: 지갑정보 미전송 · 식별 쿠키 없음 · IP/UA 원본 미저장(월간 해시 재료로만) · referrer는 호스트만.
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
    region: String(meta.region || "").slice(0, 40),   // CF가 주는 시/도 수준(예: Seoul) — IP보다 훨씬 거칠다
    device: /Mobile|Android|iPhone|iPad|iPod/i.test(meta.ua) ? "mobile" : "desktop",
  };
}

// 쿠키 없는 월간 익명 ID. IP·UA는 여기서 해시 재료로만 쓰이고 **저장되지 않는다**.
// period('YYYY-MM')가 재료에 들어가므로 달이 바뀌면 같은 사람이 다른 ID가 된다
// (= 한 달 안의 고유 인원은 셀 수 있고, 달을 넘는 추적은 불가. 2026-08-13 일→월 확대).
export async function makeVid(period, salt, ip, ua) {
  const buf = new TextEncoder().encode(`${period}|${salt}|${ip}|${ua}`);
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
    const vid = await makeVid(row.day.slice(0, 7), env.VID_SALT || "", ip, ua);
    const internal = (isInternal(ip, env.INTERNAL_IPS) || hint === 1) ? 1 : 0;

    const seen = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM hits WHERE day=? AND vid=?")
      .bind(row.day, vid).first();
    if (seen && Number(seen.n) >= VID_CAP) return;

    await env.DB.prepare(
      "INSERT INTO hits (ts,day,site,page,ev,vid,country,device,mode,ref,internal,region) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(row.ts, row.day, row.site, row.page, row.ev, vid,
           row.country, row.device, row.mode, row.ref, internal, row.region || "").run();
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
  // vid가 월간 해시라 이 값이 곧 MAU(그 달의 고유 인원). 달을 넘어선 합산은 중복이므로 하지 않는다.
  monthly:   `SELECT substr(day,1,7) AS k, COUNT(DISTINCT vid) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY k ORDER BY k`,
  // 시간대 분포는 KST(+32400초) 기준 — day 컬럼·기간 경계는 UTC 그대로다(혼용 주의, 대시보드에 명시).
  hourly:    `SELECT strftime('%H', ts + 32400, 'unixepoch') AS k, COUNT(*) AS views, COUNT(DISTINCT vid) AS visitors FROM hits WHERE ev='view' AND ${W} GROUP BY k ORDER BY k`,
  // 2026-08-13 이전 행은 region이 없어 국가만으로 묶인다(예: 'KR' vs 'KR·Seoul' 병존).
  regions:   `SELECT country || CASE WHEN region IS NULL OR region='' THEN '' ELSE '·'||region END AS k, COUNT(*) AS n FROM hits WHERE ev='view' AND ${W} GROUP BY k ORDER BY n DESC LIMIT 15`,
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

// 조회 막대 + 방문자 수 병기 행(일별·시간대별 공용).
function vvRows(rows, key) {
  const max = Math.max(...rows.map((x) => Number(x.views) || 0), 1);
  return rows.map((r) =>
    `<div class="row"><span class="k">${esc(r[key])}</span>` +
    `<span class="bar"><i style="width:${((Number(r.views) || 0) / max * 100).toFixed(1)}%"></i></span>` +
    `<span class="n">${r.views} <em>${r.visitors}명</em></span></div>`).join("");
}

const num = (v) => (Number(v) || 0).toLocaleString();

export function renderDash(d, k) {
  const t = d.totals || { views: 0, visitors: 0 };
  const kq = encodeURIComponent(k);
  const dailyRows = d.daily || [];
  const daily = vvRows(dailyRows, "day");

  // 빈 시간대도 0으로 채워 24행 고정 — 새벽 공백이 눈에 보여야 분포다.
  const hmap = {};
  for (const r of d.hourly || []) hmap[r.k] = r;
  const hourArr = Array.from({ length: 24 }, (_, h) => {
    const r = hmap[String(h).padStart(2, "0")] || { views: 0, visitors: 0 };
    return { k: String(h).padStart(2, "0") + "시", views: Number(r.views) || 0, visitors: Number(r.visitors) || 0 };
  });
  const hourly = (d.hourly || []).length ? vvRows(hourArr, "k") : "";

  // 카드 — 마지막 일별 행이 오늘(UTC)일 때만 "오늘" 값이 성립한다.
  const today = new Date().toISOString().slice(0, 10);
  const last = dailyRows[dailyRows.length - 1];
  const cur = last && last.day === today ? last : null;
  // 진행 중인 오늘은 평균을 끌어내리므로 뺀다(그것뿐이면 그 값을 쓴다).
  const base = cur && dailyRows.length > 1 ? dailyRows.slice(0, -1) : dailyRows;
  const avg = base.length
    ? Math.round(base.reduce((s, r) => s + (Number(r.visitors) || 0), 0) / base.length)
    : 0;
  const mau = (d.monthly || [])[(d.monthly || []).length - 1];

  const card = (label, value, note) =>
    `<div class="c"><span class="lb">${esc(label)}</span><b>${esc(value)}</b>` +
    (note ? `<span class="dim">${esc(note)}</span>` : "") + `</div>`;

  const pill = (label, days, internal) =>
    `<a class="p${days === d.days && internal === d.internal ? " on" : ""}" ` +
    `href="/dash?k=${kq}&days=${days}&internal=${internal}">${esc(label)}</a>`;

  const sec = (title, rows, open) =>
    `<details${open ? " open" : ""}><summary>${esc(title)}</summary>${bars(rows || [], t.views)}</details>`;

  // 월간은 인원수라 조회수 대비 %가 의미 없다 — bars() 대신 숫자만 세운다.
  const mmax = Math.max(...(d.monthly || []).map((x) => Number(x.n) || 0), 1);
  const monthly = (d.monthly || []).map((r) =>
    `<div class="row"><span class="k">${esc(r.k)}</span>` +
    `<span class="bar"><i style="width:${((Number(r.n) || 0) / mmax * 100).toFixed(1)}%"></i></span>` +
    `<span class="n">${num(r.n)}명</span></div>`).join("");

  // 차트에 넘기는 건 집계 수치뿐 — 최소 원칙. </script> 탈출 방어로 '<' 이스케이프.
  const chartJson = JSON.stringify({
    daily: dailyRows.map((r) => ({ d: String(r.day).slice(5), v: Number(r.views) || 0, u: Number(r.visitors) || 0 })),
    hourly: hourArr.map((r) => ({ h: r.k, v: r.views })),
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>origin-lgns 계측</title><style>
:root{--bg:#050805;--card:#0e1610;--bd:rgba(159,232,112,.18);--neon:#9FE870;--tx:#E8F5E0;--dim:#9CA89A}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--tx);font-family:-apple-system,system-ui,'Pretendard',sans-serif;padding:16px;line-height:1.5;max-width:720px;margin:0 auto;overflow-x:hidden}
h1{font-size:17px;color:var(--neon);margin-bottom:2px}h2{font-size:13px;color:var(--neon);margin-bottom:8px;font-weight:600}
.dim{color:var(--dim);font-size:12px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.p{display:inline-block;padding:4px 10px;border:1px solid var(--bd);border-radius:999px;font-size:12px;text-decoration:none;background:var(--card)}
.p.on{background:var(--neon);color:#050805;border-color:var(--neon);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:12px 0}
.c{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px 12px}
.c .lb{display:block;font-size:11px;color:var(--dim)}
.c b{display:block;font-size:22px;color:var(--neon);font-variant-numeric:tabular-nums;line-height:1.2}
.c .dim{font-size:10px}
section{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px;margin-bottom:10px}
.chart{position:relative;height:200px}
details{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin-bottom:8px}
summary{font-size:13px;color:var(--neon);font-weight:600;cursor:pointer;list-style:revert}
details[open] summary{margin-bottom:8px}
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
<div class="pills">${pill("1일", 1, d.internal)}${pill("7일", 7, d.internal)}${pill("14일", 14, d.internal)}${pill("30일", 30, d.internal)}${pill("90일", 90, d.internal)}<a class="p" href="/dash?k=${kq}&days=${d.days}&internal=${d.internal ? 0 : 1}">자기 트래픽 ${d.internal ? "제외" : "포함"}</a></div>
<div class="cards">
${card("오늘 방문자", cur ? num(cur.visitors) : "—", "UTC 기준")}
${card("오늘 조회", cur ? num(cur.views) : "—", "UTC 기준")}
${card("일평균 방문자", num(avg), `${base.length}일 평균`)}
${card("기간 총조회", num(t.views), `방문자 ${num(t.visitors)}`)}
${card("이번 달 MAU", mau ? num(mau.n) : "—", mau ? String(mau.k) : "데이터 없음")}
</div>
<p class="dim">MAU는 2026-09부터 정상값입니다(그 전은 일 단위 해시가 섞여 과대집계).</p>
<section><h2>일별 추이</h2><div class="chart"><canvas id="cD"></canvas></div></section>
<section><h2>시간대별(KST)</h2><div class="chart"><canvas id="cH"></canvas></div>
<p class="dim">시간대는 KST, 날짜·기간 경계는 UTC(=KST 09시 시작)입니다.</p></section>
<h2>자세히 보기</h2>
<details open><summary>월별 고유 이용자(MAU)</summary>${monthly || '<p class="dim">데이터 없음</p>'}</details>
<details><summary>일별</summary>${daily || '<p class="dim">데이터 없음</p>'}</details>
<details><summary>시간대별(KST)</summary>${hourly || '<p class="dim">데이터 없음</p>'}</details>
${sec("페이지", d.pages)}${sec("기능 사용", d.events)}${sec("국가", d.countries)}${sec("지역", d.regions)}
${sec("기기", d.devices)}${sec("앱/웹", d.modes)}${sec("유입", d.refs)}
<p class="dim">쿠키·식별자 없음 · IP/UA 원본 미저장 · 지갑정보 미수집</p>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
// CDN이 죽어도 페이지는 성립한다 — 차트만 비고 아래 표에 전체 데이터가 있다.
try{
var D=${chartJson},G='rgba(159,232,112,.10)',M='#9CA89A';
var ax={x:{ticks:{color:M,maxRotation:0,autoSkip:true},grid:{color:G}},y:{beginAtZero:true,ticks:{color:M,precision:0},grid:{color:G}}};
var lg={legend:{labels:{color:M,boxWidth:10,font:{size:11}}}};
new Chart(document.getElementById('cD'),{data:{labels:D.daily.map(function(r){return r.d}),datasets:[
{type:'bar',label:'방문자',data:D.daily.map(function(r){return r.u}),backgroundColor:'#9FE870',borderRadius:3},
{type:'line',label:'조회',data:D.daily.map(function(r){return r.v}),borderColor:'#9CA89A',borderDash:[4,3],borderWidth:1.5,pointRadius:0,tension:.25}
]},options:{responsive:true,maintainAspectRatio:false,plugins:lg,scales:ax}});
new Chart(document.getElementById('cH'),{type:'bar',data:{labels:D.hourly.map(function(r){return r.h}),datasets:[
{label:'조회',data:D.hourly.map(function(r){return r.v}),backgroundColor:'#9FE870',borderRadius:3}
]},options:{responsive:true,maintainAspectRatio:false,plugins:lg,scales:ax}});
}catch(e){}
</script>
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
    region: (request.cf && (request.cf.region || request.cf.city)) || "",
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
