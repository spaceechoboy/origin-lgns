// Origin Direct '제안·문의' 폼 백엔드 — Resend REST API로 전송(Workers Free 플랜에서 동작).
// ★ CF 네이티브 Email Sending은 Workers 유료 플랜 필요 → Resend(무료 한도)로 전송.
// 시크릿: RESEND_API_KEY (발송전용 키).  선택: TURNSTILE_SECRET.
// 폼(contact.html)이 JSON POST → 검증 → Resend → contact@awakeorigin.direct 수신.

const ALLOWED_ORIGINS = [
  "https://spaceechoboy.github.io",   // origin-lgns 라이브
  "https://awakeorigin.direct",       // (선택) apex에서도 임베드 시
];
const TO_EMAIL   = "contact@awakeorigin.direct";
const FROM_EMAIL = "noreply@awakeorigin.direct";   // Resend에서 From 인증된 주소
const FROM_NAME  = "Origin Direct 제안·문의";
const TYPES      = ["버그 제보", "도구 제안", "일반 문의", "기타"];
const MAX_MSG    = 5000;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json; charset=utf-8" },
  });
}
function esc(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
async function verifyTurnstile(token, secret, ip) {
  const fd = new FormData();
  fd.append("secret", secret);
  fd.append("response", token || "");
  if (ip) fd.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
    const d = await r.json();
    return !!d.success;
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405, origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "origin" }, 403, origin);
    if (!env.RESEND_API_KEY) return json({ ok: false, error: "config" }, 500, origin);

    let data;
    try { data = await request.json(); } catch (e) { return json({ ok: false, error: "bad_json" }, 400, origin); }

    const type     = TYPES.includes(data.type) ? data.type : "기타";
    const email    = String(data.email || "").trim().slice(0, 200);
    const message  = String(data.message || "").trim().slice(0, MAX_MSG);
    const honeypot = String(data.website || "").trim();

    // 봇: 허니팟 필드가 채워졌으면 조용히 성공처럼 반환(전송 안 함)
    if (honeypot) return json({ ok: true }, 200, origin);
    if (!message) return json({ ok: false, error: "empty" }, 400, origin);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "email" }, 400, origin);

    // Turnstile: 시크릿이 설정된 경우에만 검증(미설정이면 허니팟만으로 통과)
    if (env.TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(data.turnstileToken, env.TURNSTILE_SECRET, request.headers.get("CF-Connecting-IP"));
      if (!ok) return json({ ok: false, error: "turnstile" }, 403, origin);
    }

    const subject = `[${type}] Origin Direct 제안·문의`;
    const text =
      `${message}\n\n───\n유형: ${type}\n회신 이메일: ${email || "(미기재)"}\n출처: origin-lgns 제안·문의`;
    const html =
      `<div style="font-family:sans-serif;line-height:1.6;color:#111">` +
      `<p style="white-space:pre-wrap">${esc(message)}</p>` +
      `<hr style="border:none;border-top:1px solid #ddd">` +
      `<p style="color:#666;font-size:13px">유형: ${esc(type)}<br>회신 이메일: ${esc(email || "(미기재)")}<br>출처: origin-lgns 제안·문의</p>` +
      `</div>`;

    const payload = {
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [TO_EMAIL],
      subject, text, html,
    };
    if (email) payload.reply_to = email;

    try {
      const rr = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
          "User-Agent": "origin-feedback-worker",
        },
        body: JSON.stringify(payload),
      });
      if (!rr.ok) {
        let detail = "";
        try { detail = JSON.stringify(await rr.json()); } catch (e) { detail = String(rr.status); }
        return json({ ok: false, error: "send", status: rr.status, detail }, 502, origin);
      }
    } catch (err) {
      return json({ ok: false, error: "send_network" }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  },
};
