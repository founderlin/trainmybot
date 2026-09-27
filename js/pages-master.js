/* Microduck — MASTER: Account and Credits (Overview, Top-up history, Training bills),
 * Bill details and Review request (AUTH-01). The only place where financial values appear. */
(function () {
  "use strict";
  var h = UI.h;
  var FIN = function () { return DB.finance; };
  window.Pages = window.Pages || {};
  Pages._ticks = Pages._ticks || [];

  function billNet(b) {
    return b.items.reduce(function (s, i) { return s + i.credits; }, 0) + (b.adjustments || []).reduce(function (s, a) { return s + a.credits; }, 0);
  }
  function billUsage(b) {
    var units = {};
    b.items.forEach(function (i) { units[i.unit] = (units[i.unit] || 0) + i.qty; });
    var keys = Object.keys(units);
    if (keys.length !== 1) return "Multiple items";
    return (Math.round(units[keys[0]] * 100) / 100) + " " + keys[0] + (units[keys[0]] === 1 ? "" : "s");
  }
  function inRange(dateStr, range) {
    if (!range || range === "all") return true;
    var days = range === "7d" ? 7 : 30;
    var d = new Date(dateStr.replace(" ", "T"));
    return (Date.now() - d.getTime()) <= days * 86400000;
  }
  function csv(rows) {
    return rows.map(function (r) { return r.map(function (c) { c = c == null ? "" : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\n") + "\n";
  }
  function rangeSelect(value, onChange) {
    var s = h("select", { class: "input", "aria-label": "Date range", onchange: function () { onChange(s.value); } },
      h("option", { value: "all", text: "All time" }), h("option", { value: "30d", text: "Last 30 days", selected: value === "30d" }), h("option", { value: "7d", text: "Last 7 days", selected: value === "7d" }));
    return s;
  }

  /* =============================== router =============================== */
  Pages.master = function (view, params) {
    var parts = params.parts || [];
    var top = parts[0] || App.state.masterTab || "account";
    if (top !== "account" && top !== "credits") top = "account";
    App.state.masterTab = top;
    var page = h("div", { class: "page" });
    view.appendChild(page);

    if (top === "credits" && parts[1] === "review" && parts[2]) { App.title("MASTER / Credits / Review request"); reviewRequest(page, parts[2]); return; }
    if (top === "credits" && parts[1] === "bills" && parts[2]) { App.title("MASTER / Credits / Training bills / " + parts[2]); billDetails(page, parts[2]); return; }
    if (top === "credits" && parts[1] === "topups" && parts[2]) { App.title("MASTER / Credits / Top-up history / " + parts[2]); topupDetails(page, parts[2]); return; }

    page.appendChild(h("div", { class: "page-head" }, h("h1", { class: "page-title", text: "Master" })));
    page.appendChild(UI.tabs([["account", "Account"], ["credits", "Credits"]], top, function (t) { App.go("#/master/" + t); }));
    if (top === "account") { App.title("MASTER / Account"); account(page); return; }
    var sub = parts[1] || "overview";
    App.title("MASTER / Credits");
    creditsHeader(page);
    page.appendChild(UI.tabs([["overview", "Overview"], ["topups", "Top-up history"], ["bills", "Training bills"]], sub, function (t) { App.go("#/master/credits/" + t); }, "tabs-sub"));
    if (sub === "topups") topups(page);
    else if (sub === "bills") bills(page, params.query || {});
    else overview(page);
  };

  /* =============================== Account =============================== */
  function account(page) {
    var nameIn = h("input", { class: "input", value: "Fangzheng Lin" });
    page.appendChild(UI.section("Profile", null,
      h("div", { class: "form-row" }, UI.field("Display name", nameIn), UI.field("Email", h("div", { class: "flex" }, h("span", { text: "fangzhenglin@example.com" }), UI.badge("Verified", "ok")))),
      UI.kv("Account ID", h("span", { class: "flex" }, h("code", { text: "acct_7f3c21" }), h("button", { class: "btn btn-sm btn-ghost", onclick: function () { UI.copyText("acct_7f3c21", "Account ID"); } }, "Copy"))),
      h("div", { class: "mt12" }, h("button", { class: "btn", onclick: function () { UI.toast("Profile saved (demo session only).", "ok"); } }, "Save changes"))));
    var active = DB.runs.filter(function (r) { return ["Queued", "Initializing", "Running", "Stopping"].indexOf(r.status) >= 0; }).length;
    var sessions = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Device"), UI.th("Last activity"), UI.th(""))),
      h("tbody", {},
        h("tr", {}, h("td", {}, "This browser ", h("span", { class: "tag", text: "Current" })), h("td", { text: DB.stamp() }), h("td", {})),
        h("tr", {}, h("td", { text: "Safari · macOS" }), h("td", { text: "2026-09-24 21:10" }), h("td", {}, h("button", { class: "btn btn-sm", onclick: function (e) { e.target.closest("tr").remove(); UI.toast("Session revoked.", "ok"); } }, "Revoke session")))));
    page.appendChild(UI.section("Security & sessions", "Sign-in method: email and password. Two-factor authentication is not available yet.",
      h("div", { class: "table-wrap" }, sessions),
      active ? UI.alert("info", "You have active training runs. Signing out does not stop them.") : null,
      h("div", { class: "mt12" }, h("button", { class: "btn btn-danger", onclick: function () { UI.toast("Sign-out is not connected in this demo."); } }, "Sign out"))));
  }

  /* =============================== Credits =============================== */
  function creditsHeader(page) {
    var f = FIN();
    page.appendChild(h("div", { class: "balance-row" },
      h("div", {},
        h("div", { class: "small muted", text: "Available credits" }),
        h("div", { class: "flex" }, h("span", { class: "balance", id: "m-balance", text: UI.fmtCredits(f.balance) }), h("span", { class: "muted", text: "Credits" }), UI.sampleTag()),
        h("div", { class: "small muted", id: "m-balance-upd", text: "Updated at " + f.balanceUpdated + " (" + f.timezone + ")" })),
      h("button", { class: "btn btn-primary", onclick: addCredits }, "Add credits")));
  }

  function overview(page) {
    var f = FIN();
    var pending = f.requests.filter(function (r) { return r.status === "Pending review"; });
    if (pending.length) {
      var t = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Request"), UI.th("Source"), UI.th("Status"), UI.th(""))));
      t.appendChild(h("tbody", {}, pending.map(function (r) {
        return h("tr", { onclick: function () { App.go("#/master/credits/review/" + r.id); } },
          h("td", { class: "row-title", text: r.id }), h("td", { text: sourceName(r) }), h("td", {}, UI.badge(r.status)),
          h("td", {}, h("button", { class: "btn btn-sm", onclick: function (e) { e.stopPropagation(); App.go("#/master/credits/review/" + r.id); } }, "Review")));
      })));
      page.appendChild(UI.section("Requests requiring review", null, h("div", { class: "table-wrap" }, t)));
    }

    var range = App.state.overviewRange || "30d";
    var matching = f.bills.filter(function (b) { return inRange(b.date, range); });
    var settled = matching.filter(function (b) { return b.status === "Settled"; }).reduce(function (s, b) { return s + billNet(b); }, 0);
    var pend = matching.filter(function (b) { return b.status !== "Settled"; }).reduce(function (s, b) { return s + billNet(b); }, 0);
    page.appendChild(UI.section("Spending summary", null,
      h("div", { class: "flex-between mb8" }, h("span", { class: "small muted", text: "By bill start date · " + f.timezone }), rangeSelect(range, function (v) { App.state.overviewRange = v; App.rerender(); })),
      h("div", { class: "summary-row" },
        h("button", { class: "summary-link", onclick: function () { App.state.billsFilter = { status: "Settled", service: "", q: "", range: range }; App.go("#/master/credits/bills"); } },
          UI.kv("Settled usage", UI.fmtCredits(settled) + " Credits")),
        h("button", { class: "summary-link", onclick: function () { App.state.billsFilter = { status: "pending", service: "", q: "", range: range }; App.go("#/master/credits/bills"); } },
          UI.kv("Pending usage (estimate)", UI.fmtCredits(pend) + " Credits"))),
      h("div", { class: "small muted", text: "Pending usage is provisional and never added to settled usage. " }, UI.sampleTag())));

    var auths = f.requests.filter(function (r) { return r.status === "Confirmed"; });
    page.appendChild(UI.section("Confirmed requests not yet started", "A confirmed request does not start anything. It can be revoked until it is used.",
      auths.length ? h("div", { class: "table-wrap" }, h("table", { class: "tbl tbl-static" },
        h("thead", {}, h("tr", {}, UI.th("Request"), UI.th("Source"), UI.th("Request limit", true), UI.th("Confirmed"), UI.th(""))),
        h("tbody", {}, auths.map(function (r) {
          return h("tr", {}, h("td", { class: "row-title", text: r.id }), h("td", { text: sourceName(r) }), h("td", { class: "num", text: UI.fmtCredits(r.limit) + " Credits" }), h("td", { text: r.confirmedAt }),
            h("td", {}, h("div", { class: "flex" }, h("button", { class: "btn btn-sm", onclick: function () { App.go(r.returnHash); } }, r.returnLabel || "Return"),
              h("button", { class: "btn btn-sm btn-ghost", onclick: function () { r.status = "Revoked"; UI.toast("Unused authorization revoked. Nothing was charged.", "ok"); App.rerender(); } }, "Revoke"))));
        })))) : h("div", { class: "small muted", text: "None." })));

    var limitIn = h("input", { class: "input input-num", inputmode: "decimal", value: f.controls.defaultLimit == null ? "" : String(f.controls.defaultLimit) });
    var low = h("input", { type: "checkbox", checked: f.controls.lowBalance });
    low.addEventListener("change", function () { f.controls.lowBalance = low.checked; UI.toast(low.checked ? "Low balance notifications on (shown only in Master)." : "Low balance notifications off.", "ok"); });
    page.appendChild(UI.section("Spending controls", null,
      h("div", { class: "form-row" },
        UI.field("Default request limit (Credits)", h("div", { class: "flex" }, limitIn, h("button", { class: "btn", onclick: function () {
          var v = UI.parseNum(limitIn.value);
          if (!(v > 0)) { UI.toast("Enter a positive limit.", "err"); return; }
          f.controls.defaultLimit = v; UI.toast("Default request limit saved. Existing authorizations are not changed.", "ok");
        } }, "Save")), { helper: "Suggested limit for new requests. It never changes an existing authorization." }),
        UI.field("Low balance notification", h("label", { class: "toggle" }, low, h("span", { class: "tk" }), h("span", { class: "tl", text: "Notify in Master" })))),
      h("div", { class: "small muted", text: "Automatic top-up is not offered: the payment service has not been confirmed." })));
  }

  function sourceName(r) {
    if (r.source.type === "run-draft") { var d = DB.draft(r.source.draftId); return "Run draft · " + (d ? d.name || "Untitled" : r.source.draftId); }
    if (r.source.type === "result") { var res = DB.result(r.source.resultId); return "Result · " + (res ? res.name + " v" + res.version : r.source.resultId); }
    if (r.source.type === "run") { var run = DB.run(r.source.runId); return "Run · " + (run ? run.name : r.source.runId); }
    return "—";
  }

  /* ---------------- Add credits ---------------- */
  function addCredits() {
    var amtIn = h("input", { class: "input input-num", inputmode: "decimal", value: "100" });
    var recv = h("span", { class: "strong", text: "100 Credits" });
    amtIn.addEventListener("input", function () { var v = UI.parseNum(amtIn.value); recv.textContent = v > 0 ? UI.fmtNum(v) + " Credits" : "—"; });
    UI.modal({
      title: "Add credits",
      body: h("div", {},
        UI.alert("warn", "Demo checkout — no real payment is made. Conversion, fees, taxes and payment methods have not been confirmed; the values below are sample data."),
        h("div", { class: "form-row" }, UI.field("Amount (CNY)", amtIn), UI.field("Credits to receive", h("div", { class: "flex" }, recv, UI.sampleTag("Sample conversion")))),
        UI.kv("Payment method", "Demo card ·••• 4242"),
        UI.kv("Fees and taxes", "Not defined"),
        h("p", { class: "small muted mt8", text: "Payment success and credits being added are separate steps. If the result is unknown, check the order before paying again." })),
      actions: [{ label: "Cancel" }, { label: "Pay (demo)", kind: "primary", onClick: function () {
        var v = UI.parseNum(amtIn.value);
        if (!(v > 0)) { UI.toast("Enter a positive amount.", "err"); return true; }
        var id = "ord-" + DB.stamp().slice(0, 10).replace(/-/g, "") + "-9" + String(DB.state.nextOrder++).padStart(3, "0");
        FIN().topups.unshift({ id: id, date: DB.stamp(), amount: v, currency: "CNY", credits: null, purchased: v, status: "Pending payment", method: "Demo card ·••• 4242", paidAt: null, creditedAt: null, _t: 0 });
        UI.toast("Order " + id + " created. Your payment status is being checked.", "ok");
        App.go("#/master/credits/topups");
      } }]
    });
  }
  Pages._ticks.push(function () {
    var changed = false;
    FIN().topups.forEach(function (t) {
      if (t.status === "Pending payment" && ++t._t >= 1) { t.status = "Processing"; t.paidAt = DB.stamp(); t._t = 0; changed = true; }
      else if (t.status === "Processing" && t._t != null && ++t._t >= 2 && !t._posted) {
        t._posted = true; t.status = "Credits added"; t.credits = t.purchased; t.creditedAt = DB.stamp();
        FIN().balance = Math.round((FIN().balance + t.credits) * 100) / 100; FIN().balanceUpdated = DB.stamp(); changed = true;
      }
    });
    var el = document.getElementById("m-balance");
    if (el) { el.textContent = UI.fmtCredits(FIN().balance); var u = document.getElementById("m-balance-upd"); if (u) u.textContent = "Updated at " + FIN().balanceUpdated + " (" + FIN().timezone + ")"; }
    if (changed && Pages._masterUpdate) Pages._masterUpdate();
  });

  /* ---------------- Top-up history ---------------- */
  function topups(page) {
    var F = App.state.topupFilter || (App.state.topupFilter = { range: "all", status: "", q: "" });
    var q = h("input", { class: "input", type: "search", placeholder: "Search order", value: F.q, oninput: function () { F.q = q.value; paint(); } });
    var st = h("select", { class: "input", "aria-label": "Status", onchange: function () { F.status = st.value; paint(); } }, h("option", { value: "", text: "All statuses" }));
    ["Pending payment", "Processing", "Credits added", "Failed", "Cancelled", "Refund pending", "Partially refunded", "Refunded"].forEach(function (s) { st.appendChild(h("option", { value: s, text: s, selected: F.status === s })); });
    page.appendChild(h("div", { class: "toolbar" }, rangeSelect(F.range, function (v) { F.range = v; paint(); }), st, q,
      h("button", { class: "btn", onclick: function () {
        var rows = [["order_id", "created_at", "amount", "currency", "credits_added", "status", "paid_at", "credited_at", "timezone"]];
        list().forEach(function (t) { rows.push([t.id, t.date, t.amount, t.currency, t.credits, t.status, t.paidAt, t.creditedAt, FIN().timezone]); });
        UI.download("top-ups.csv", csv(rows), "text/csv"); UI.toast("All matching records exported (" + (rows.length - 1) + ").", "ok");
      } }, "Export")));
    var box = h("div", {});
    page.appendChild(box);
    function list() {
      return FIN().topups.filter(function (t) { return inRange(t.date, F.range) && (!F.status || t.status === F.status) && (!F.q || t.id.indexOf(F.q) >= 0); });
    }
    function paint() {
      box.innerHTML = "";
      if (!FIN().topups.length) { box.appendChild(UI.empty("No top-ups yet. Add credits to get started.")); return; }
      var l = list();
      if (!l.length) { box.appendChild(UI.empty("No top-ups match these filters.", h("button", { class: "btn", onclick: function () { App.state.topupFilter = null; App.rerender(); } }, "Clear filters"))); return; }
      var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Date"), UI.th("Order"), UI.th("Amount", true), UI.th("Credits", true), UI.th("Status"))));
      tbl.appendChild(h("tbody", {}, l.map(function (t) {
        return h("tr", { onclick: function () { App.go("#/master/credits/topups/" + t.id); } },
          h("td", { text: t.date }), h("td", {}, h("code", { text: t.id })), h("td", { class: "num", text: t.amount.toFixed(2) + " " + t.currency }),
          h("td", { class: "num", text: t.credits == null ? "—" : UI.fmtNum(t.credits) }),
          h("td", {}, UI.badge(t.status), t.status === "Processing" ? h("div", { class: "row-sub", text: "Payment received. Credits are being added." }) : null));
      })));
      box.appendChild(h("div", { class: "table-wrap" }, tbl));
      box.appendChild(h("div", { class: "small muted mt8" }, l.length + " orders · times in " + FIN().timezone + " · Amounts in different currencies are never summed. ", UI.sampleTag()));
    }
    paint();
    Pages._masterUpdate = paint;
    App.onLeave(function () { Pages._masterUpdate = null; });
  }

  function topupDetails(page, id) {
    var t = FIN().topups.filter(function (x) { return x.id === id; })[0];
    if (!t) { page.appendChild(UI.empty("Order not found.")); return; }
    page.appendChild(h("div", { class: "page-head" }, h("div", {}, h("div", { class: "small muted" }, h("button", { class: "link-btn", onclick: function () { App.go("#/master/credits/topups"); } }, "← Top-up history")),
      h("h1", { class: "page-title", text: "Order " + t.id }), h("div", { class: "page-sub" }, UI.badge(t.status)))));
    if (t.status === "Processing") page.appendChild(UI.alert("info", "Payment received. Credits are being added. Do not pay again."));
    if (t.status === "Pending payment") page.appendChild(UI.alert("info", "Your payment status is still being checked. Do not pay again yet."));
    page.appendChild(UI.section("Order", null, h("div", { class: "prop-grid" },
      UI.prop("Order ID", h("span", { class: "flex" }, h("code", { text: t.id }), h("button", { class: "btn btn-sm btn-ghost", onclick: function () { UI.copyText(t.id, "Order ID"); } }, "Copy"))),
      UI.prop("Payment amount", t.amount.toFixed(2) + " " + t.currency),
      UI.prop("Fees and taxes", "None recorded"),
      UI.prop("Credits purchased", UI.fmtNum(t.purchased || t.credits || t.amount)),
      UI.prop("Credits added", t.credits == null ? "—" : UI.fmtNum(t.credits)),
      UI.prop("Payment method", t.method),
      UI.prop("Created", t.date), UI.prop("Paid at", t.paidAt), UI.prop("Credited at", t.creditedAt), UI.prop("Timezone", FIN().timezone))),
      h("div", { class: "flex" }, h("span", { class: "small muted", text: "Receipts are not available in this demo. A receipt is not a tax invoice or a training bill." })),
      h("div", { class: "mt12" }, h("button", { class: "btn", onclick: function () { UI.toast("Issue report started for " + t.id + ". No card details are needed."); } }, "Report an issue")));
  }

  /* ---------------- Training bills ---------------- */
  function bills(page, query) {
    var F = App.state.billsFilter || (App.state.billsFilter = {});
    F.range = F.range || "all";
    var q = h("input", { class: "input", type: "search", placeholder: "Bill ID or run ID", value: F.q || "", oninput: function () { F.q = q.value; paint(); } });
    var bot = h("select", { class: "input", "aria-label": "Run or bot", onchange: function () { F.bot = bot.value; paint(); } }, h("option", { value: "", text: "All bots" }));
    DB.bots.forEach(function (b) { bot.appendChild(h("option", { value: b.id, text: b.name, selected: F.bot === b.id })); });
    var gpu = h("select", { class: "input", "aria-label": "GPU", onchange: function () { F.gpu = gpu.value; paint(); } }, h("option", { value: "", text: "All GPUs" }));
    DB.gpus.forEach(function (g) { gpu.appendChild(h("option", { value: g.id, text: g.name.replace("GeForce ", ""), selected: F.gpu === g.id })); });
    var st = h("select", { class: "input", "aria-label": "Billing status", onchange: function () { F.status = st.value; paint(); } },
      h("option", { value: "", text: "All billing statuses" }), h("option", { value: "pending", text: "Pending (not settled)", selected: F.status === "pending" }));
    ["Accruing", "Finalizing", "Settled", "Under review"].forEach(function (s) { st.appendChild(h("option", { value: s, text: s, selected: F.status === s })); });
    var svc = h("select", { class: "input", "aria-label": "Service type", onchange: function () { F.service = svc.value; paint(); } }, h("option", { value: "", text: "All services" }));
    ["Training", "Evaluation"].forEach(function (s) { svc.appendChild(h("option", { value: s, text: s, selected: F.service === s })); });
    page.appendChild(h("div", { class: "toolbar" }, rangeSelect(F.range, function (v) { F.range = v; paint(); }), bot, gpu, st, svc, q,
      h("button", { class: "btn", onclick: function () {
        var rows = [["bill_id", "run_id", "request_id", "service", "start", "usage", "credits_net", "billing_status", "rate_version", "snapshot_at", "timezone"]];
        var snap = DB.stamp();
        list().forEach(function (b) { rows.push([b.id, b.runId, b.requestId, b.service, b.date, billUsage(b), billNet(b).toFixed(4), b.status === "Settled" ? "Settled" : b.status + " (provisional)", b.rateVersion, snap, FIN().timezone]); });
        UI.download("training-bills.csv", csv(rows), "text/csv"); UI.toast("All matching records exported (" + (rows.length - 1) + ").", "ok");
      } }, "Export")));
    var summary = h("div", {}), box = h("div", {});
    page.appendChild(summary); page.appendChild(box);

    function list() {
      return FIN().bills.filter(function (b) {
        var run = DB.run(b.runId);
        if (!inRange(b.date, F.range)) return false;
        if (F.status === "pending" ? b.status === "Settled" : F.status && b.status !== F.status) return false;
        if (F.service && b.service !== F.service) return false;
        if (F.bot && (!run || run.botId !== F.bot)) return false;
        if (F.gpu && (!run || run.gpu !== F.gpu)) return false;
        if (F.q && (b.id + " " + b.runId).indexOf(F.q) < 0) return false;
        return true;
      }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    }
    function paint() {
      var l = list();
      var settled = l.filter(function (b) { return b.status === "Settled"; }).reduce(function (s, b) { return s + billNet(b); }, 0);
      var pend = l.filter(function (b) { return b.status !== "Settled"; }).reduce(function (s, b) { return s + billNet(b); }, 0);
      summary.innerHTML = "";
      summary.appendChild(h("div", { class: "summary-row mb12" }, UI.kv("Settled usage", UI.fmtCredits(settled) + " Credits"), UI.kv("Pending usage (estimate)", UI.fmtCredits(pend) + " Credits"),
        h("span", { class: "small muted", text: "All " + l.length + " matching bills · updated " + DB.stamp() })));
      box.innerHTML = "";
      if (!FIN().bills.length) { box.appendChild(UI.empty("No training bills yet. Bills appear when an authorized service records usage.")); return; }
      if (!l.length) { box.appendChild(UI.empty("No bills match these filters.", h("button", { class: "btn", onclick: function () { App.state.billsFilter = {}; App.rerender(); } }, "Clear filters"))); return; }
      var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Date"), UI.th("Run / Service"), UI.th("Usage", true), UI.th("Credits", true), UI.th("Status"))));
      tbl.appendChild(h("tbody", {}, l.map(function (b) {
        var run = DB.run(b.runId);
        return h("tr", { onclick: function () { App.go("#/master/credits/bills/" + b.id); } },
          h("td", { text: b.date }),
          h("td", {}, h("div", { class: "row-title", text: run ? run.name : b.runId }), h("div", { class: "row-sub", text: b.service + " · " + b.id })),
          h("td", { class: "num", text: billUsage(b) }),
          h("td", { class: "num" }, UI.fmtCredits(billNet(b)), h("div", { class: "row-sub", text: b.status === "Settled" ? "Settled" : "Provisional" })),
          h("td", {}, UI.badge(b.status)));
      })));
      box.appendChild(h("div", { class: "table-wrap" }, tbl));
      box.appendChild(h("div", { class: "small muted mt8" }, "Bills use prepaid credits — there is nothing to pay per bill. Run status and billing status are independent. ", UI.sampleTag()));
    }
    paint();
    var timer = setInterval(function () { if (document.activeElement !== q) paint(); }, 2000);
    App.onLeave(function () { clearInterval(timer); });
  }

  function billDetails(page, id) {
    var b = DB.bill(id);
    if (!b) { page.appendChild(UI.empty("Bill not found.")); return; }
    var run = DB.run(b.runId), req = DB.request(b.requestId);
    var bot = run && DB.bot(run.botId), cfg = run && DB.config(run.configId);
    var body = h("div", {});
    page.appendChild(body);
    function paint() {
      body.innerHTML = "";
      body.appendChild(h("div", { class: "page-head" },
        h("div", {}, h("div", { class: "small muted" }, h("button", { class: "link-btn", onclick: function () { App.go("#/master/credits/bills"); } }, "← Training bills")),
          h("h1", { class: "page-title", text: (run ? run.name : b.runId) + " · " + b.service }),
          h("div", { class: "page-sub" }, UI.badge(b.status), " Net " + UI.fmtCredits(billNet(b)) + " Credits" + (b.status === "Settled" ? "" : " (provisional)"))),
        h("div", { class: "page-actions" },
          run ? h("button", { class: "btn", onclick: function () { App.go("#/arena/runs/" + run.id); } }, "Open run") : null,
          b.resultId ? h("button", { class: "btn", onclick: function () { App.go("#/playyard/results/" + b.resultId); } }, "Open result") : null,
          b.status === "Accruing" && req && run && ["Running", "Queued", "Initializing"].indexOf(run.status) >= 0 ? h("button", { class: "btn", onclick: function () { changeLimit(b, req); } }, "Change limit") : null,
          h("button", { class: "btn", onclick: function () {
            UI.download(b.id + (b.status === "Settled" ? "" : "-provisional") + ".json", JSON.stringify({ bill: b.id, status: b.status, provisional: b.status !== "Settled", generated_at: DB.stamp(), timezone: FIN().timezone, run: b.runId, request: b.requestId, rate_version: b.rateVersion, items: b.items, adjustments: b.adjustments, net_credits: billNet(b) }, null, 2), "application/json");
          } }, "Export details"))));
      if (b.status === "Finalizing") body.appendChild(UI.alert("info", "Final usage is being calculated."));
      body.appendChild(UI.section("Summary", null, h("div", { class: "prop-grid" },
        UI.prop("Bill ID", b.id), UI.prop("Run ID", b.runId), UI.prop("Request ID", b.requestId),
        UI.prop("Bot & configuration", bot && cfg ? bot.name + " · " + cfg.name + " v" + run.configVersion : "—"),
        UI.prop("GPU profile", run ? (DB.gpu(run.gpu) || {}).name : "—"),
        UI.prop("Billing period", b.items[0] ? b.items[0].interval : "—"), UI.prop("Timezone", FIN().timezone),
        UI.prop("Authorization reference", b.requestId + (req && req.limit ? " · limit " + UI.fmtCredits(req.limit) + " Credits" : "")),
        UI.prop("Rate version", b.rateVersion), UI.prop("Settled at", b.settledAt), UI.prop("Last updated", DB.stamp()),
        UI.prop("Run status", run ? UI.badge(run.status) : "—"), UI.prop("Billing status", UI.badge(b.status)))));
      var t = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Service"), UI.th("Billable interval"), UI.th("Quantity", true), UI.th("Unit"), UI.th("Rate", true), UI.th("Credits", true))));
      t.appendChild(h("tbody", {}, b.items.map(function (i) {
        return h("tr", {}, h("td", { text: i.service }), h("td", { text: i.interval }), h("td", { class: "num", text: String(Math.round(i.qty * 10000) / 10000) }), h("td", { text: i.unit }),
          h("td", { class: "num", text: i.rate + " / " + i.unit }), h("td", { class: "num", text: UI.fmtCredits(i.credits) }));
      })));
      body.appendChild(UI.section("Usage items", "Metered from backend service events at the locked rate version. ARENA Elapsed is training activity time and is not copied here.", h("div", { class: "table-wrap" }, t)));
      if ((b.adjustments || []).length) {
        body.appendChild(UI.section("Adjustments", null, h("div", { class: "table-wrap" }, h("table", { class: "tbl tbl-static" },
          h("thead", {}, h("tr", {}, UI.th("At"), UI.th("Reason"), UI.th("Credits", true))),
          h("tbody", {}, b.adjustments.map(function (a) { return h("tr", {}, h("td", { text: a.at }), h("td", { text: a.reason }), h("td", { class: "num", text: (a.credits > 0 ? "+" : "") + UI.fmtCredits(a.credits) })); }))))));
      }
      body.appendChild(h("div", { class: "flex" }, h("button", { class: "btn", onclick: function () { UI.toast("Issue report started for " + b.id + " / " + b.runId + "."); } }, "Report an issue"), UI.sampleTag()));
    }
    paint();
    var timer = setInterval(paint, 2000);
    App.onLeave(function () { clearInterval(timer); });
  }

  function changeLimit(b, req) {
    var used = billNet(b);
    var inp = h("input", { class: "input input-num", inputmode: "decimal", value: String(req.limit) });
    UI.modal({ title: "Change request limit", body: h("div", {},
      UI.field("New limit (Credits)", inp, { helper: "Must be above usage so far (" + UI.fmtCredits(used) + ") plus a margin for saving and releasing resources." })),
      actions: [{ label: "Cancel" }, { label: "Confirm", kind: "primary", onClick: function () {
        var v = UI.parseNum(inp.value);
        if (!(v > used * 1.05 + 1)) { UI.toast("The limit must stay above usage so far plus the stop margin.", "err"); return true; }
        req.limitHistory = (req.limitHistory || []).concat([{ at: DB.stamp(), from: req.limit, to: v }]);
        req.limit = v; UI.toast("Request limit changed to " + UI.fmtCredits(v) + " Credits.", "ok");
      } }] });
  }

  /* ---------------- Review request (AUTH-01) ---------------- */
  function reviewRequest(page, id) {
    var req = DB.request(id);
    if (!req) { page.appendChild(UI.empty("Request not found.")); return; }
    var f = FIN();
    var draft = req.source.type === "run-draft" ? DB.draft(req.source.draftId) : null;
    var result = req.source.type === "result" ? DB.result(req.source.resultId) : null;
    var changed = draft && req.status === "Pending review" && Pages.arenaSignature(draft) !== req.signature;
    if (changed) req.signature = Pages.arenaSignature(draft);

    page.appendChild(h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title", text: "Review request" }),
      h("div", { class: "page-sub" }, req.id + " · ", UI.badge(req.status)))));
    if (changed) page.appendChild(UI.alert("warn", "This request has changed. Review the updated details."));
    if (req.status === "Confirmed") {
      page.appendChild(UI.alert("info", h("div", { class: "flex-between" }, h("span", { text: "Request confirmed. Return to continue." }), h("button", { class: "btn btn-sm", onclick: function () { App.go(req.returnHash); } }, req.returnLabel || "Return"))));
    }
    if (req.status === "Consumed") page.appendChild(UI.alert("info", "This request has been used." + (req.runId ? " Run " + req.runId + "." : "")));
    if (req.status === "Cancelled" || req.status === "Revoked") page.appendChild(UI.alert("warn", "This request was " + req.status.toLowerCase() + ". Nothing was started or charged."));

    var rows = [], services = [], rate = null, maxRuntime = null, estimate = null, rateLines = [];
    if (draft) {
      var cfg = DB.config(draft.configId), bot = DB.bot(draft.botId), g = DB.gpu(draft.gpu);
      var vals = DB.configVersion(cfg, draft.configVersion).values;
      rate = f.rates[draft.gpu];
      maxRuntime = UI.parseNum(draft.maxRuntimeH);
      rows.push(["Source", h("span", {}, "Run draft · " + (draft.name || "Untitled") + " · ", h("button", { class: "link-btn", onclick: function () { App.go(req.returnHash); } }, "Return to run"))]);
      rows.push(["Configuration", (bot ? bot.name + " · " : "") + cfg.name + " · v" + draft.configVersion + " (fixed version)"]);
      rows.push(["GPU", g ? g.name + " · " + g.vram + " GB" : "—"]);
      if (draft.resume) rows.push(["Start state", "Resume from " + draft.resume.runId + " at iteration " + UI.fmtNum(draft.resume.iter)]);
      services.push("Training (" + UI.fmtNum(vals.target_iterations) + " target iterations)");
      if (draft.outputs.evalAfter) services.push("Evaluation after training (" + vals["eval.protocol"] + ")");
      services.push("ONNX export");
      if (draft.outputs.keepCkpt) services.push("Keep training checkpoint");
      if (rate) rateLines.push(rate.rate + " Credits / " + rate.unit + " · " + rate.version);
      if (draft.outputs.evalAfter && f.rates.evaluation) rateLines.push(f.rates.evaluation.rate + " Credits / " + f.rates.evaluation.unit);
      if (rate && maxRuntime) estimate = rate.rate * maxRuntime + (draft.outputs.evalAfter ? f.rates.evaluation.rate : 0);
    } else if (result) {
      var rv = DB.configVersion(DB.config(result.configId), result.configVersion).values;
      rate = f.rates.evaluation;
      rows.push(["Source", h("span", {}, "Result · " + result.name + " v" + result.version + " · ", h("button", { class: "link-btn", onclick: function () { App.go(req.returnHash); } }, "Return to result"))]);
      rows.push(["Configuration", DB.config(result.configId).name + " · v" + result.configVersion + " (fixed version)"]);
      services.push("Evaluation · " + rv["eval.protocol"] + " · seeds " + rv["eval.seeds"] + " · " + rv["eval.episodes"] + " episodes per seed");
      if (rate) rateLines.push(rate.rate + " Credits / " + rate.unit + " · " + rate.version);
      estimate = rate ? rate.rate : null;
    }
    var pricingOk = !!rate;
    var limitIn = h("input", { class: "input input-num", inputmode: "decimal", value: String(req.limit || f.controls.defaultLimit || ""), disabled: req.status !== "Pending review" });
    var limitMsg = h("div", {});
    var confirmBtn = h("button", { class: "btn btn-primary", onclick: confirm }, "Confirm and return");
    function check() {
      var v = UI.parseNum(limitIn.value);
      limitMsg.innerHTML = "";
      var ok = pricingOk && req.status === "Pending review";
      if (!pricingOk) limitMsg.appendChild(UI.alert("err", "Pricing is unavailable. This request cannot be confirmed yet."));
      else if (!(v > 0)) { ok = false; limitMsg.appendChild(h("div", { class: "field-error", text: "Enter a request limit." })); }
      else if (v > f.balance) { ok = false; limitMsg.appendChild(UI.alert("err", "Not enough credits for this request. Add credits or change the limit.")); }
      else if (estimate && v < estimate) limitMsg.appendChild(h("div", { class: "field-helper", text: "The service stops when this limit is reached, which may be before the runtime limit or the target." }));
      confirmBtn.disabled = !ok;
    }
    limitIn.addEventListener("input", check);

    var list = h("div", { class: "review-list" });
    rows.forEach(function (r) { list.appendChild(UI.kv(r[0], r[1])); });
    list.appendChild(UI.kv("Services", h("div", { class: "right-list" }, services.map(function (s) { return h("div", { text: s }); }))));
    list.appendChild(UI.kv("Rate", pricingOk ? h("div", { class: "right-list" }, rateLines.map(function (s) { return h("div", { text: s }); }), UI.sampleTag("Sample rate")) : h("span", { class: "err-text", text: "Pricing unavailable" })));
    list.appendChild(UI.kv("Available credits", UI.fmtCredits(f.balance) + " Credits"));
    list.appendChild(UI.kv("Request limit", h("div", { class: "right-list" }, h("div", { class: "flex" }, limitIn, h("span", { class: "muted", text: "Credits" })), h("div", { class: "small muted", text: "Hard cap for all services in this request." }))));
    list.appendChild(UI.kv("Maximum runtime", draft ? (maxRuntime ? maxRuntime + " h (read-only, set in ARENA)" : "—") : "Finite workload: one evaluation run"));
    list.appendChild(UI.kv("Billing terms", h("div", { class: "right-list small", text: f.billingTerms + " The service stops before the request limit, keeping a margin to save and release resources. Automatic retries stay inside this request and its limit." })));
    list.appendChild(UI.kv("Estimate", estimate != null ? h("div", { class: "right-list" }, h("div", { text: "Up to " + UI.fmtCredits(estimate) + " Credits" }), h("div", { class: "small muted", text: draft ? "Basis: rate × maximum runtime" + (draft.outputs.evalAfter ? " + one evaluation run" : "") + ". Actual usage is metered." : "Basis: one evaluation run at the listed rate." })) : "No stated basis"));
    page.appendChild(UI.section(null, null, list, limitMsg,
      h("p", { class: "strong mt16", text: "This confirms the request. It does not start the service." }),
      h("p", { class: "small muted", text: "To change training parameters go back to GALLERY; to change the GPU, runtime or outputs go back to the original page. Any change to these requires a new review." })));
    page.appendChild(h("div", { class: "action-bar" },
      h("button", { class: "btn", disabled: req.status !== "Pending review", onclick: cancel }, "Cancel"),
      h("div", { class: "flex" }, h("button", { class: "btn", onclick: addCredits }, "Add credits"), confirmBtn)));
    check();

    function cancel() {
      req.status = "Cancelled";
      UI.toast("Request cancelled. Nothing was started or charged.");
      App.go(req.returnHash);
    }
    function confirm() {
      var v = UI.parseNum(limitIn.value);
      if (!(v > 0) || v > f.balance || !pricingOk) { check(); return; }
      if (draft && Pages.arenaSignature(draft) !== req.signature) { UI.toast("This request has changed. Review the updated details.", "err"); App.rerender(); return; }
      req.status = "Confirmed"; req.limit = v; req.confirmedAt = DB.stamp(); req.rateVersion = rate.version;
      UI.toast("Request confirmed. Return to continue.", "ok");
      App.go(req.returnHash);
    }
  }
})();
