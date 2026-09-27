/* Microduck — app shell, hash router, unsaved-changes guard, ticker */
window.App = (function () {
  "use strict";

  var App = {
    state: {
      runTab: "loss", smoothing: false, runsFilter: { q: "", status: "", bot: "", date: "" },
      galleryFilter: { q: "", bot: "", action: "", feet: "", status: "", sort: "newest", video: false, scope: "mine" },
      botFilter: { q: "", feet: "", motor: "", category: "", sort: "updated" },
      masterTab: "account", billsFilter: { status: "", service: "", q: "" }
    },
    _cleanups: [], guard: null, _prevHash: null, _bypass: false, _scrollPos: {}
  };
  window.App = App;

  App.onLeave = function (fn) { App._cleanups.push(fn); };
  function runCleanups() {
    App._cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    App._cleanups = [];
    App.guard = null;
    App.onDiscard = null;
    Pages._runUpdate = null;
  }
  App.go = function (hash) { location.hash = hash; };
  App.rerender = function () { App._bypass = true; route(); };

  App.title = function (text) {
    var el = document.getElementById("breadcrumb");
    el.innerHTML = "";
    text.split(" / ").forEach(function (p, i, arr) {
      if (i > 0) el.appendChild(document.createTextNode(" / "));
      el.appendChild(UI.h(i === arr.length - 1 ? "b" : "span", { text: p }));
    });
  };

  function parseQuery(str) {
    var q = {};
    (str || "").split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      if (i < 0) q[decodeURIComponent(kv)] = true;
      else q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1));
    });
    return q;
  }

  function route() {
    var hash = location.hash.slice(1) || "/gallery";
    if (!App._bypass && App.guard && App._prevHash != null && hash !== App._prevHash.slice(1)) {
      var msg = App.guard();
      if (msg) {
        var target = location.hash;
        App._bypass = true;
        history.replaceState(null, "", App._prevHash);
        App._bypass = false;
        UI.modal({
          title: "Unsaved changes",
          body: UI.h("p", { text: msg }),
          actions: [
            { label: "Keep editing" },
            { label: "Discard", kind: "danger", onClick: function () { if (App.onDiscard) App.onDiscard(); App.guard = null; location.hash = target; } }
          ]
        });
        return;
      }
    }
    App._bypass = false;
    if (App._prevHash) {
      var prevPath = App._prevHash.slice(1).split("?")[0];
      if (isListPath(prevPath)) App._scrollPos[prevPath] = window.scrollY;
    }
    App._prevHash = "#" + hash;

    var qIdx = hash.indexOf("?");
    var query = qIdx >= 0 ? parseQuery(hash.slice(qIdx + 1)) : {};
    var path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    var parts = path.split("/").filter(Boolean);

    runCleanups();
    var view = document.getElementById("view");
    view.innerHTML = "";
    window.scrollTo(0, 0);

    var seg = parts[0] || "gallery";
    var navSeg = seg === "sandbox" ? "playyard" : seg;
    document.querySelectorAll(".nav-item").forEach(function (a) { a.classList.toggle("active", a.dataset.nav === navSeg); });

    if (seg === "arena") {
      if (parts[1] === "new") Pages.arenaNew(view, { query: query });
      else if (parts[1] === "runs" && parts[2]) Pages.arenaRun(view, { id: parts[2], query: query });
      else Pages.arena(view);
    } else if (seg === "playyard" || seg === "sandbox") {
      var resultId = null;
      if (seg === "playyard" && parts[1] === "results" && parts[2]) resultId = parts[2];
      else if (seg === "sandbox" && parts[1]) resultId = parts[1];
      if (resultId) Pages.galleryDetail(view, { id: resultId, query: query });
      else Pages.playyard(view);
    } else if (seg === "master") {
      Pages.master(view, { parts: parts.slice(1), query: query });
    } else {
      if (parts[1] === "bots" && parts[2] && parts[3] === "new-config") Pages.newConfig(view, { id: parts[2], query: query });
      else if (parts[1] === "bots" && parts[2]) Pages.botDetail(view, { id: parts[2], query: query });
      else Pages.sandbox(view);
    }
    if (isListPath(path) && App._scrollPos[path]) {
      var y = App._scrollPos[path];
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    }
  }

  function isListPath(p) {
    return p === "/gallery" || p === "/arena" || p === "/sandbox" || p === "/playyard" ||
      p === "/master" || p === "/master/account" || p === "/master/credits" ||
      p === "/master/credits/overview" || p === "/master/credits/topups" || p === "/master/credits/bills";
  }

  document.getElementById("account-btn").addEventListener("click", function () { location.hash = "#/master/account"; });
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", function (e) {
    if (App.guard && App.guard()) { e.preventDefault(); e.returnValue = ""; }
  });
  route();

  setInterval(function () { (Pages._ticks || []).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }, 2000);
  return App;
})();
