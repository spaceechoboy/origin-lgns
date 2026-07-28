/* origin-lgns 접속·사용량 계측 비콘.
   보내는 것: 페이지·이벤트명·유입 호스트·app|web 뿐.
   보내지 않는 것: 지갑주소·잔액·입력값·쿼리스트링·전체 referrer. 쿠키·식별자도 만들지 않는다.
   ★ 모든 브라우저 전역은 g. 경유로 참조한다(테스트에서 가짜 window 주입).
   ★ sendBeacon은 text/plain Blob으로 보낸다 — application/json이면 프리플라이트가 필요해 비콘이 죽는다. */
(function (g) {
  "use strict";
  var EP = "https://origin-metrics.awakeorigindirect.workers.dev/";
  var SITE = "origin-lgns";
  var PAGES = ["index", "rates", "contact"];
  // ★ 이 목록은 metrics-worker/src/worker.js의 EVENTS와 **반드시 동일**하다 (test/contract.test.mjs가 강제).
  var EVENTS = ["view", "rates:refresh", "rates:evidence", "contact:copy", "contact:submit", "pwa:install"];
  var THROTTLE = 1000;
  var last = {};

  function host(u) { try { return u ? new URL(u).hostname : ""; } catch (e) { return ""; } }

  function build(ev, loc, ref, standalone, internal) {
    var f = String(loc.pathname || "").split("/").pop().replace(/\.html$/, "") || "index";
    var h = host(ref);
    return {
      site: SITE,
      page: PAGES.indexOf(f) >= 0 ? f : "index",
      ev: ev,
      ref: h && h !== loc.hostname ? h : "",
      mode: standalone ? "app" : "web",
      internal: internal ? 1 : 0,
    };
  }

  function isInternal() {
    try {
      if (/[?&]px=off\b/.test(g.location.search || "")) g.localStorage.setItem("px_internal", "1");
      return g.localStorage.getItem("px_internal") === "1";
    } catch (e) { return false; }
  }

  function send(ev) {
    try {
      if (EVENTS.indexOf(ev) < 0) return;                       // 화이트리스트 밖은 전송 금지
      var now = Date.now();
      if (last[ev] && now - last[ev] < THROTTLE) return;        // 자체 폭주 방어
      last[ev] = now;

      var standalone = false;
      try { standalone = !!(g.matchMedia && g.matchMedia("(display-mode: standalone)").matches); } catch (e) {}
      var body = JSON.stringify(build(ev, g.location, g.document.referrer, standalone, isInternal()));

      if (g.navigator && g.navigator.sendBeacon && typeof Blob !== "undefined") {
        g.navigator.sendBeacon(EP, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      } else if (g.fetch) {
        g.fetch(EP, { method: "POST", body: body, keepalive: true, mode: "cors" });
      }
    } catch (e) { /* 계측 실패는 앱에 영향을 주지 않는다 */ }
  }

  g.px = { view: function () { send("view"); }, ev: send, _build: build };

  try { g.addEventListener("appinstalled", function () { send("pwa:install"); }); } catch (e) {}
  send("view");
})(window);
