/* 서비스 종료 사전 공지 — 세 페이지(시세/이율/문의) 공통.
   레이아웃을 밀지 않도록 하단 고정 카드로 띄운다(index는 100vh·스크롤 없음).
   닫으면 이번 탭 세션 동안만 숨긴다 — 다음 방문에는 다시 보인다. */
(function () {
  "use strict";
  var KEY = "olgns-notice-closed-v1";
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}

  var css =
    ".olgns-notice{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:300;" +
    "width:min(640px,calc(100vw - 32px));display:flex;gap:12px;align-items:flex-start;" +
    "padding:14px 16px;border-radius:14px;background:var(--bg-card-2,#121f12);" +
    "border:1px solid var(--neon,#9FE870);box-shadow:0 8px 32px rgba(0,0,0,.55),0 0 24px rgba(159,232,112,.18);" +
    "color:var(--text,#E8F5E0);font-family:inherit;line-height:1.5}" +
    ".olgns-notice b{display:block;font-size:14px;color:var(--neon,#9FE870);margin-bottom:3px}" +
    ".olgns-notice p{margin:0;font-size:13px;color:var(--text-dim,#9CA89A);word-break:keep-all}" +
    ".olgns-notice button{flex:0 0 auto;margin-left:auto;width:32px;height:32px;border-radius:8px;" +
    "border:1px solid var(--border-strong,rgba(159,232,112,.35));background:transparent;" +
    "color:var(--text-dim,#9CA89A);font-size:18px;line-height:1;cursor:pointer}" +
    ".olgns-notice button:hover,.olgns-notice button:focus-visible{color:var(--neon,#9FE870);border-color:var(--neon,#9FE870)}";

  function mount() {
    var st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);

    var box = document.createElement("div");
    box.className = "olgns-notice";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "서비스 안내");
    box.innerHTML =
      "<div><b>📢 Origin LGNS는 곧 서비스를 종료합니다</b>" +
      "<p>이용해 주시는 분들이 크게 늘어, 지금의 구조로는 안정적인 서비스를 이어가기 어려워졌습니다. " +
      "더 빠르고 정확한 정식 서비스로 새롭게 찾아뵙겠습니다.</p></div>" +
      '<button type="button" aria-label="안내 닫기">×</button>';
    box.querySelector("button").addEventListener("click", function () {
      box.remove();
      try { sessionStorage.setItem(KEY, "1"); } catch (e) {}
    });
    document.body.appendChild(box);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
