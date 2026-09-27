/* Microduck — ARENA: Runs, New training run, Run details.
 * Training information is limited to Iterations, Elapsed, Loss, Logs and Checkpoints,
 * plus a read-only Reward configuration. No credits, rates, budgets or bills appear here;
 * paid execution goes through MASTER (AUTH-01). */
(function () {
  "use strict";
  var h = UI.h;
  window.Pages = window.Pages || {};
  Pages._ticks = Pages._ticks || [];

  var ACTIVE = ["Queued", "Initializing", "Running", "Stopping"];

  function cfgLabel(cfg, v) { return cfg ? cfg.name + " · v" + v : "—"; }
  function sourceHash(botId, cfgId, v) { return "#/gallery/bots/" + botId + "?cfg=" + cfgId + "&v=" + v; }
  function versionValues(cfgId, v) { var c = DB.config(cfgId); var ver = c && DB.configVersion(c, v); return ver ? ver.values : {}; }

  /* Signature of everything an authorization covers (AUTH-01). Display-only fields are excluded. */
  function signature(d) {
    return JSON.stringify([d.configId, d.configVersion, d.gpu, Number(d.maxRuntimeH) || null,
      d.resume ? [d.resume.runId, d.resume.iter] : null,
      !!d.outputs.evalAfter, !!d.outputs.record, !!d.outputs.exportOnnx, !!d.outputs.keepCkpt]);
  }
  function draftRequest(d) {
    var list = DB.finance.requests.filter(function (r) { return r.source.type === "run-draft" && r.source.draftId === d.id; });
    return list[list.length - 1] || null;
  }
  function authState(d) {
    var r = draftRequest(d);
    if (!r) return { state: "none" };
    if (r.status === "Consumed") return { state: "consumed", req: r };
    if (r.status === "Confirmed" && r.signature === signature(d)) return { state: "valid", req: r };
    if (r.status === "Confirmed") return { state: "changed", req: r };
    return { state: "none", req: r };
  }
  Pages.arenaSignature = signature;

  /* ---------------- Reward configuration (read-only, shared) ---------------- */
  Pages.rewardConfig = function (cfgId, v, opts) {
    opts = opts || {};
    var cfg = DB.config(cfgId);
    var box = h("div", { class: "rail-card" });
    if (!cfg) { box.appendChild(h("div", { class: "small muted", text: "Select a saved configuration to see its reward configuration." })); return box; }
    var schema = DB.schemaFor(cfg.actionId, cfg.source);
    var vals = versionValues(cfgId, v);
    var cur = {}; schema.curriculum.forEach(function (c) { cur[c.term] = c; });
    var expanded = false, query = "";
    box.appendChild(h("div", { class: "flex-between" }, h("div", { class: "rail-title", text: "Reward configuration" }), h("span", { class: "tag", text: "Read only" })));
    box.appendChild(h("div", { class: "small muted mb8", text: schema.rewards.length + " terms · " + (opts.run ? "frozen snapshot of " : "") + cfg.name + " v" + v }));
    var list = h("div", { class: "reward-list" });
    var search = h("input", { class: "input input-sm", type: "search", placeholder: "Search reward terms", oninput: function () { query = search.value.toLowerCase(); paint(); } });
    var more = h("button", { class: "link-btn", onclick: function () { expanded = !expanded; paint(); } });
    box.appendChild(list);
    box.appendChild(more);

    function paint() {
      list.innerHTML = "";
      if (expanded && schema.rewards.length > 6) list.appendChild(search);
      var rows = schema.rewards.filter(function (r) { return !query || r.term.toLowerCase().indexOf(query) >= 0; });
      (expanded ? rows : rows.slice(0, 6)).forEach(function (r) {
        var w = vals["rw:" + r.term];
        var detail = h("div", { class: "reward-detail" });
        var open = false;
        var row = h("button", { class: "reward-row", "aria-expanded": "false", onclick: function () {
          open = !open; row.setAttribute("aria-expanded", open ? "true" : "false"); detail.style.display = open ? "block" : "none";
        } }, h("span", { class: "rt" }, r.term, w === 0 ? h("span", { class: "tag", text: "Disabled" }) : null, cur[r.term] ? h("span", { class: "tag", text: "Curriculum" }) : null),
          h("span", { class: "rw", text: w == null ? "Not provided" : UI.fmtValue(w) }));
        detail.style.display = "none";
        var params = r.params.map(function (rp) { return [rp.label, vals["rw:" + r.term + ":" + rp.key], rp.unit]; });
        if (!params.length && !cur[r.term]) detail.appendChild(h("div", { class: "small muted", text: "No numeric parameters besides the weight." }));
        params.forEach(function (p) { detail.appendChild(UI.kv(p[0], p[1] == null ? "Not provided" : UI.fmtValue(p[1]) + (p[2] ? " " + p[2] : ""))); });
        if (cur[r.term]) {
          detail.appendChild(UI.kv("Initial weight", UI.fmtValue(w)));
          detail.appendChild(UI.kv("Final weight (rule)", vals["cur:" + r.term] == null ? "Stage rules" : UI.fmtValue(vals["cur:" + r.term])));
          detail.appendChild(UI.kv("Effective weight", opts.run ? "Not reported" : "—"));
          detail.appendChild(h("div", { class: "small muted", text: opts.run ? "No curriculum telemetry has been reported for this run." : "Before a run starts there is no effective value." }));
        }
        list.appendChild(row); list.appendChild(detail);
      });
      schema.curriculum.filter(function (c) { return !schema.rewards.some(function (r) { return r.term === c.term; }); }).forEach(function (c) {
        list.appendChild(h("div", { class: "reward-row static" }, h("span", { class: "rt" }, c.term, h("span", { class: "tag", text: "Curriculum" })), h("span", { class: "rw muted", text: opts.run ? "Not reported" : "Rules" })));
      });
      more.style.display = schema.rewards.length > 6 ? "" : "none";
      more.textContent = expanded ? "Show fewer" : "View all reward terms (" + schema.rewards.length + ")";
    }
    paint();
    box.appendChild(h("div", { class: "rail-divider" }));
    box.appendChild(h("button", { class: "btn btn-sm", onclick: function () { App.go(sourceHash(cfg.botId, cfg.id, v)); } }, "Edit in Gallery"));
    box.appendChild(h("div", { class: "small muted mt8", text: opts.run ? "Editing creates a new configuration version. This run is not changed." : "Rewards are edited only in GALLERY and saved as a new version." }));
    return box;
  };

  /* ================================ Runs ================================ */
  Pages.arena = function (view) {
    App.title("ARENA / Runs");
    var F = App.state.runsFilter;
    var page = h("div", { class: "page" },
      h("div", { class: "page-head" },
        h("div", {}, h("h1", { class: "page-title", text: "Runs" }), h("div", { class: "page-sub", text: "Train a saved configuration on a managed GPU and follow its progress." })),
        h("div", { class: "page-actions" }, h("button", { class: "btn btn-primary", onclick: function () { App.go("#/arena/new"); } }, "New run"))));

    var drafts = DB.drafts.filter(function (d) { return !d.submittedRun; });
    if (drafts.length) {
      var dt = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Draft"), UI.th("Bot & configuration"), UI.th("Saved"))));
      var dtb = h("tbody", {});
      drafts.forEach(function (d) {
        var b = DB.bot(d.botId), c = DB.config(d.configId);
        dtb.appendChild(h("tr", { onclick: function () { App.go("#/arena/new?draft=" + d.id); } },
          h("td", { class: "row-title", text: d.name || "Untitled draft" }),
          h("td", {}, h("div", { text: b ? b.name : "—" }), h("div", { class: "row-sub", text: cfgLabel(c, d.configVersion) })),
          h("td", { text: d.savedAt || "—" })));
      });
      dt.appendChild(dtb);
      page.appendChild(h("div", { class: "mb24" }, h("div", { class: "section-label", text: "Drafts" }), h("div", { class: "table-wrap" }, dt)));
    }

    var search = h("input", { class: "input", type: "search", placeholder: "Search runs", value: F.q, oninput: function () { F.q = search.value; paint(); } });
    var status = h("select", { class: "input", "aria-label": "Status", onchange: function () { F.status = status.value; paint(); } }, h("option", { value: "", text: "All statuses" }));
    ["Queued", "Initializing", "Running", "Stopping", "Completed", "Stopped", "Failed"].forEach(function (s) { status.appendChild(h("option", { value: s, text: s, selected: F.status === s })); });
    var bot = h("select", { class: "input", "aria-label": "Bot", onchange: function () { F.bot = bot.value; paint(); } }, h("option", { value: "", text: "All bots" }));
    DB.bots.forEach(function (b) { bot.appendChild(h("option", { value: b.id, text: b.name, selected: F.bot === b.id })); });
    var date = h("select", { class: "input", "aria-label": "Date", onchange: function () { F.date = date.value; paint(); } },
      h("option", { value: "", text: "All dates" }),
      h("option", { value: "7d", text: "Last 7 days", selected: F.date === "7d" }),
      h("option", { value: "30d", text: "Last 30 days", selected: F.date === "30d" }));
    page.appendChild(h("div", { class: "toolbar" }, search, status, bot, date, h("span", { class: "small muted", text: "Sorted by recently updated" })));
    var meta = h("div", {});
    page.appendChild(meta);
    var body = h("div", {});
    page.appendChild(body);
    view.appendChild(page);

    function inDate(r) {
      if (!F.date) return true;
      var days = F.date === "7d" ? 7 : 30;
      return (Date.now() - new Date((r.updated || r.created).replace(" ", "T")).getTime()) <= days * 86400000;
    }
    function clearRunFilters() { App.state.runsFilter = { q: "", status: "", bot: "", date: "" }; App.rerender(); }
    function paint() {
      body.innerHTML = "";
      meta.innerHTML = "";
      if (!DB.runs.length) { body.appendChild(UI.empty("No training runs yet. Choose a saved configuration to start.", h("button", { class: "btn btn-primary", onclick: function () { App.go("#/arena/new"); } }, "New run"))); return; }
      var list = DB.runs.filter(function (r) {
        if (F.status && r.status !== F.status) return false;
        if (F.bot && r.botId !== F.bot) return false;
        if (!inDate(r)) return false;
        if (F.q) { var c = DB.config(r.configId), b = DB.bot(r.botId); if ((r.name + " " + r.id + " " + (c ? c.name : "") + " " + (b ? b.name : "")).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false; }
        return true;
      }).sort(function (a, b) { return a.updated < b.updated ? 1 : -1; });
      var filtered = !!(F.q || F.status || F.bot || F.date);
      meta.appendChild(UI.filterMeta(list.length, DB.runs.length, filtered, clearRunFilters, "runs"));
      if (!list.length) { body.appendChild(UI.empty("No runs match these filters.", h("button", { class: "btn", onclick: clearRunFilters }, "Clear filters"))); return; }
      var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Run"), UI.th("Bot & configuration"), UI.th("Status"), UI.th("Iterations", true), UI.th("Elapsed", true))));
      var tb = h("tbody", {});
      list.forEach(function (r) {
        var b = DB.bot(r.botId), c = DB.config(r.configId);
        tb.appendChild(h("tr", { onclick: function () { App.go("#/arena/runs/" + r.id); } },
          h("td", {}, h("div", { class: "row-title", text: r.name }), h("div", { class: "row-sub", text: r.id })),
          h("td", {}, h("div", { text: b ? b.name : "—" }), h("div", { class: "row-sub", text: cfgLabel(c, r.configVersion) })),
          h("td", {}, UI.badge(r.status)),
          h("td", { class: "num", text: itersText(r) }),
          h("td", { class: "num", text: elapsedText(r) })));
      });
      tbl.appendChild(tb);
      body.appendChild(h("div", { class: "table-wrap" }, tbl));
    }
    paint();
    Pages._runUpdate = function () { if (document.activeElement !== search) paint(); };
  };

  function itersText(r) { return (r.status === "Queued" || r.status === "Initializing") && !r.itersReported ? "—" : UI.fmtNum(r.iters) + " / " + UI.fmtNum(r.target); }
  function elapsedText(r) { return (r.status === "Queued" || r.status === "Initializing") && !r.elapsedSec ? "—" : UI.fmtHMS(r.elapsedSec); }

  /* =========================== New training run =========================== */
  Pages.arenaNew = function (view, params) {
    App.title("ARENA / New run");
    var q = params.query || {};
    var d = q.draft ? DB.draft(q.draft) : null;
    if (d && d.submittedRun) { App.go("#/arena/runs/" + d.submittedRun); return; }
    if (!d) {
      d = { id: null, name: "", desc: "", botId: null, configId: null, configVersion: null, gpu: null, maxRuntimeH: "",
        resume: null, outputs: { evalAfter: true, record: false, exportOnnx: true, keepCkpt: true }, savedAt: null };
      if (q.bot) d.botId = q.bot;
      if (q.config && DB.config(q.config)) { var c0 = DB.config(q.config); d.botId = c0.botId; d.configId = c0.id; d.configVersion = q.v ? +q.v : DB.latestVersion(c0).v; }
      var src = q.dup ? DB.run(q.dup) : q.resume ? DB.run(q.resume) : null;
      if (src) {
        d.botId = src.botId; d.configId = src.configId; d.configVersion = src.configVersion; d.gpu = src.gpu; d.maxRuntimeH = String(src.maxRuntimeH);
        d.outputs = DB.clone(src.outputs);
        d.name = src.name + (q.resume ? " — resumed" : " — copy");
        if (q.resume) d.resume = { runId: src.id, iter: +q.ckpt };
      }
      if (q.fromResult) {
        var res = DB.result(q.fromResult), srun = res && DB.run(res.sourceRun);
        if (res && srun) {
          d.botId = res.botId; d.configId = res.configId; d.configVersion = res.configVersion; d.gpu = srun.gpu; d.maxRuntimeH = String(srun.maxRuntimeH);
          d.name = res.name + " — resumed"; d.resume = { runId: srun.id, iter: srun.checkpoints.length ? srun.checkpoints[srun.checkpoints.length - 1].iter : 0 };
        }
      }
    }
    var dirty = !d.id && !!(d.configId || d.name);
    var saveState = h("span", { class: "save-state", text: d.savedAt ? "Draft saved " + d.savedAt.slice(11) : "Unsaved draft" });
    function touch() { dirty = true; saveState.textContent = "Unsaved changes"; saveState.className = "save-state"; paintFooter(); }

    var left = h("div", {});
    var rail = h("div", { class: "rail" });

    /* A. identity */
    var nameIn = h("input", { class: "input", value: d.name, placeholder: "e.g. Walking baseline", oninput: function () { d.name = nameIn.value; touch(); } });
    var descIn = h("textarea", { class: "input", rows: "2", placeholder: "Optional", oninput: function () { d.desc = descIn.value; touch(); } });
    descIn.value = d.desc || "";
    left.appendChild(UI.section("Run", null, UI.field("Run name", nameIn, { req: true }), UI.fold("Description (optional)", !!d.desc, descIn)));

    /* B. bot & configuration + preview */
    var cfgBox = h("div", {});
    left.appendChild(UI.section("Bot & saved configuration", "Only saved configuration versions can run. Parameters are edited in GALLERY.", cfgBox));
    var previewBox = h("div", { class: "mb20" });
    left.appendChild(previewBox);
    var viewer = null;
    function paintPreview() {
      var b = DB.bot(d.botId);
      if (!b) {
        if (viewer) { viewer.destroy(); viewer = null; }
        previewBox.innerHTML = "";
        previewBox.appendChild(h("div", { class: "viewer-placeholder", text: "Model preview appears after you choose a bot." }));
        return;
      }
      if (!DB.platform(b.platform).viewer) {
        if (viewer) { viewer.destroy(); viewer = null; }
        previewBox.innerHTML = "";
        previewBox.appendChild(h("div", { class: "viewer-placeholder" }, h("div", { class: "strong", text: b.name }), h("div", { text: "Model preview is not connected for this robot." })));
        return;
      }
      if (viewer) { viewer.setModel({ variant: DB.previewVariant(b) }); return; }
      previewBox.innerHTML = "";
      viewer = UI.viewer(previewBox, {
        label: "Model preview", variant: DB.previewVariant(b),
        assist: DB.platform(b.platform).preview ? false : undefined,
        sub: ["No policy — this is the bot model only"]
      });
    }
    App.onLeave(function () { if (viewer) viewer.destroy(); });

    function paintConfig() {
      cfgBox.innerHTML = "";
      var botSel = h("select", { class: "input", "aria-label": "Bot", onchange: function () {
        d.botId = botSel.value || null; d.configId = null; d.configVersion = null; touch(); paintAll();
      } }, h("option", { value: "", text: "Choose a bot…" }));
      DB.bots.filter(function (b) { return !b.archived; }).forEach(function (b) { botSel.appendChild(h("option", { value: b.id, selected: b.id === d.botId, text: b.name })); });
      var bot = DB.bot(d.botId);
      var cfgSel = h("select", { class: "input", "aria-label": "Configuration", disabled: !bot, onchange: function () {
        var c = DB.config(cfgSel.value); d.configId = c ? c.id : null; d.configVersion = c ? DB.latestVersion(c).v : null; touch(); paintAll();
      } }, h("option", { value: "", text: bot ? "Choose a saved configuration…" : "Choose a bot first" }));
      if (bot) Pages.sandboxHelpers.botConfigs(bot).forEach(function (c) {
        cfgSel.appendChild(h("option", { value: c.id, selected: c.id === d.configId, text: c.name + " — " + DB.action(c.actionId).name }));
      });
      var cfg = DB.config(d.configId);
      var verSel = h("select", { class: "input", "aria-label": "Version", disabled: !cfg, onchange: function () { d.configVersion = +verSel.value; touch(); paintAll(); } });
      if (cfg) cfg.versions.forEach(function (v) { verSel.appendChild(h("option", { value: v.v, selected: v.v === d.configVersion, text: "Version " + v.v + " · " + v.savedAt })); });
      cfgBox.appendChild(h("div", { class: "form-row-3" }, UI.field("Bot", botSel, { req: true }), UI.field("Configuration", cfgSel, { req: true }), UI.field("Version", verSel)));
      if (!cfg) return;
      if (d.resume) { cfgBox.appendChild(h("div", { class: "small muted", text: "Resuming uses the source run's configuration version." })); verSel.disabled = true; cfgSel.disabled = true; botSel.disabled = true; }
      var latest = DB.latestVersion(cfg).v;
      if (latest > d.configVersion && !d.resume) {
        cfgBox.appendChild(UI.alert("info", h("div", { class: "flex-between" }, h("span", { text: "Newer configuration available (v" + latest + "). This draft keeps v" + d.configVersion + "." }),
          h("span", { class: "flex" }, h("button", { class: "btn btn-sm", onclick: function () { reviewChanges(cfg, d.configVersion, latest); } }, "Review changes"),
            h("button", { class: "btn btn-sm", onclick: function () { d.configVersion = latest; touch(); paintAll(); } }, "Use this version")))));
      }
      var vals = versionValues(cfg.id, d.configVersion);
      var status = DB.validate(cfg, vals, bot).status;
      cfgBox.appendChild(h("div", { class: "summary-row" },
        UI.kv("Action", DB.action(cfg.actionId).name),
        UI.kv("Readiness", UI.badge(status)),
        UI.kv("Target iterations", vals.target_iterations == null ? "Not provided" : UI.fmtNum(vals.target_iterations)),
        UI.kv("Parallel environments", vals.num_envs == null ? "Not provided" : UI.fmtNum(vals.num_envs))));
      if (status !== "Ready to run") cfgBox.appendChild(UI.alert("warn", "Configuration is incomplete. Open it in Gallery to finish setup."));
      cfgBox.appendChild(h("div", { class: "flex mt8" },
        h("button", { class: "link-btn", onclick: function () { App.go(sourceHash(cfg.botId, cfg.id, d.configVersion)); } }, "View source configuration"),
        h("span", { class: "muted", text: "·" }),
        h("button", { class: "link-btn", onclick: function () { App.go("#/gallery/bots/" + cfg.botId + "?cfg=" + cfg.id); } }, "Open in Gallery")));
    }

    function reviewChanges(cfg, from, to) {
      var a = versionValues(cfg.id, from), b = versionValues(cfg.id, to);
      var keys = Object.keys(b).filter(function (k) { return JSON.stringify(a[k]) !== JSON.stringify(b[k]); });
      UI.modal({ title: "Changes from v" + from + " to v" + to, body: keys.length
        ? h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Parameter"), UI.th("v" + from), UI.th("v" + to))),
          h("tbody", {}, keys.map(function (k) { return h("tr", {}, h("td", {}, h("code", { text: k })), h("td", { text: JSON.stringify(a[k]) }), h("td", { text: JSON.stringify(b[k]) })); })))
        : h("p", { text: "No parameter differences." }),
        actions: [{ label: "Close" }, { label: "Use v" + to, kind: "primary", onClick: function () { d.configVersion = to; touch(); paintAll(); } }] });
    }

    /* C. start state */
    var startBox = h("div", {});
    left.appendChild(startBox);
    function paintStart() {
      startBox.innerHTML = "";
      if (!d.resume) return;
      var src = DB.run(d.resume.runId);
      var target = versionValues(d.configId, d.configVersion).target_iterations;
      startBox.appendChild(UI.section("Start state", "Resume uses the saved policy, optimizer, normalizer and runner state. It creates a new run; the source run is unchanged.",
        h("div", { class: "summary-row" },
          UI.kv("Source run", src ? src.name : d.resume.runId),
          UI.kv("Checkpoint iteration", UI.fmtNum(d.resume.iter)),
          UI.kv("Target total iterations", UI.fmtNum(target)),
          UI.kv("Remaining planned iterations", target > d.resume.iter ? UI.fmtNum(target - d.resume.iter) : "—")),
        target <= d.resume.iter ? UI.alert("err", "The configured target does not exceed the checkpoint iteration. Raise Target iterations in Gallery and save a new version.") : null,
        h("button", { class: "btn btn-sm mt8", onclick: function () { d.resume = null; d.name = d.name.replace(/ — resumed$/, ""); nameIn.value = d.name; touch(); paintAll(); } }, "Start a new training instead")));
    }

    /* D. compute */
    var computeBox = h("div", {});
    left.appendChild(computeBox);
    function paintCompute() {
      computeBox.innerHTML = "";
      var cards = h("div", { class: "option-cards" });
      var envs = d.configId ? versionValues(d.configId, d.configVersion).num_envs : null;
      DB.gpus.forEach(function (g) {
        var tooMany = g.maxEnvs && envs && envs > g.maxEnvs;
        cards.appendChild(h("button", { class: "option-card" + (d.gpu === g.id ? " selected" : ""), "aria-pressed": d.gpu === g.id ? "true" : "false", onclick: function () { d.gpu = g.id; touch(); paintCompute(); paintChecks(); } },
          h("div", { class: "oc-title", text: g.name }),
          h("div", { class: "oc-meta" }, g.vram + " GB · " + g.arch),
          h("div", { class: "oc-meta" }, UI.badge(g.availability), " ", UI.badge(g.verified ? "Verified" : "Not verified", g.verified ? "ok" : "warn")),
          h("div", { class: "oc-meta", text: g.verified ? "Verified up to " + UI.fmtNum(g.maxEnvs) + " environments" : "No verified runtime image" }),
          tooMany ? h("div", { class: "oc-meta err-text", text: "Needs a smaller environment count" }) : null));
      });
      var g = DB.gpu(d.gpu);
      var rtIn = h("input", { class: "input input-num", inputmode: "decimal", value: d.maxRuntimeH || "", placeholder: "e.g. 12", oninput: function () { d.maxRuntimeH = rtIn.value; touch(); paintChecks(); } });
      computeBox.appendChild(UI.section("Compute & maximum runtime", "Single GPU per run. Availability and compatibility only — the runtime profile is fixed by the platform.",
        cards,
        g ? UI.fold("Runtime profile", false, h("div", { class: "small", text: g.profile })) : null,
        g && !g.verified ? UI.alert("warn", "Selected GPU is not verified for this configuration.") : null,
        g && g.maxEnvs && envs > g.maxEnvs ? UI.alert("warn", h("span", {}, "Selected GPU needs a smaller environment count. ", h("button", { class: "link-btn", onclick: function () { App.go(sourceHash(d.botId, d.configId, d.configVersion)); } }, "Edit the configuration in Gallery."))) : null,
        h("div", { class: "form-row mt16" }, UI.field("Maximum runtime (hours)", rtIn, { req: true,
          helper: "Operational limit for the whole request: starts when resources are first allocated and covers initialization, training, selected post-processing and automatic retries. Queue time before allocation is excluded. Not the same as Elapsed." }))));
    }

    /* E. outputs */
    var outBox = h("div", {});
    left.appendChild(outBox);
    function toggle(label, key, helper, disabled) {
      var chk = h("input", { type: "checkbox", checked: !!d.outputs[key], disabled: disabled });
      chk.addEventListener("change", function () { d.outputs[key] = chk.checked; touch(); paintOutputs(); paintChecks(); });
      return h("div", { class: "field" }, h("label", { class: "toggle" + (disabled ? " disabled" : "") }, chk, h("span", { class: "tk" }), h("span", { class: "tl", text: label })),
        helper ? h("div", { class: "field-helper", text: helper }) : null);
    }
    function paintOutputs() {
      outBox.innerHTML = "";
      var vals = d.configId ? versionValues(d.configId, d.configVersion) : {};
      outBox.appendChild(UI.section("Outputs", null,
        toggle("Evaluate after training", "evalAfter", d.configId ? "Uses the saved Evaluation preset: " + vals["eval.protocol"] + " · seeds " + vals["eval.seeds"] + " · " + vals["eval.episodes"] + " episodes per seed." : "Uses the configuration's saved Evaluation preset."),
        toggle("Record preview", "record", "Recording is not connected in this local demo.", true),
        toggle("Export ONNX", "exportOnnx", "Official export path with the required normalizer; IO shape, dtype and model_api are checked. ONNX is not a training checkpoint.", true),
        toggle("Keep training checkpoint", "keepCkpt", "Needed to resume later. Retention follows the storage policy (not yet defined)."),
        UI.kv("Destination", "Private playyard")));
    }

    /* technical checks */
    var checksBox = h("div", {});
    left.appendChild(checksBox);
    function checks() {
      var out = [];
      var bot = DB.bot(d.botId), cfg = DB.config(d.configId), g = DB.gpu(d.gpu);
      out.push(d.name.trim() ? ["ok", "Run name set"] : ["fail", "Run name is required"]);
      if (!cfg) out.push(["fail", "Choose a saved configuration"]);
      else {
        var vals = versionValues(cfg.id, d.configVersion);
        var st = DB.validate(cfg, vals, bot).status;
        out.push(st === "Ready to run" ? ["ok", "Configuration v" + d.configVersion + " is ready to run"] : ["fail", "Configuration is " + st + " — open it in Gallery"]);
        if (g && g.maxEnvs && vals.num_envs > g.maxEnvs) out.push(["fail", "Selected GPU needs a smaller environment count"]);
        if (d.resume && vals.target_iterations <= d.resume.iter) out.push(["fail", "Target must exceed the checkpoint iteration"]);
      }
      if (!g) out.push(["fail", "Choose a GPU"]);
      else out.push(g.verified ? ["ok", g.name.replace("GeForce ", "") + " runtime profile verified"] : ["fail", "Selected GPU is not verified — execution is blocked"]);
      var rt = UI.parseNum(d.maxRuntimeH);
      out.push(rt > 0 ? ["ok", "Maximum runtime " + rt + " h"] : ["fail", "Set a maximum runtime"]);
      out.push(["ok", "Model assets and license check: platform reference model"]);
      return out;
    }
    function paintChecks() {
      checksBox.innerHTML = "";
      var list = h("div", { class: "check-list" });
      checks().forEach(function (c) {
        list.appendChild(h("div", { class: "check-item check-" + c[0] }, h("span", { class: "check-icon", text: c[0] === "ok" ? "✓" : "✕" }), h("span", { text: c[1] })));
      });
      checksBox.appendChild(UI.section("Technical checks", "Static checks only. GPU model, VRAM, Torch/Warp and a short numeric probe are verified after a node is allocated.", list));
      paintFooter();
    }

    /* footer */
    var footer = h("div", { class: "action-bar" });
    function paintFooter() {
      footer.innerHTML = "";
      var ok = checks().every(function (c) { return c[0] !== "fail"; });
      var a = d.id ? authState(d) : { state: "none" };
      var primary;
      if (a.state === "valid" && !dirty) {
        primary = h("button", { class: "btn btn-primary", disabled: !ok, onclick: startTraining }, "Start training");
      } else {
        primary = h("button", { class: "btn btn-primary", disabled: !ok, onclick: reviewInMaster }, "Review in Master");
      }
      var note = null;
      if (a.state === "changed" || (a.state === "valid" && dirty)) note = h("span", { class: "small muted", text: "Review this request in Master to continue." });
      else if (a.state === "valid") note = h("span", { class: "small ok-text", text: "Request confirmed. Start when ready." });
      footer.appendChild(h("div", { class: "flex" }, h("button", { class: "btn", onclick: saveDraft }, "Save draft"), saveState));
      footer.appendChild(h("div", { class: "flex" }, note, primary));
    }

    function persist() {
      if (!d.id) { d.id = "draft-" + (DB.state.nextDraft++); DB.drafts.unshift(d); }
      d.savedAt = DB.stamp(null, true);
      dirty = false;
      saveState.textContent = "Draft saved " + d.savedAt.slice(11);
      saveState.className = "save-state ok";
      history.replaceState(null, "", "#/arena/new?draft=" + d.id);
      App._prevHash = "#/arena/new?draft=" + d.id;
    }
    function saveDraft() { persist(); paintFooter(); }

    function reviewInMaster() {
      persist();
      var sig = signature(d);
      var existing = draftRequest(d);
      var req;
      if (existing && existing.status === "Pending review" && existing.signature === sig) req = existing;
      else {
        if (existing && (existing.status === "Confirmed" || existing.status === "Pending review")) existing.status = "Revoked";
        req = { id: "req-" + String(DB.state.nextReq++).padStart(4, "0"), kind: "training", status: "Pending review",
          source: { type: "run-draft", draftId: d.id }, signature: sig, createdAt: DB.stamp(), limit: null,
          returnHash: "#/arena/new?draft=" + d.id, returnLabel: "Return to run" };
        DB.finance.requests.push(req);
      }
      App.guard = null;
      App.go("#/master/credits/review/" + req.id);
    }

    var submitting = false;
    function startTraining() {
      if (submitting) return;
      var a = authState(d);
      if (a.state === "consumed" && a.req.runId) { App.go("#/arena/runs/" + a.req.runId); return; }
      if (a.state !== "valid") { paintFooter(); return; }
      submitting = true;
      var btn = footer.querySelector(".btn-primary");
      btn.disabled = true; btn.textContent = "Submitting…";
      setTimeout(function () {
        if (a.req.status === "Consumed") { App.go("#/arena/runs/" + a.req.runId); return; }
        if (DB.finance.balance <= 0) {
          submitting = false; a.req.status = "Revoked";
          UI.toast("Review this request in Master to continue.");
          paintFooter(); return;
        }
        var run = createRun(d, a.req);
        a.req.status = "Consumed"; a.req.runId = run.id;
        d.submittedRun = run.id;
        App.guard = null;
        UI.toast("Run submitted — waiting for a GPU.", "ok");
        App.go("#/arena/runs/" + run.id);
      }, 700);
    }

    function paintAll() { paintConfig(); paintPreview(); paintStart(); paintCompute(); paintOutputs(); paintChecks(); paintRail(); }
    function paintRail() { rail.innerHTML = ""; rail.appendChild(Pages.rewardConfig(d.configId, d.configVersion)); }

    App.guard = function () { return dirty ? "This run draft has unsaved changes. Discard them?" : null; };

    var page = h("div", { class: "page page-wide" },
      h("div", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title", text: d.resume ? "Resume training" : "New training run" }),
        h("div", { class: "page-sub", text: "Choose a saved configuration, a GPU and the outputs. Nothing starts until you click Start training." }))),
      h("div", { class: "two-col" }, left, rail),
      footer);
    view.appendChild(page);
    paintAll();
  };

  function createRun(d, req) {
    var cfg = DB.config(d.configId);
    var vals = versionValues(cfg.id, d.configVersion);
    var src = d.resume ? DB.run(d.resume.runId) : null;
    var run = {
      id: "run-0" + (DB.state.nextRun++), name: d.name.trim(), botId: d.botId, configId: cfg.id, configVersion: d.configVersion,
      gpu: d.gpu, maxRuntimeH: UI.parseNum(d.maxRuntimeH), resume: d.resume ? DB.clone(d.resume) : null,
      outputs: DB.clone(d.outputs), status: "Queued", stopReason: null,
      iters: d.resume ? d.resume.iter : 0, target: vals.target_iterations, elapsedSec: 0, itersReported: false,
      created: DB.stamp(), updated: DB.stamp(),
      loss: { policy: [], value: [] }, events: [], checkpoints: [], postproc: "Not started", resultId: null,
      authRef: req.id, ckptInterval: vals.checkpoint_interval || 500, _t: 0,
      logs: [{ t: DB.stamp(null, true), level: "INFO", msg: "Execution request accepted · waiting for a compatible GPU" + (src ? " · resuming from " + src.id + " at iteration " + UI.fmtNum(d.resume.iter) : "") }]
    };
    DB.runs.unshift(run);
    return run;
  }

  /* ============================== Run details ============================== */
  Pages.arenaRun = function (view, params) {
    var run = DB.run(params.id);
    if (!run) { App.go("#/arena"); return; }
    App.title("ARENA / Runs / " + run.name);
    var bot = DB.bot(run.botId), cfg = DB.config(run.configId);
    var lastStatus = run.status;
    var sampleRun = ["run-0142", "run-0147", "run-0145", "run-0139"].indexOf(run.id) >= 0;

    var head = h("div", { class: "page-head" });
    var alerts = h("div", {});
    var progress = h("div", { class: "progress-line" });
    var page = h("div", { class: "page page-wide" }, head, progress, alerts);
    view.appendChild(page);

    function paintHead() {
      head.innerHTML = "";
      var actions = h("div", { class: "page-actions" });
      if (["Queued", "Initializing", "Running"].indexOf(run.status) >= 0) actions.appendChild(h("button", { class: "btn btn-danger", onclick: stopDialog }, "Stop run"));
      if (run.status === "Stopping") actions.appendChild(h("button", { class: "btn", disabled: true }, "Stopping…"));
      if (run.resultId) actions.appendChild(h("button", { class: "btn", onclick: function () { App.go("#/playyard/results/" + run.resultId); } }, "View in Playyard"));
      else if ((run.status === "Stopped" || run.status === "Failed") && run.checkpoints.some(function (c) { return c.status === "Saved"; }) && run.outputs.exportOnnx) {
        actions.appendChild(h("button", { class: "btn", onclick: saveToSandbox }, "Save to Playyard"));
      }
      actions.appendChild(UI.menu("More run actions", [
        ["Duplicate run setup", function () { App.go("#/arena/new?dup=" + run.id); }],
        ["Copy run ID", function () { UI.copyText(run.id, "Run ID"); }]
      ]));
      head.appendChild(h("div", {},
        h("div", { class: "flex" }, h("h1", { class: "page-title", text: run.name }), UI.badge(run.status)),
        h("div", { class: "page-sub" }, (bot ? bot.name : "—") + " / " + cfgLabel(cfg, run.configVersion) + " · ",
          h("button", { class: "link-btn", onclick: function () { App.go(sourceHash(run.botId, run.configId, run.configVersion)); } }, "View source configuration"))));
      head.appendChild(actions);
    }
    function paintProgress() {
      progress.innerHTML = "";
      progress.appendChild(h("div", { class: "pl-item" }, h("span", { class: "pl-label", text: "Iterations" }), h("span", { class: "pl-value", text: itersText(run) }),
        run.resume ? h("span", { class: "pl-sub", text: "Resumed from iteration " + UI.fmtNum(run.resume.iter) + " · this run +" + UI.fmtNum(Math.max(0, run.iters - run.resume.iter)) }) : null));
      progress.appendChild(h("div", { class: "pl-item" }, h("span", { class: "pl-label", text: "Elapsed" }), h("span", { class: "pl-value", text: elapsedText(run) }),
        h("span", { class: "pl-sub", text: "Training activity only" })));
    }
    function paintAlerts() {
      alerts.innerHTML = "";
      if (run.status === "Queued") alerts.appendChild(UI.alert("info", "Queued — waiting for a compatible GPU. No start time is promised."));
      if (run.status === "Initializing") alerts.appendChild(UI.alert("info", "Initializing — checking GPU, runtime and model after allocation."));
      if (run.status === "Stopping") alerts.appendChild(UI.alert("info", "Stopping the run. Waiting for checkpoint confirmation."));
      if (run.status === "Failed") alerts.appendChild(UI.alert("err", "Run failed: " + run.stopReason + (run.events.length ? " at iteration " + UI.fmtNum(run.events[0].iter) : "") + ". The last saved checkpoint is kept. See Logs."));
      if (run.status === "Stopped") {
        if (run.stopReason === "authorization") alerts.appendChild(UI.alert("warn", h("span", {}, "Run stopped. ", h("button", { class: "link-btn", onclick: function () { App.go("#/master/credits"); } }, "Review in Master"))));
        else alerts.appendChild(UI.alert("warn", "Run stopped — " + (run.stopReason || "stopped") + "."));
      }
      if (run.status === "Completed") alerts.appendChild(UI.alert("info", "Target reached. This does not mean the action is learned — review the simulation and evaluation results." +
        (run.postproc === "Ready" ? "" : " Post-processing: " + run.postproc + ".")));
      if (run.status === "Completed" && run.postproc === "Failed") alerts.appendChild(UI.alert("err", "Training completed, but ONNX export failed. Retry export."));
    }

    /* main area */
    var left = h("div", {}), rail = h("div", { class: "rail" });
    page.appendChild(h("div", { class: "two-col" }, left, rail));
    rail.appendChild(Pages.rewardConfig(run.configId, run.configVersion, { run: true }));

    var previewBox = h("div", { class: "mb20" });
    left.appendChild(previewBox);
    var viewer = null;
    function latestSaved() { var s = run.checkpoints.filter(function (c) { return c.status === "Saved"; }); return s[s.length - 1] || null; }
    function paintPreview() {
      var ck = latestSaved();
      if (!ck) {
        if (viewer) { viewer.destroy(); viewer = null; }
        previewBox.innerHTML = "";
        previewBox.appendChild(h("div", { class: "viewer-placeholder" }, h("div", { class: "strong", text: "No preview yet" }), h("div", { text: "Waiting for the first checkpoint." })));
        return;
      }
      if (viewer) return;
      previewBox.innerHTML = "";
      if (bot && !DB.platform(bot.platform).viewer) {
        previewBox.appendChild(h("div", { class: "viewer-placeholder" }, h("div", { class: "strong", text: bot.name }), h("div", { text: "Model preview is not connected for this robot." })));
        return;
      }
      viewer = UI.viewer(previewBox, {
        label: "Model preview", variant: bot ? DB.previewVariant(bot) : "standard",
        assist: bot && DB.platform(bot.platform).preview ? false : undefined,
        sub: ["Latest checkpoint " + UI.fmtNum(ck.iter) + " · saved " + ck.savedAt, "Checkpoint playback is not connected in this local demo — the bot model is shown without a policy."],
        pauseNote: "Pausing the preview does not stop training.",
        details: [["Scene", versionValues(run.configId, run.configVersion)["eval.scene"]], ["Seed", String(versionValues(run.configId, run.configVersion).seed)], ["Playback speed", "1×"]]
      });
    }
    App.onLeave(function () { if (viewer) viewer.destroy(); });

    var tab = App.state.runTab || "loss";
    var tabBar = h("div", {});
    var tabBody = h("div", {});
    left.appendChild(tabBar); left.appendChild(tabBody);
    function paintTabs() {
      tabBar.innerHTML = "";
      tabBar.appendChild(UI.tabs([["loss", "Loss"], ["logs", "Logs"], ["checkpoints", "Checkpoints", run.checkpoints.length]], tab, function (t) { tab = App.state.runTab = t; paintTabs(); paintTab(); }));
    }
    function paintTab() {
      tabBody.innerHTML = "";
      if (tab === "logs") renderLogs();
      else if (tab === "checkpoints") renderCheckpoints();
      else renderLoss();
    }

    /* ---- Loss ---- */
    function renderLoss() {
      var smooth = h("input", { type: "checkbox", checked: App.state.smoothing });
      smooth.addEventListener("change", function () { App.state.smoothing = smooth.checked; paintTab(); });
      tabBody.appendChild(h("div", { class: "flex-between mb8" },
        h("label", { class: "toggle" }, smooth, h("span", { class: "tk" }), h("span", { class: "tl", text: App.state.smoothing ? "Smoothing on · moving average, window 10 (raw still shown)" : "Smoothing off · raw values" })),
        sampleRun ? UI.sampleTag("Sample series") : h("span", { class: "tag", text: "Simulated runner in this demo" })));
      var pol = run.loss.policy, val = run.loss.value;
      var active = ACTIVE.indexOf(run.status) >= 0;
      if (!pol.length && !val.length) {
        tabBody.appendChild(h("div", { class: "chart-empty tall", text: active ? "No loss data yet." : "Loss unavailable. The training backend has not reported loss values." }));
      } else {
        run.events.forEach(function (e) { tabBody.appendChild(UI.alert("err", e.kind + ": " + e.msg + " Shown as a gap, not as 0.")); });
        chartCard("Policy loss", "Surrogate loss as reported by the runner; may be negative.", pol, "Policy loss not reported by this runner.");
        chartCard("Value loss", "Value function loss as reported by the runner.", val, "Value loss not reported by this runner.");
        var table = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Iteration", true), UI.th("Policy loss", true), UI.th("Value loss", true))));
        var tb = h("tbody", {});
        var n = Math.max(pol.length, val.length);
        for (var i = Math.max(0, n - 15); i < n; i++) {
          var p = pol[i], v = val[i];
          tb.appendChild(h("tr", {}, h("td", { class: "num", text: UI.fmtNum((v || p).x) }),
            h("td", { class: "num", text: p ? (isFinite(p.y) ? UI.fmtValue(p.y) : String(p.y)) : "—" }),
            h("td", { class: "num", text: v ? (isFinite(v.y) ? UI.fmtValue(v.y) : String(v.y)) : "—" })));
        }
        table.appendChild(tb);
        tabBody.appendChild(UI.fold("View latest values (table)", false, h("div", { class: "table-scroll" }, table)));
      }
      tabBody.appendChild(h("div", { class: "small muted mt12", text: "Loss shows optimization trends, not policy quality. Review the simulation and evaluation results." }));
    }
    function chartCard(title, desc, pts, missing) {
      var host = h("div", {});
      var last = null;
      for (var i = pts.length - 1; i >= 0; i--) if (isFinite(pts[i].y)) { last = pts[i]; break; }
      tabBody.appendChild(h("div", { class: "chart-card" },
        h("div", { class: "chart-head" }, h("div", {}, h("div", { class: "chart-title", text: title }), h("div", { class: "small muted", text: desc })),
          last ? h("div", { class: "small muted", text: "Latest " + UI.fmtValue(last.y) + " at " + UI.fmtNum(last.x) }) : null),
        host));
      requestAnimationFrame(function () {
        UI.lossChart(host, { points: pts, label: title, smoothing: App.state.smoothing, window: 10, emptyText: missing, xmin: run.resume ? run.resume.iter : undefined });
      });
    }

    /* ---- Logs ---- */
    var L = { q: "", level: "", follow: true };
    function renderLogs() {
      var search = h("input", { class: "input input-sm", type: "search", placeholder: "Search logs", value: L.q, oninput: function () { L.q = search.value; paintLogLines(); } });
      var level = h("select", { class: "input input-sm", "aria-label": "Level", onchange: function () { L.level = level.value; paintLogLines(); } },
        h("option", { value: "", text: "All levels" }), ["INFO", "WARN", "ERROR"].map(function (l) { return h("option", { value: l, text: l, selected: L.level === l }); }));
      var followBtn = h("button", { class: "btn btn-sm", onclick: function () { L.follow = !L.follow; followBtn.textContent = L.follow ? "Pause log scrolling" : "Resume live"; paintLogLines(); } }, L.follow ? "Pause log scrolling" : "Resume live");
      tabBody.appendChild(h("div", { class: "toolbar tight" }, search, level, followBtn,
        h("button", { class: "btn btn-sm", onclick: function () { UI.copyText(logText(filtered()), "Logs"); } }, "Copy"),
        h("button", { class: "btn btn-sm", onclick: function () { UI.download(run.id + ".log", logText(run.logs), "text/plain"); } }, "Download logs")));
      tabBody.appendChild(h("div", { class: "log-box", id: "rd-logs", role: "log" }));
      tabBody.appendChild(h("div", { class: "small muted mt8", text: "Pausing log scrolling does not pause training. Tokens, private paths and account details are never written to these logs." }));
      paintLogLines();
    }
    function filtered() {
      return run.logs.filter(function (l) { return (!L.level || l.level === L.level) && (!L.q || l.msg.toLowerCase().indexOf(L.q.toLowerCase()) >= 0); });
    }
    function logText(list) { return list.map(function (l) { return l.t + "  " + l.level + "  " + l.msg; }).join("\n") + "\n"; }
    function paintLogLines() {
      var box = document.getElementById("rd-logs");
      if (!box) return;
      var keep = box.scrollTop;
      box.innerHTML = "";
      var list = filtered();
      if (!list.length) {
        box.appendChild(h("div", { class: "muted" }, run.logs.length ? "No log lines match these filters. " : "No logs yet.",
          run.logs.length ? h("button", { class: "link-btn", onclick: function () { L.q = ""; L.level = ""; paintTab(); } }, "Clear filters") : null));
        return;
      }
      list.slice(-300).forEach(function (l) {
        box.appendChild(h("div", { class: "log-line lv-" + l.level }, h("span", { class: "lt", text: l.t.slice(11) || l.t }), h("span", { class: "ll", text: l.level }), h("span", { class: "lm", text: l.msg })));
      });
      box.scrollTop = L.follow ? box.scrollHeight : keep;
    }

    /* ---- Checkpoints ---- */
    function renderCheckpoints() {
      var canResume = run.outputs.keepCkpt !== false;
      tabBody.appendChild(h("div", { class: "flex-between mb8" },
        h("div", { class: "small muted", text: "Latest is not Best: no evaluation protocol marks a best checkpoint, and the lowest loss is not the best action." }),
        run.status === "Running" ? h("button", { class: "btn btn-sm", onclick: requestCheckpoint }, "Request checkpoint") : null));
      if (!run.checkpoints.length) { tabBody.appendChild(UI.empty(ACTIVE.indexOf(run.status) >= 0 ? "Waiting for the first checkpoint." : "No checkpoints were saved.")); return; }
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Iteration", true), UI.th("Saved at"), UI.th("Status"), UI.th("Actions"))));
      var tb = h("tbody", {});
      var latest = latestSaved();
      run.checkpoints.slice().reverse().forEach(function (c) {
        var detail = h("tr", { class: "detail-row", style: "display:none" }, h("td", { colspan: "4" }, h("div", { class: "small muted", text: "Size " + (c.size || "—") + " · Reason: " + (c.reason || "—") + " · Contract check: policy, optimizer, normalizer and runner state present" })));
        tb.appendChild(h("tr", {},
          h("td", { class: "num" }, UI.fmtNum(c.iter), c === latest ? h("span", { class: "tag ml6", text: "Latest" }) : null),
          h("td", { text: c.savedAt || "—" }),
          h("td", {}, UI.badge(c.status)),
          h("td", {}, h("div", { class: "flex" },
            h("button", { class: "btn btn-sm btn-ghost", onclick: function () { detail.style.display = detail.style.display === "none" ? "" : "none"; } }, "Details"),
            c.status === "Saved" ? h("button", { class: "btn btn-sm btn-ghost", onclick: function () { UI.toast("Checkpoint files are not stored in this local demo."); } }, "Download") : null,
            c.status === "Saved" && canResume ? h("button", { class: "btn btn-sm", onclick: function () { App.go("#/arena/new?resume=" + run.id + "&ckpt=" + c.iter); } }, "Resume from checkpoint") : null))));
        tb.appendChild(detail);
      });
      tbl.appendChild(tb);
      tabBody.appendChild(h("div", { class: "table-wrap" }, tbl));
      tabBody.appendChild(h("div", { class: "small muted mt8", text: canResume ? "Resuming creates a new run with its own review in Master. ONNX is an inference artifact, not a training checkpoint." : "Checkpoints were not kept for this run, so it cannot be resumed." }));
    }
    function requestCheckpoint() {
      if (run.checkpoints.some(function (c) { return c.status === "Requested" || c.status === "Saving"; })) { UI.toast("A checkpoint request is already in progress."); return; }
      run.checkpoints.push({ iter: null, savedAt: null, status: "Requested", size: null, reason: "Requested by user", _ticks: 2 });
      run.logs.push({ t: DB.stamp(null, true), level: "INFO", msg: "Checkpoint requested by user" });
      paintTabs(); paintTab();
    }

    function stopDialog() {
      var last = latestSaved();
      UI.modal({
        title: "Stop run",
        body: h("div", {},
          h("div", { class: "prop-grid" },
            UI.prop("Current iteration", itersText(run)),
            UI.prop("Latest saved checkpoint", last ? "Iteration " + UI.fmtNum(last.iter) : "None yet"),
            UI.prop("Progress at risk", last ? "Iterations after " + UI.fmtNum(last.iter) + " may be lost" : "All progress so far"),
            UI.prop("Affected outputs", "Evaluation and ONNX export run only from a saved checkpoint")),
          h("p", { class: "small muted mt12", text: "Stop and save requests a final checkpoint; the run shows Stopped only after the backend confirms. Closing this page does not stop the run." })),
        actions: [
          { label: "Force stop", kind: "danger", left: true, onClick: function () {
            UI.confirm("Force stop?", "Progress after the latest saved checkpoint will be lost.", "Force stop", function () {
              run.status = "Stopping"; run._stopTicks = 1; run._force = true; run.stopReason = "Force stopped by user";
              run.logs.push({ t: DB.stamp(null, true), level: "WARN", msg: "Force stop requested by user" });
              refresh(true);
            }, "danger");
          } },
          { label: "Cancel" },
          { label: "Stop and save", kind: "primary", onClick: function () {
            run.status = "Stopping"; run._stopTicks = 2; run.stopReason = "Stopped by user";
            run.checkpoints.push({ iter: null, savedAt: null, status: "Saving", size: null, reason: "Stop and save", _final: true });
            run.logs.push({ t: DB.stamp(null, true), level: "INFO", msg: "Stop requested by user · saving final checkpoint" });
            refresh(true);
          } }
        ]
      });
    }

    function saveToSandbox() {
      var ck = latestSaved();
      var res = createResult(run, "Partial training", ck.iter);
      UI.toast("Saved to Private playyard as partial training.", "ok");
      App.go("#/playyard/results/" + res.id);
    }

    function refresh(full) {
      if (run.status !== lastStatus) { lastStatus = run.status; full = true; }
      paintProgress();
      if (full) { paintHead(); paintAlerts(); paintPreview(); paintTabs(); paintTab(); return; }
      if (tab === "logs") paintLogLines();
      else if (tab === "checkpoints") { paintTabs(); paintTab(); }
      else if (tab === "loss" && run.status === "Running") paintTab();
      paintPreview();
    }
    Pages._runUpdate = function (r) { if (r.id === run.id) refresh(false); };

    paintHead(); paintProgress(); paintAlerts(); paintPreview(); paintTabs(); paintTab();
  };

  function createResult(run, training, ckptIter) {
    var cfg = DB.config(run.configId), bot = DB.bot(run.botId);
    var res = {
      id: "res-" + String(DB.state.nextRes++).padStart(3, "0"), name: run.name + (training === "Partial training" ? " (partial)" : ""),
      botId: run.botId, actionId: cfg.actionId, configId: cfg.id, configVersion: run.configVersion, sourceRun: run.id, gpu: run.gpu,
      version: 1, created: DB.stamp(), visibility: "Private",
      snapshot: { color: bot.color, feet: bot.feet, appearanceRev: bot.appearanceRev, hardwareRev: bot.hardwareRev },
      training: training, compatibility: "Compatibility checked",
      simEval: run.outputs.evalAfter && training !== "Partial training" ? "Simulation evaluated" : "Not evaluated",
      hwValidation: "Not hardware validated", evaluations: [],
      files: [
        { name: "policy.onnx", type: "Policy", size: "1.8 MB", status: "Ready" },
        { name: "manifest.json", type: "Metadata", size: "2 KB", status: "Ready" },
        { name: "parameters.json", type: "Configuration", size: "7 KB", status: "Ready" },
        { name: "media/preview.mp4", type: "Video", size: null, status: "Not generated" }
      ]
    };
    if (res.simEval === "Simulation evaluated") {
      var vals = versionValues(cfg.id, run.configVersion);
      res.files.splice(3, 0, { name: "evaluation.json", type: "Evaluation", size: "3 KB", status: "Ready" });
      res.evaluations.push({ id: "eval-1", version: 1, protocol: vals["eval.protocol"], scene: vals["eval.scene"], seeds: vals["eval.seeds"], episodes: vals["eval.episodes"],
        checkpoint: ckptIter, created: DB.stamp(), sample: true, metrics: [
          { label: "Evaluator output", value: "Not reported", unit: "" }] });
    }
    if (run.outputs.keepCkpt) res.files.push({ name: "checkpoint_" + ckptIter + ".pt", type: "Training checkpoint", size: "4.2 MB", status: "Ready" });
    DB.results.unshift(res);
    run.resultId = res.id;
    return res;
  }

  /* ========================= simulated backend ========================= */
  function log(run, level, msg) { run.logs.push({ t: DB.stamp(null, true), level: level, msg: msg }); if (run.logs.length > 1000) run.logs.shift(); }
  function billFor(run) { return DB.finance.bills.filter(function (b) { return b.runId === run.id && b.service === "Training"; })[0]; }
  function lastLossX(run) { var v = run.loss.value; return v.length ? v[v.length - 1].x : (run.resume ? run.resume.iter : 0); }

  Pages._ticks.push(function () {
    DB.runs.forEach(function (run) {
      var changed = false;
      if (run.status === "Queued") {
        run._t = (run._t || 0) + 1;
        if (run._t >= 2) { run.status = "Initializing"; run._t = 0; log(run, "INFO", "GPU allocated · checking driver, Torch, Warp and model load"); }
        changed = true;
      } else if (run.status === "Initializing") {
        run._t = (run._t || 0) + 1;
        if (run._t >= 2) {
          run.status = "Running"; run.itersReported = true;
          log(run, "INFO", "Short numeric probe passed · training started · " + UI.fmtNum(versionValues(run.configId, run.configVersion).num_envs) + " environments");
          var rate = DB.finance.rates[run.gpu];
          DB.finance.bills.unshift({ id: "bill-" + run.id.slice(4), runId: run.id, requestId: run.authRef, service: "Training", date: DB.stamp(), status: "Accruing",
            settledAt: null, rateVersion: rate ? rate.version : "—", items: [{ service: "Training", interval: DB.stamp() + " – now", qty: 0, unit: "GPU hour", rate: rate ? rate.rate : 0, credits: 0 }], adjustments: [] });
        }
        changed = true;
      } else if (run.status === "Running") {
        var step = 40 + Math.floor(Math.random() * 30);
        run.iters = Math.min(run.target, run.iters + step);
        run.elapsedSec += 2;
        run.updated = DB.stamp();
        var nextX = lastLossX(run) + 100;
        while (nextX <= run.iters) {
          var p = run.target ? nextX / run.target : 0;
          if (run.id !== "run-0139") run.loss.policy.push({ x: nextX, y: +(-0.005 + (Math.random() - 0.5) * 0.024 * (1 - 0.4 * p)).toFixed(5) });
          run.loss.value.push({ x: nextX, y: +(0.3 + 0.9 * Math.exp(-3 * p) + (Math.random() - 0.5) * 0.12 * (1 - 0.5 * p)).toFixed(5) });
          nextX += 100;
        }
        var interval = run.ckptInterval || versionValues(run.configId, run.configVersion).checkpoint_interval || 500;
        var lastCk = run.checkpoints.filter(function (c) { return c.status === "Saved" && c.reason === "Scheduled"; }).pop();
        var nextCk = (lastCk ? lastCk.iter : Math.floor((run.resume ? run.resume.iter : 0) / interval) * interval) + interval;
        if (run.iters >= nextCk) {
          run.checkpoints.push({ iter: nextCk, savedAt: DB.stamp(), status: "Saved", size: "4.2 MB", reason: "Scheduled" });
          log(run, "INFO", "Checkpoint saved at iteration " + UI.fmtNum(nextCk));
        }
        run.checkpoints.forEach(function (c) {
          if (c.status === "Requested" && --c._ticks <= 0) { c.status = "Saving"; c._ticks = 1; }
          else if (c.status === "Saving" && !c._final && --c._ticks <= 0) { c.status = "Saved"; c.iter = run.iters; c.savedAt = DB.stamp(); c.size = "4.2 MB"; log(run, "INFO", "Requested checkpoint saved at iteration " + UI.fmtNum(run.iters)); }
        });
        /* metering (MASTER-only data) and the authorization boundary */
        var bill = billFor(run), req = DB.request(run.authRef);
        if (bill) {
          var it = bill.items[0];
          it.qty = +(run.elapsedSec / 3600).toFixed(4);
          it.credits = +(it.qty * it.rate).toFixed(4);
          if (req && req.limit && it.credits >= req.limit * 0.97) {
            run.status = "Stopping"; run._stopTicks = 1; run.stopReason = "authorization";
            log(run, "INFO", "Execution stopped · saving final checkpoint");
          }
        }
        if (run.maxRuntimeH && run.elapsedSec >= run.maxRuntimeH * 3600 && run.status === "Running") {
          run.status = "Stopping"; run._stopTicks = 1; run.stopReason = "Maximum runtime reached";
          log(run, "INFO", "Maximum runtime reached · saving final checkpoint");
        }
        if (run.status === "Running" && run.iters >= run.target) {
          run.status = "Completed"; run.stopReason = "Target reached";
          run.checkpoints.push({ iter: run.target, savedAt: DB.stamp(), status: "Saved", size: "4.2 MB", reason: "Final" });
          run.postproc = run.outputs.evalAfter ? "Evaluating" : "Exporting"; run._pp = 2;
          log(run, "INFO", "Target iterations reached (" + UI.fmtNum(run.target) + ")");
          if (bill) bill.status = "Finalizing";
        }
        changed = true;
      } else if (run.status === "Stopping") {
        if (--run._stopTicks <= 0) {
          run.status = "Stopped";
          run.checkpoints.forEach(function (c) {
            if (c.status === "Saving" || c.status === "Requested") {
              if (run._force) { c.status = "Failed"; }
              else { c.status = "Saved"; c.iter = run.iters; c.savedAt = DB.stamp(); c.size = "4.2 MB"; }
            }
          });
          if (run.stopReason === "authorization" || run.stopReason === "Maximum runtime reached") run.checkpoints.push({ iter: run.iters, savedAt: DB.stamp(), status: "Saved", size: "4.2 MB", reason: "Stop and save" });
          log(run, "INFO", run._force ? "Run stopped (forced) · latest progress not saved" : "Final checkpoint saved at iteration " + UI.fmtNum(run.iters) + " · run stopped");
          var b2 = billFor(run); if (b2) b2.status = "Finalizing";
        }
        changed = true;
      }
      if (run.status === "Completed" && (run.postproc === "Evaluating" || run.postproc === "Exporting")) {
        if (--run._pp <= 0) {
          if (run.postproc === "Evaluating") {
            run.postproc = "Exporting"; run._pp = 2;
            log(run, "INFO", "Evaluation finished · " + versionValues(run.configId, run.configVersion)["eval.protocol"]);
            var b3 = billFor(run), er = DB.finance.rates.evaluation;
            if (b3) b3.items.push({ service: "Evaluation", interval: DB.stamp(), qty: 1, unit: er.unit, rate: er.rate, credits: er.rate });
          } else {
            run.postproc = "Ready";
            log(run, "INFO", "ONNX exported (official path, normalizer included) · IO contract checked");
            createResult(run, "Target reached", run.target);
            log(run, "INFO", "Saved to Private playyard");
          }
        }
        changed = true;
      }
      var bill2 = billFor(run);
      if (bill2 && bill2.status === "Finalizing" && ACTIVE.indexOf(run.status) < 0 && run.postproc !== "Evaluating" && run.postproc !== "Exporting") {
        bill2._f = (bill2._f || 0) + 1;
        if (bill2._f >= 3) {
          bill2.status = "Settled"; bill2.settledAt = DB.stamp();
          var total = bill2.items.reduce(function (s, i) { return s + i.credits; }, 0);
          DB.finance.balance = Math.round((DB.finance.balance - total) * 100) / 100;
          DB.finance.balanceUpdated = DB.stamp();
        }
      }
      if (changed && Pages._runUpdate) Pages._runUpdate(run);
    });
  });
})();
