// origin-lgns 접속·사용량 계측 워커 (Workers Free + D1).
// 프라이버시 불변식: 지갑정보 미전송 · 식별 쿠키 없음 · IP/UA 원본 미저장(일일 해시 재료로만) · referrer는 호스트만.
// 배포·운영은 README.md 참고.

const ALLOWED_ORIGINS = [
  "https://spaceechoboy.github.io",   // origin-lgns 라이브
  "https://awakeorigin.direct",       // apex 임베드 대비
];
const MAX_BODY = 1024;                 // bytes — 페이로드는 200B 남짓이면 충분
const BOT_UA = /bot|crawler|spider|crawling|headless|monitor|preview|curl|wget|python-requests|node-fetch/i;

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
