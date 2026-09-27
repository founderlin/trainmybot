/* Microduck — UI helpers: DOM builder, dialogs, formatting, Loss chart, MuJoCo viewer */
window.UI = (function () {
  "use strict";

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "onclick") el.addEventListener("click", v);
        else if (k === "oninput") el.addEventListener("input", v);
        else if (k === "onchange") el.addEventListener("change", v);
        else if (k === "onkeydown") el.addEventListener("keydown", v);
        else if (k === "value") el.value = v;
        else if (k === "disabled") el.disabled = true;
        else if (k === "checked") el.checked = true;
        else el.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }

  /* ---------------- feedback ---------------- */
  function toast(msg, kind) {
    var root = document.getElementById("toast-root");
    var t = h("div", { class: "toast" + (kind ? " " + kind : ""), role: "status", text: msg });
    root.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3600);
    setTimeout(function () { t.remove(); }, 4000);
  }

  function modal(opts) {
    var root = document.getElementById("modal-root");
    var returnFocus = document.activeElement;
    root.innerHTML = "";
    function close() {
      root.innerHTML = "";
      document.removeEventListener("keydown", onKey);
      if (returnFocus && returnFocus.focus && document.body.contains(returnFocus)) returnFocus.focus();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    var actions = h("div", { class: "modal-actions" });
    (opts.actions || [{ label: "Close" }]).forEach(function (a) {
      var btn = h("button", {
        class: "btn" + (a.kind === "primary" ? " btn-primary" : a.kind === "danger" ? " btn-danger" : "") + (a.left ? " left" : ""),
        onclick: function () {
          if (a.onClick) { var keep = a.onClick(btn); if (keep === true) return; }
          close();
        }
      }, a.label);
      if (a.disabled) btn.disabled = true;
      actions.appendChild(btn);
    });
    var box = h("div", { class: "modal" + (opts.wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": opts.title },
      h("div", { class: "modal-head" }, h("div", { class: "modal-title", text: opts.title })),
      h("div", { class: "modal-body" }, opts.body),
      actions
    );
    var mask = h("div", { class: "modal-mask", onclick: function (e) { if (e.target === mask) close(); } }, box);
    root.appendChild(mask);
    var first = actions.querySelector(".btn-primary") || actions.querySelector("button");
    if (first) first.focus();
    return { close: close, actions: actions, body: box };
  }

  function confirmDialog(title, body, confirmLabel, onConfirm, kind) {
    return modal({
      title: title, body: typeof body === "string" ? h("p", { text: body }) : body,
      actions: [{ label: "Cancel" }, { label: confirmLabel, kind: kind || "primary", onClick: onConfirm }]
    });
  }

  /* ---------------- badges ---------------- */
  var BADGE = {
    ok: ["Running", "Ready", "Ready to run", "Saved", "Available", "Compatible", "Credits added", "Settled", "Export ready", "Simulation evaluated", "Compatibility checked", "Model checked", "Confirmed", "Connected", "Configured"],
    info: ["Queued", "Initializing", "Evaluating", "Exporting", "Accruing", "Processing", "Saving", "Requested", "Pending payment", "Loading model", "Resizing preview", "Applying hardware", "Submitting", "Pending review", "Official reference"],
    warn: ["Stopping", "Stopped", "Needs validation", "Draft", "Partial training", "Finalizing", "Missing recipe", "Paused", "Not verified", "Refund pending", "Under review", "Draft — configuration required", "Evaluation pending", "Stale", "Disconnected", "Previous model shown", "Not hardware validated", "Requires review", "Applicability pending", "Changed", "Not a training result"],
    err: ["Failed", "Incompatible", "Failed validation", "Evaluation failed", "Model could not load", "Viewer unavailable", "Cancelled"]
  };
  function badgeKind(s) {
    for (var k in BADGE) if (BADGE[k].indexOf(s) >= 0) return k;
    return "neutral";
  }
  function badge(text, kind) { return h("span", { class: "badge badge-" + (kind || badgeKind(text)), text: text }); }
  function sampleTag(text) { return h("span", { class: "sample-tag", title: "Demo value — not a real measurement, rate, balance or benchmark.", text: text || "Sample data" }); }

  /* ---------------- formatting ---------------- */
  function fmtNum(n) {
    if (n == null || !isFinite(n)) return "—";
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  function fmtValue(v) {
    if (v == null || v === "") return "";
    if (typeof v === "boolean") return v ? "On" : "Off";
    if (typeof v !== "number") return String(v);
    if (!isFinite(v)) return String(v);
    if (v === 0) return "0";
    var a = Math.abs(v);
    if (a < 1e-3 || a >= 1e6) return v.toExponential(3).replace(/\.?0+e/, "e");
    return String(+v.toPrecision(6));
  }
  function fmtHMS(sec) {
    if (sec == null || !isFinite(sec)) return "—";
    sec = Math.max(0, Math.floor(sec));
    var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
    return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;
  }
  function fmtCredits(n) { return n == null || !isFinite(n) ? "—" : (Math.round(n * 100) / 100).toFixed(2); }
  function parseNum(str) {
    if (str == null) return null;
    var s = String(str).trim();
    if (s === "") return null;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  /* ---------------- layout helpers ---------------- */
  function tabs(items, active, onPick, cls) {
    var bar = h("div", { class: "tabs" + (cls ? " " + cls : ""), role: "tablist" });
    items.forEach(function (it) {
      bar.appendChild(h("button", {
        class: "tab" + (it[0] === active ? " active" : ""), role: "tab", "aria-selected": it[0] === active ? "true" : "false",
        onclick: function () { onPick(it[0]); }
      }, it[1], it[2] != null ? h("span", { class: "tab-count", text: String(it[2]) }) : null));
    });
    return bar;
  }
  function field(label, control, opts) {
    opts = opts || {};
    return h("div", { class: "field" },
      label ? h("label", { class: "field-label" }, label, opts.req ? h("span", { class: "req", text: " *" }) : null) : null,
      control,
      opts.helper ? h("div", { class: "field-helper", text: opts.helper }) : null,
      opts.error ? h("div", { class: "field-error", text: opts.error }) : null
    );
  }
  function section(title, desc) {
    var s = h("div", { class: "section" },
      title ? h("div", { class: "section-title", text: title }) : null,
      desc ? h("div", { class: "section-desc", text: desc }) : null);
    for (var i = 2; i < arguments.length; i++) append(s, arguments[i]);
    return s;
  }
  function fold(title, open) {
    var d = h("details", { class: "fold" }, h("summary", { text: title }));
    if (open) d.open = true;
    var b = h("div", { class: "fold-body" });
    for (var i = 2; i < arguments.length; i++) append(b, arguments[i]);
    d.appendChild(b);
    return d;
  }
  function prop(label, value) {
    return h("div", { class: "prop" }, h("span", { class: "prop-label", text: label }), h("span", { class: "prop-value" }, value == null || value === "" ? "—" : value));
  }
  function kv(k, v, cls) {
    return h("div", { class: "kv" }, h("span", { class: "k", text: k }), h("span", { class: "v" + (cls ? " " + cls : "") }, v == null || v === "" ? "—" : v));
  }
  function empty(text, action) {
    return h("div", { class: "empty" }, h("div", { text: text }), action ? h("div", { class: "mt12" }, action) : null);
  }
  function alert(kind, content) { return h("div", { class: "inline-alert " + kind, role: kind === "err" ? "alert" : "status" }, content); }
  function th(t, num) { return h("th", num ? { class: "num", text: t } : { text: t }); }

  function menu(anchorLabel, items) {
    var wrap = h("div", { class: "menu-wrap" });
    var list = h("div", { class: "menu-list", role: "menu" });
    var btn = h("button", {
      class: "btn btn-sm btn-ghost", "aria-haspopup": "menu", "aria-label": anchorLabel,
      onclick: function (e) { e.stopPropagation(); list.classList.toggle("open"); }
    }, "•••");
    items.forEach(function (it) {
      list.appendChild(h("button", { class: "menu-item", role: "menuitem", onclick: function (e) { e.stopPropagation(); list.classList.remove("open"); it[1](); } }, it[0]));
    });
    document.addEventListener("click", function () { list.classList.remove("open"); });
    wrap.appendChild(btn); wrap.appendChild(list);
    wrap.addEventListener("click", function (e) { e.stopPropagation(); });
    return wrap;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = h("a", { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function copyText(text, label) {
    var done = function () { toast((label || "Text") + " copied.", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast("Copy is not available in this browser."); });
    else toast("Copy is not available in this browser.");
  }

  /* ---------------- Loss chart ---------------- */
  function niceStep(range, count) {
    var raw = range / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }
  function tickLabel(v, step) {
    if (Math.abs(v) < step / 1e6) v = 0;
    var a = Math.abs(step);
    if (a < 1e-4 || Math.abs(v) >= 1e6) return v.toExponential(1);
    var dec = Math.max(0, -Math.floor(Math.log10(a)));
    return v.toFixed(dec);
  }
  function fmtAxisX(v) {
    if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
    return String(Math.round(v));
  }

  /* Raw series always drawn; optional moving-average overlay. Non-finite values
   * break the line (never drawn as 0) and are marked. */
  function lossChart(container, opts) {
    container.innerHTML = "";
    container.classList.add("chart-host");
    var pts = opts.points || [];
    var finite = pts.filter(function (p) { return isFinite(p.y); });
    if (!finite.length) { container.appendChild(h("div", { class: "chart-empty", text: opts.emptyText || "No loss data yet." })); return; }
    var W = Math.max(container.clientWidth || 640, 280), H = opts.height || 170;
    var pad = { l: 60, r: 12, t: 10, b: 26 };
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var xs = pts.map(function (p) { return p.x; });
    var xmin = opts.xmin != null ? opts.xmin : Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    if (xmax === xmin) xmax = xmin + 1;
    var ys = finite.map(function (p) { return p.y; });
    var ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (ymax === ymin) { ymin -= Math.abs(ymin) * 0.1 || 0.1; ymax += Math.abs(ymax) * 0.1 || 0.1; }
    var step = niceStep(ymax - ymin, 4);
    var y0 = Math.floor(ymin / step) * step, y1 = Math.ceil(ymax / step) * step;
    var sx = function (v) { return pad.l + (v - xmin) / (xmax - xmin) * iw; };
    var sy = function (v) { return pad.t + ih - (v - y0) / (y1 - y0) * ih; };

    var dxs = [];
    for (var i = 1; i < pts.length; i++) dxs.push(pts[i].x - pts[i - 1].x);
    dxs.sort(function (a, b) { return a - b; });
    var medDx = dxs.length ? dxs[Math.floor(dxs.length / 2)] : 1;

    function path(values) {
      var d = "", pen = false;
      for (var k = 0; k < pts.length; k++) {
        var y = values[k];
        var gap = k > 0 && pts[k].x - pts[k - 1].x > medDx * 1.5;
        if (!isFinite(y)) { pen = false; continue; }
        d += (pen && !gap ? "L" : "M") + sx(pts[k].x).toFixed(1) + "," + sy(y).toFixed(1);
        pen = true;
      }
      return d;
    }
    var raw = pts.map(function (p) { return p.y; });
    var sm = null, win = opts.window || 10;
    if (opts.smoothing) {
      sm = raw.map(function (_, k) {
        if (!isFinite(raw[k])) return NaN;
        var s = 0, c = 0;
        for (var j = Math.max(0, k - win + 1); j <= k; j++) if (isFinite(raw[j])) { s += raw[j]; c++; }
        return c ? s / c : NaN;
      });
    }

    var svg = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + (opts.label || "Loss") + ' chart">';
    for (var t = y0; t <= y1 + step / 2; t += step) {
      var yy = sy(t).toFixed(1);
      svg += '<line x1="' + pad.l + '" y1="' + yy + '" x2="' + (W - pad.r) + '" y2="' + yy + '" stroke="#E9E9E7"/>' +
        '<text x="' + (pad.l - 8) + '" y="' + (+yy + 4) + '" font-size="11" fill="#73716A" text-anchor="end">' + tickLabel(t, step) + "</text>";
    }
    if (y0 < 0 && y1 > 0) svg += '<line x1="' + pad.l + '" y1="' + sy(0).toFixed(1) + '" x2="' + (W - pad.r) + '" y2="' + sy(0).toFixed(1) + '" stroke="#C9C7C1" stroke-dasharray="3 3"/>';
    for (var q = 0; q <= 4; q++) {
      var xv = xmin + (xmax - xmin) * q / 4;
      svg += '<text x="' + sx(xv).toFixed(1) + '" y="' + (H - 7) + '" font-size="11" fill="#73716A" text-anchor="middle">' + fmtAxisX(xv) + "</text>";
    }
    pts.forEach(function (p) {
      if (!isFinite(p.y)) {
        var xx = sx(p.x).toFixed(1);
        svg += '<line x1="' + xx + '" y1="' + pad.t + '" x2="' + xx + '" y2="' + (pad.t + ih) + '" stroke="#A83A32" stroke-dasharray="4 3"/>' +
          '<text x="' + (+xx - 4) + '" y="' + (pad.t + 12) + '" font-size="11" fill="#A83A32" text-anchor="end">' + (isNaN(p.y) ? "NaN" : "Inf") + "</text>";
      }
    });
    svg += '<path d="' + path(raw) + '" fill="none" stroke="' + (sm ? "#C9C7C1" : "#37352F") + '" stroke-width="' + (sm ? 1 : 1.5) + '"/>';
    if (sm) svg += '<path d="' + path(sm) + '" fill="none" stroke="#37352F" stroke-width="1.6"/>';
    svg += '<line class="hover-line" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + ih) + '" stroke="#73716A" stroke-width="1" visibility="hidden"/>';
    svg += "</svg>";
    container.innerHTML = svg;
    var tip = h("div", { class: "chart-tip" });
    container.appendChild(tip);
    var svgEl = container.querySelector("svg"), hl = svgEl.querySelector(".hover-line");
    svgEl.addEventListener("mousemove", function (e) {
      var rect = svgEl.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      if (mx < pad.l || mx > W - pad.r) { tip.style.display = "none"; hl.setAttribute("visibility", "hidden"); return; }
      var xv = xmin + (mx - pad.l) / iw * (xmax - xmin);
      var best = 0, bd = Infinity;
      pts.forEach(function (p, k) { var d = Math.abs(p.x - xv); if (d < bd) { bd = d; best = k; } });
      var p = pts[best];
      var px = sx(p.x);
      hl.setAttribute("x1", px); hl.setAttribute("x2", px); hl.setAttribute("visibility", "visible");
      tip.innerHTML = "";
      tip.appendChild(h("div", { text: "Iteration " + fmtNum(p.x) }));
      tip.appendChild(h("div", { text: "Raw " + (isFinite(p.y) ? fmtValue(p.y) : String(p.y)) }));
      if (sm) tip.appendChild(h("div", { text: "Smoothed " + (isFinite(sm[best]) ? fmtValue(+sm[best].toPrecision(6)) : "—") }));
      tip.style.display = "block";
      tip.style.left = Math.min(px + 10, W - 150) + "px";
      tip.style.top = (pad.t + 6) + "px";
    });
    svgEl.addEventListener("mouseleave", function () { tip.style.display = "none"; hl.setAttribute("visibility", "hidden"); });
  }

  /* ---------------- MuJoCo viewer (VIEWER-01) ---------------- */
  function viewerBase() { return (window.DB && DB.viewerBase != null) ? DB.viewerBase : "http://localhost:8766"; }
  function frameQuery(o) {
    return "variant=" + (o.variant || "standard") + "&cam=" + (o.cam || "side") + "&w=" + o.w + "&h=" + o.h + "&color=" + (o.color || "orange");
  }
  function fmtClock(d) {
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /* Static model poster at the exact size of its frame (for showcase cards). */
  function poster(opts) {
    var w = opts.w || 376, h0 = opts.h || 282;
    var box = h("div", { class: "poster", style: "aspect-ratio:" + w + " / " + h0 });
    var img = h("img", { alt: opts.alt || "Model poster", loading: "lazy" });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    img.src = viewerBase() + "/api/frame.jpg?" + frameQuery({ variant: opts.variant, cam: opts.cam || "iso", w: Math.round(w * dpr), h: Math.round(h0 * dpr) }) + "&t=" + Date.now();
    img.addEventListener("error", function () {
      box.innerHTML = "";
      box.classList.add("poster-missing");
      box.appendChild(h("div", { text: "Preview unavailable" }));
    });
    box.appendChild(img);
    if (opts.label) box.appendChild(h("span", { class: "poster-label", text: opts.label }));
    return box;
  }

  /* Live viewer. Viewport-sized frames (VIEWER-01). Camera is a MuJoCo free
   * camera: left-drag orbit, right/shift-drag pan, scroll or Ctrl-drag zoom. */
  function viewer(host, opts) {
    opts = opts || {};
    var model = { variant: opts.variant || "standard", color: opts.color || "orange" };
    var state = "Loading model", alive = true;
    var size = { w: 0, h: 0 }, token = 0, lastFrameAt = null, shownModel = null;
    var pollTimer = null, resizeTimer = null, viewId = null, viewVariant = null;
    var pendingMove = null, moveRaf = 0, drag = null, clickTimer = 0;

    var root = h("div", { class: "viewer" });
    var title = h("span", { class: "viewer-title", text: opts.label || "Model preview" });
    var stateEl = h("span", {});
    var assistEl = h("span", { class: "tag", text: "Stabilization assist", title: "The trunk is held by an external force. This is not policy behaviour." });
    var subs = (opts.sub || []).slice();
    if (opts.commands) subs.push("No trained policy is loaded.");
    var head = h("div", { class: "viewer-head" }, h("div", { class: "flex" }, title, stateEl, opts.assist === false ? null : assistEl),
      h("div", { class: "viewer-sub" }, subs.map(function (s) { return h("span", { text: s }); })));
    var viewport = h("div", { class: "viewer-viewport" + (opts.size ? " vp-" + opts.size : "") + (opts.onPick ? " is-place" : ""), tabindex: "0",
      role: "application",
      "aria-label": "Model preview. Left-drag to orbit, right-drag or Shift-drag to pan, scroll to zoom, R to reset the view." });
    var img = h("img", { class: "viewer-img", alt: (opts.label || "Model preview") + " — MuJoCo", draggable: "false" });
    var overlay = h("div", { class: "viewer-overlay" });
    var hint = h("div", { class: "viewer-hint", text: opts.hint || (opts.reset
      ? "Left-drag orbit · Right-drag pan · Scroll zoom · R reset view · Backspace reset pose"
      : "Left-drag orbit · Right-drag pan · Scroll zoom · R reset view") });
    viewport.appendChild(img); viewport.appendChild(overlay); viewport.appendChild(hint);
    if (opts.head !== false) root.appendChild(head);
    root.appendChild(viewport);
    if (opts.details) root.appendChild(fold("Preview details", false, opts.details.map(function (d) { return kv(d[0], d[1]); })));
    host.appendChild(root);

    function setState(s, extra) {
      state = s;
      stateEl.innerHTML = "";
      stateEl.appendChild(badge(s));
      overlay.innerHTML = "";
      overlay.className = "viewer-overlay";
      hint.hidden = s === "Viewer unavailable";
      if (s === "Viewer unavailable") {
        overlay.className = "viewer-overlay full";
        overlay.appendChild(h("div", { class: "viewer-msg" },
          h("div", { class: "strong", text: "Viewer unavailable" }),
          h("div", { text: "The local MuJoCo engine is not reachable. Start it, then retry:" }),
          h("code", { text: "cd trainmybot/server && ./start.sh" }),
          h("div", { class: "mt8" }, h("button", { class: "btn btn-sm", onclick: function () { reload(); } }, "Retry preview"))));
      } else if (s === "Disconnected") {
        overlay.appendChild(h("span", { class: "viewer-chip", text: "Last frame at " + (lastFrameAt ? fmtClock(lastFrameAt) : "—") + " · not live" }));
      } else if (s === "Loading model" || s === "Resizing preview" || s === "Applying hardware") {
        overlay.appendChild(h("span", { class: "viewer-chip", text: s + "…" }));
      } else if (s === "Previous model shown") {
        overlay.appendChild(h("span", { class: "viewer-chip err", text: extra || "Could not load the new model. Previous model shown." }));
      }
      if (opts.onState) opts.onState(s);
    }

    function measure() {
      var r = viewport.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(r.width * dpr), hh = Math.round(r.height * dpr);
      var k = Math.min(1, 1600 / w, 1200 / hh);
      return { w: Math.max(2, Math.round(w * k)), h: Math.max(2, Math.round(hh * k)) };
    }
    function url(kind) {
      if (!viewId) return "";
      return viewerBase() + "/api/" + kind + "?view=" + encodeURIComponent(viewId) +
        "&w=" + size.w + "&h=" + size.h + "&color=" + encodeURIComponent(model.color) + "&t=" + Date.now();
    }
    function api(path) {
      return fetch(viewerBase() + "/api/" + path).then(function (r) { if (!r.ok) throw new Error(path); return r.json(); });
    }

    function closeView() {
      if (!viewId) return;
      var id = viewId;
      viewId = null; viewVariant = null;
      fetch(viewerBase() + "/api/view/close?id=" + encodeURIComponent(id)).catch(function () {});
    }
    function openView() {
      return api("view/open?variant=" + encodeURIComponent(model.variant) +
        "&w=" + size.w + "&h=" + size.h + "&color=" + encodeURIComponent(model.color))
        .then(function (s) {
          if (!alive) { fetch(viewerBase() + "/api/view/close?id=" + encodeURIComponent(s.id)).catch(function () {}); return null; }
          viewId = s.id; viewVariant = model.variant;
          return s;
        });
    }
    function ensureView(reopen) {
      var m = measure();
      if (!m) return Promise.resolve(null);
      size = m;
      if (reopen || !viewId || viewVariant !== model.variant) {
        closeView();
        return openView();
      }
      return api("view/update?id=" + encodeURIComponent(viewId) +
        "&w=" + size.w + "&h=" + size.h + "&color=" + encodeURIComponent(model.color))
        .then(function () { return { id: viewId }; })
        .catch(function () { closeView(); return openView(); });
    }

    function reload(kindState, failMsg, reopen) {
      if (!alive) return;
      var my = ++token;
      if (kindState) setState(kindState);
      else if (state === "Viewer unavailable") setState("Loading model");
      ensureView(reopen).then(function (s) {
        if (my !== token || !alive) return;
        if (!s) { setState("Viewer unavailable"); return; }
        var pre = new Image();
        pre.onload = function () {
          if (my !== token || !alive) return;
          img.src = pre.src;
          shownModel = { variant: model.variant, color: model.color };
          lastFrameAt = new Date();
          img.src = url("stream.mjpeg");
          setState("Ready");
          poll();
        };
        pre.onerror = function () {
          if (my !== token || !alive) return;
          if (shownModel && failMsg) {
            model = { variant: shownModel.variant, color: shownModel.color };
            setState("Previous model shown", failMsg);
            if (opts.onModelError) opts.onModelError(shownModel);
          } else setState("Viewer unavailable");
        };
        pre.src = url("frame.jpg");
      }).catch(function () {
        if (my !== token || !alive) return;
        if (shownModel && failMsg) {
          model = { variant: shownModel.variant, color: shownModel.color };
          setState("Previous model shown", failMsg);
          if (opts.onModelError) opts.onModelError(shownModel);
        } else setState("Viewer unavailable");
      });
    }

    function flushMove() {
      moveRaf = 0;
      if (!pendingMove || !viewId || !alive) return;
      var p = pendingMove; pendingMove = null;
      fetch(viewerBase() + "/api/view/move?id=" + encodeURIComponent(viewId) +
        "&action=" + encodeURIComponent(p.action) + "&dx=" + p.dx + "&dy=" + p.dy).catch(function () {});
    }
    function queueMove(action, dx, dy) {
      if (!viewId) return;
      if (action === "fit") {
        pendingMove = null;
        fetch(viewerBase() + "/api/view/move?id=" + encodeURIComponent(viewId) + "&action=fit").catch(function () {});
        return;
      }
      if (pendingMove && pendingMove.action === action) {
        pendingMove.dx += dx; pendingMove.dy += dy;
      } else pendingMove = { action: action, dx: dx, dy: dy };
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    }

    function dragAction(e) {
      if (e.button === 1 || e.ctrlKey || e.metaKey) return "zoom";
      if (e.button === 2) return e.shiftKey ? "pan_v" : "pan";
      if (e.button === 0) return e.shiftKey ? "pan" : "rotate";
      return null;
    }
    function onPointerDown(e) {
      var action = dragAction(e);
      if (!action) return;
      e.preventDefault();
      viewport.focus();
      drag = { action: action, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: 0 };
      viewport.classList.add("is-dragging");
      try { viewport.setPointerCapture(e.pointerId); } catch (err) {}
    }
    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var hh = viewport.clientHeight || 1;
      var dx = (e.clientX - drag.x) / hh, dy = (e.clientY - drag.y) / hh;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      queueMove(drag.action, dx, dy);
    }
    function onPointerUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      var was = drag;
      drag = null;
      viewport.classList.remove("is-dragging");
      if (opts.onPick && was.action === "rotate" && was.moved < 0.012 && viewId) {
        var rect = viewport.getBoundingClientRect();
        var nx = (e.clientX - rect.left) / Math.max(rect.width, 1);
        var ny = (e.clientY - rect.top) / Math.max(rect.height, 1);
        clearTimeout(clickTimer);
        var id = viewId;
        clickTimer = setTimeout(function () {
          if (alive) opts.onPick(nx, ny, id);
        }, 220);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      viewport.focus();
      var hh = viewport.clientHeight || 1;
      queueMove("zoom", 0, -e.deltaY / hh);
    }
    function onKey(e) {
      if (e.target !== viewport) return;
      var step = 0.06, zoom = 0.12;
      if (e.key === "r" || e.key === "R" || e.key === "Home") { e.preventDefault(); queueMove("fit", 0, 0); return; }
      if (opts.reset && e.key === "Backspace") { e.preventDefault(); command("reset"); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); queueMove(e.shiftKey ? "pan" : "rotate", -step, 0); }
      else if (e.key === "ArrowRight") { e.preventDefault(); queueMove(e.shiftKey ? "pan" : "rotate", step, 0); }
      else if (e.key === "ArrowUp") { e.preventDefault(); queueMove(e.shiftKey ? "pan_v" : "rotate", 0, -step); }
      else if (e.key === "ArrowDown") { e.preventDefault(); queueMove(e.shiftKey ? "pan_v" : "rotate", 0, step); }
      else if (e.key === "=" || e.key === "+") { e.preventDefault(); queueMove("zoom", 0, zoom); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); queueMove("zoom", 0, -zoom); }
    }
    function onContext(e) { e.preventDefault(); }

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("keydown", onKey);
    viewport.addEventListener("contextmenu", onContext);
    viewport.addEventListener("dblclick", function (e) { e.preventDefault(); clearTimeout(clickTimer); queueMove("fit", 0, 0); });

    function command(cmd) {
      fetch(viewerBase() + "/api/command?variant=" + model.variant + "&cmd=" + cmd)
        .then(function (r) { return r.json(); })
        .then(function () { poll(); })
        .catch(function () { setState("Viewer unavailable"); });
    }

    function poll() {
      if (!alive) return;
      fetch(viewerBase() + "/api/status?variant=" + model.variant)
        .then(function (r) { if (!r.ok) throw new Error("status"); return r.json(); })
        .then(function (s) {
          if (!alive) return;
          assistEl.style.display = s.assist ? "" : "none";
          lastFrameAt = new Date();
          if (state === "Disconnected") reload();
        })
        .catch(function () {
          if (!alive) return;
          if (state === "Ready") setState("Disconnected");
          else if (state === "Loading model") setState("Viewer unavailable");
        });
    }

    var ro = new ResizeObserver(function () {
      if (!alive) return;
      var m = measure();
      if (!m) return;
      if (Math.abs(m.w - size.w) < 4 && Math.abs(m.h - size.h) < 4) return;
      clearTimeout(resizeTimer);
      if (size.w) setState("Resizing preview");
      resizeTimer = setTimeout(function () { reload(size.w ? "Resizing preview" : null); }, size.w ? 220 : 0);
    });
    ro.observe(viewport);
    setState("Loading model");
    pollTimer = setInterval(poll, 3000);

    return {
      setModel: function (next, failMsg) {
        var changedHw = next.variant && next.variant !== model.variant;
        model = { variant: next.variant || model.variant, color: next.color || model.color };
        reload(changedHw ? "Applying hardware" : null, failMsg || (changedHw ? "Could not load the " + (model.variant === "roller" ? "roller" : "standard feet") + " model." : "Could not apply the color."), changedHw);
      },
      destroy: function () {
        alive = false;
        clearTimeout(clickTimer);
        ro.disconnect();
        clearInterval(pollTimer);
        cancelAnimationFrame(moveRaf);
        closeView();
        viewport.removeEventListener("pointerdown", onPointerDown);
        viewport.removeEventListener("pointermove", onPointerMove);
        viewport.removeEventListener("pointerup", onPointerUp);
        viewport.removeEventListener("pointercancel", onPointerUp);
        viewport.removeEventListener("wheel", onWheel);
        viewport.removeEventListener("keydown", onKey);
        viewport.removeEventListener("contextmenu", onContext);
        try { img.src = ""; } catch (e) {}
      }
    };
  }

  return {
    h: h, toast: toast, modal: modal, confirm: confirmDialog, badge: badge, sampleTag: sampleTag,
    fmtNum: fmtNum, fmtValue: fmtValue, fmtHMS: fmtHMS, fmtCredits: fmtCredits, parseNum: parseNum,
    tabs: tabs, field: field, section: section, fold: fold, prop: prop, kv: kv, empty: empty, alert: alert, th: th, menu: menu,
    download: download, copyText: copyText, lossChart: lossChart, viewer: viewer, poster: poster, fmtClock: fmtClock,
    filterMeta: function (shown, total, filtered, onClear, noun) {
      return h("div", { class: "filter-meta" },
        h("span", { class: "small muted", text: shown + " of " + total + (noun ? " " + noun : "") }),
        filtered ? h("button", { class: "link-btn", onclick: onClear }, "Clear filters") : null);
    }
  };
})();
