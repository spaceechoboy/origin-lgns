/* 서비스 종료 사전 공지 — 세 페이지(시세/이율/문의) 공통.
   화면 중앙 붉은 모달 + 어두운 배경. 레이아웃은 밀지 않는다(fixed).
   닫으면 이번 탭 세션 동안만 숨긴다 — 다음 방문에는 다시 보인다. */
(function () {
  "use strict";
  var KEY = "olgns-notice-closed-v1";
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}

  var RED = "#FF4D4D";
  var css =
    ".olgns-ov{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;" +
    "padding:16px;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}" +
    ".olgns-notice{width:min(560px,100%);padding:32px 28px 24px;border-radius:18px;text-align:center;" +
    "background:linear-gradient(180deg,#2a0d0d,#160707);border:2px solid " + RED + ";" +
    "box-shadow:0 0 0 1px rgba(255,77,77,.25),0 0 60px rgba(255,77,77,.35),0 20px 60px rgba(0,0,0,.6);" +
    "color:#FBE9E9;font-family:inherit;line-height:1.6;animation:olgnsIn .25s ease-out}" +
    ".olgns-notice .ic{font-size:44px;line-height:1;margin-bottom:12px}" +
    ".olgns-notice h2{margin:0 0 14px;font-size:clamp(20px,4.6vw,26px);font-weight:800;color:" + RED + ";" +
    "text-shadow:0 0 18px rgba(255,77,77,.45);word-break:keep-all}" +
    ".olgns-notice p{margin:0 0 24px;font-size:clamp(15px,3.6vw,17px);color:#F3CFCF;word-break:keep-all}" +
    ".olgns-notice button{min-width:140px;padding:12px 22px;border:0;border-radius:10px;cursor:pointer;" +
    "background:" + RED + ";color:#fff;font-family:inherit;font-size:16px;font-weight:700;line-height:1;box-shadow:0 0 20px rgba(255,77,77,.4)}" +
    ".olgns-notice button:hover,.olgns-notice button:focus-visible{background:#ff6a6a;outline:2px solid #fff;outline-offset:2px}" +
    "@keyframes olgnsIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion:reduce){.olgns-notice{animation:none}}";

  function mount() {
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    var ov = document.createElement("div");
    ov.className = "olgns-ov";
    // 고정 문구만 넣는다(사용자 입력 없음).
    ov.innerHTML =
      '<div class="olgns-notice" role="dialog" aria-modal="true" aria-labelledby="olgns-nt">' +
      '<div class="ic" aria-hidden="true">⚠️</div>' +
      '<h2 id="olgns-nt">Origin LGNS는 곧 서비스를 종료합니다</h2>' +
      "<p>이용해 주시는 분들이 크게 늘어, 지금의 구조로는 안정적인 서비스를 이어가기 어려워졌습니다.<br>" +
      "더 빠르고 정확한 정식 서비스로 새롭게 찾아뵙겠습니다.</p>" +
      '<button type="button">확인</button></div>';

    function close() {
      ov.remove();
      document.removeEventListener("keydown", onKey);
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    ov.querySelector("button").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(ov);
    ov.querySelector("button").focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
