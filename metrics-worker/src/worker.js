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

  // 저장은 Task 4에서 배선한다.
  return new Response(null, { status: 204, headers: cors(origin) });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method === "POST" && url.pathname === "/") return collect(request, env, ctx, origin);

    return new Response("not found", { status: 404 });
  },
};
