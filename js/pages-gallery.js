/* Microduck — PLAYYARD: private result showcase and result detail.
 * Only files that exist are offered; bundles never contain financial data.
 * Paid post-processing (evaluation) goes through MASTER (AUTH-01). */
(function () {
  "use strict";
  var h = UI.h;
  window.Pages = window.Pages || {};
  Pages._ticks = Pages._ticks || [];

  function feetLabel(f) { return f === "roller" ? "Roller skates" : "Standard feet"; }
  function fileReady(r, type) { return r.files.some(function (f) { return f.type === type && f.status === "Ready"; }); }
  function hasCheckpoint(r) { return fileReady(r, "Training checkpoint"); }
  function resultStatus(r) {
    if (r.training === "Partial training") return "Partial training";
    if (r.evalJob) return "Evaluation pending";
    if (r.simEval === "Evaluation failed") return "Evaluation failed";
    return "Export ready";
  }
  function versionValues(cfgId, v) { var c = DB.config(cfgId); var ver = c && DB.configVersion(c, v); return ver ? ver.values : {}; }

  function evalSignature(r) {
    var vals = versionValues(r.configId, r.configVersion);
    var ck = r.files.filter(function (f) { return f.type === "Training checkpoint"; })[0];
    return JSON.stringify([r.id, r.version, "evaluation", ck ? ck.name : "policy.onnx", vals["eval.protocol"], vals["eval.seeds"], vals["eval.episodes"]]);
  }
  function evalRequest(r) {
    var list = DB.finance.requests.filter(function (q) { return q.source.type === "result" && q.source.resultId === r.id && q.kind === "evaluation"; });
    return list[list.length - 1] || null;
  }

  /* ============================ G-01 Showcase ============================ */
  Pages.gallery = function (view) {
    App.title("PLAYYARD");
    var F = App.state.galleryFilter;
    var page = h("div", { class: "page" },
      h("div", { class: "page-head" },
        h("div", {}, h("h1", { class: "page-title", text: F.scope === "official" ? "Official references" : "My results" }),
          h("div", { class: "page-sub", text: F.scope === "official" ? "Official ONNX references from the locked policy catalog. These are not your trained results." : "Your trained policies and recordings. Private by default." })),
        h("div", { class: "page-actions" }, h("button", { class: "btn", onclick: function () { App.go("#/gallery"); } }, "Browse templates in Gallery"))));
    page.appendChild(UI.tabs([["mine", "My results"], ["official", "Official references"]], F.scope || "mine", function (s) {
      F.scope = s; App.rerender();
    }, "tabs-sub"));

    var search = h("input", { class: "input", type: "search", placeholder: F.scope === "official" ? "Search official policies" : "Search results", value: F.q, oninput: function () { F.q = search.value; paint(); } });
    var bot = h("select", { class: "input", "aria-label": "Bot", onchange: function () { F.bot = bot.value; paint(); } }, h("option", { value: "", text: "All bots" }));
    DB.bots.forEach(function (b) { bot.appendChild(h("option", { value: b.id, text: b.name, selected: F.bot === b.id })); });
    var action = h("select", { class: "input", "aria-label": "Action", onchange: function () { F.action = action.value; paint(); } }, h("option", { value: "", text: "All actions" }));
    DB.actions.forEach(function (a) { action.appendChild(h("option", { value: a.id, text: a.name, selected: F.action === a.id })); });
    var feet = h("select", { class: "input", "aria-label": "Foot type", onchange: function () { F.feet = feet.value; paint(); } },
      h("option", { value: "", text: "All foot types" }), h("option", { value: "standard", text: "Standard feet", selected: F.feet === "standard" }), h("option", { value: "roller", text: "Roller skates", selected: F.feet === "roller" }));
    var status = h("select", { class: "input", "aria-label": "Status", onchange: function () { F.status = status.value; paint(); } }, h("option", { value: "", text: "All statuses" }));
    ["Export ready", "Evaluation pending", "Evaluation failed", "Partial training"].forEach(function (s) { status.appendChild(h("option", { value: s, text: s, selected: F.status === s })); });
    var video = h("input", { type: "checkbox", checked: !!F.video });
    video.addEventListener("change", function () { F.video = video.checked; paint(); });
    var sort = h("select", { class: "input", "aria-label": "Sort", onchange: function () { F.sort = sort.value; paint(); } },
      h("option", { value: "newest", text: "Newest" }), h("option", { value: "updated", text: "Last updated", selected: F.sort === "updated" }), h("option", { value: "name", text: "Name", selected: F.sort === "name" }));
    var toolbar = h("div", { class: "toolbar" }, search);
    if (F.scope !== "official") toolbar.appendChild(bot);
    toolbar.appendChild(action);
    toolbar.appendChild(feet);
    if (F.scope !== "official") {
      toolbar.appendChild(status);
      toolbar.appendChild(h("label", { class: "check-inline" }, video, " Has video"));
    }
    toolbar.appendChild(sort);
    page.appendChild(toolbar);
    var meta = h("div", {});
    page.appendChild(meta);
    var grid = h("div", {});
    page.appendChild(grid);
    view.appendChild(page);

    function clearSandboxFilters() {
      App.state.galleryFilter = { q: "", bot: "", action: "", feet: "", status: "", sort: "newest", video: false, scope: F.scope || "mine" };
      App.rerender();
    }
    function seriesKey(r) { return r.botId + "|" + r.actionId + "|" + r.name.replace(/ \(partial\)$/, ""); }
    function paint() {
      grid.innerHTML = "";
      meta.innerHTML = "";
      if (F.scope === "official") {
        var refs = DB.actions.filter(function (a) {
          if (F.action && a.id !== F.action) return false;
          if (F.feet === "roller" && a.feet !== "roller") return false;
          if (F.feet === "standard" && a.feet === "roller") return false;
          if (F.q && (a.name + " " + a.file + " " + a.category).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false;
          return true;
        });
        refs.sort(function (a, b) { return F.sort === "name" ? a.name.localeCompare(b.name) : 0; });
        var filteredOff = !!(F.q || F.action || F.feet);
        meta.appendChild(UI.filterMeta(refs.length, DB.actions.length, filteredOff, clearSandboxFilters, "official references"));
        if (!refs.length) {
          grid.appendChild(UI.empty("No official references match these filters.", h("button", { class: "btn", onclick: clearSandboxFilters }, "Clear filters")));
          return;
        }
        var og = h("div", { class: "card-grid" });
        refs.forEach(function (a) { og.appendChild(officialCard(a)); });
        grid.appendChild(og);
        return;
      }
      if (!DB.results.length) {
        grid.appendChild(UI.empty("No results yet. Start a training run in Arena.", h("button", { class: "btn btn-primary", onclick: function () { App.go("#/arena/new"); } }, "Go to Arena")));
        return;
      }
      var list = DB.results.filter(function (r) {
        if (r.archived) return false;
        if (F.q) { var b = DB.bot(r.botId); if ((r.name + " " + (b ? b.name : "") + " " + DB.action(r.actionId).name + " v" + r.version).toLowerCase().indexOf(F.q.toLowerCase()) < 0) return false; }
        if (F.bot && r.botId !== F.bot) return false;
        if (F.action && r.actionId !== F.action) return false;
        if (F.feet && r.snapshot.feet !== F.feet) return false;
        if (F.status && resultStatus(r) !== F.status) return false;
        if (F.video && !fileReady(r, "Video")) return false;
        return true;
      });
      list.sort(function (a, b) { return F.sort === "name" ? a.name.localeCompare(b.name) : (a.created < b.created ? 1 : -1); });
      var groups = [], seen = {};
      list.forEach(function (r) {
        var k = seriesKey(r);
        if (!seen[k]) { seen[k] = []; groups.push(seen[k]); }
        seen[k].push(r);
      });
      var filtered = !!(F.q || F.bot || F.action || F.feet || F.status || F.video);
      meta.appendChild(UI.filterMeta(groups.length, DB.results.filter(function (r) { return !r.archived; }).length, filtered, clearSandboxFilters, "results"));
      if (!list.length) {
        grid.appendChild(UI.empty("No results match these filters.", h("button", { class: "btn", onclick: clearSandboxFilters }, "Clear filters")));
        return;
      }
      var g = h("div", { class: "card-grid" });
      groups.forEach(function (series) { g.appendChild(resultCard(series[0], series)); });
      grid.appendChild(g);
    }
    paint();
  };

  function officialCard(a) {
    var open = function () { App.go("#/gallery"); };
    return h("article", { class: "card", tabindex: "0", onclick: open, onkeydown: function (e) { if (e.key === "Enter") open(); } },
      UI.poster({ variant: a.feet === "roller" ? "roller" : "standard", w: 376, h: 212, label: "Official reference · no recording", alt: a.name + " official reference poster" }),
      h("div", { class: "card-body" },
        h("div", { class: "card-title-row" }, h("div", { class: "card-title", text: a.name })),
        h("div", { class: "card-meta" }, a.category + " · " + a.manifest.kind + " · " + a.file),
        h("div", { class: "card-meta" }, (a.feet === "roller" ? "Roller skates" : "Any foot type") + " · " + DB.SOURCES.policiesRepo + " @" + DB.SOURCES.policiesRev.slice(0, 7)),
        h("div", { class: "tags mt8" }, UI.badge("Official reference", "info"), UI.badge("Not a training result", "neutral")),
        h("div", { class: "card-foot" }, h("span", { class: "small muted", text: "No source run" }),
          h("button", { class: "link-btn", onclick: function (e) { e.stopPropagation(); App.go("#/gallery"); } }, "Use as template"))));
  }

  function resultCard(r, series) {
    series = series || [r];
    var b = DB.bot(r.botId), a = DB.action(r.actionId);
    var open = function () { App.go("#/playyard/results/" + r.id); };
    var caps = [["ONNX", "Policy"], ["Params", "Configuration"], ["Video", "Video"], ["Checkpoint", "Training checkpoint"]];
    var versions = h("div", {});
    if (series.length > 1) {
      var openList = false;
      var list = h("div", { class: "version-list", style: "display:none" });
      series.slice(1).forEach(function (v) {
        list.appendChild(h("button", { class: "link-btn", onclick: function (e) { e.stopPropagation(); App.go("#/playyard/results/" + v.id); } },
          "v" + v.version + " · " + v.created.slice(0, 10) + " · " + resultStatus(v)));
      });
      var toggle = h("button", { class: "link-btn", onclick: function (e) {
        e.stopPropagation(); openList = !openList; list.style.display = openList ? "flex" : "none";
        toggle.textContent = openList ? "Hide versions" : "Show versions (" + series.length + ")";
      } }, "Show versions (" + series.length + ")");
      versions.appendChild(h("div", { class: "small muted", text: "Latest version · v" + r.version + " (by creation, not quality)" }));
      versions.appendChild(toggle);
      versions.appendChild(list);
    }
    return h("article", { class: "card", tabindex: "0", onclick: open, onkeydown: function (e) { if (e.key === "Enter") open(); } },
      UI.poster({ variant: r.snapshot.feet, w: 376, h: 212, label: fileReady(r, "Video") ? null : "No recording", alt: r.name + " model poster" }),
      h("div", { class: "card-body" },
        h("div", { class: "card-title-row" }, h("div", { class: "card-title", text: r.name }),
          UI.menu("Download options for " + r.name, [["Download available files", function () { downloadBundle(r); }], ["Open result", open]])),
        h("div", { class: "card-meta" }, (b ? b.name : "—") + " · " + a.name + " · Version " + r.version),
        h("div", { class: "card-meta" }, feetLabel(r.snapshot.feet) + " · Created " + r.created.slice(0, 10)),
        h("div", { class: "tags mt8" }, UI.badge(resultStatus(r)), UI.badge(r.simEval === "Simulation evaluated" ? "Simulation evaluated" : r.evalJob ? "Evaluating" : "Not evaluated", r.simEval === "Simulation evaluated" ? "ok" : "neutral"),
          UI.badge("Not hardware validated", "neutral")),
        h("div", { class: "caps" }, caps.map(function (c) { var on = fileReady(r, c[1]); return h("span", { class: "cap" + (on ? " on" : ""), title: on ? c[0] + " available" : c[0] + " not available", text: (on ? "✓ " : "– ") + c[0] }); })),
        versions,
        h("div", { class: "card-foot" }, h("span", { class: "small muted", text: r.visibility }), h("button", { class: "link-btn", onclick: function (e) { e.stopPropagation(); open(); } }, "Open result"))));
  }

  /* ---------------- generated file contents (no financial fields) ---------------- */
  function manifestFor(r) {
    var a = DB.action(r.actionId), vals = versionValues(r.configId, r.configVersion);
    var m = DB.clone(DB.SHARED_MANIFEST);
    m.name = a.manifest.name || a.id;
    m.kind = a.manifest.kind;
    if (a.manifest.mode) m.mode = a.manifest.mode;
    if (vals.action_scale != null) m.action_scale = vals.action_scale;
    if (vals.duration_s != null) m.duration_s = vals.duration_s;
    if (vals.chain != null) m.chain = vals.chain;
    if (a.manifest.command) {
      m.command = DB.clone(a.manifest.command);
      if (vals.period_s != null) m.command.period_s = vals.period_s;
      if (vals.end_phase != null) m.command.end_phase = vals.end_phase;
      if (vals["command.sit"] != null) { m.command.sit = vals["command.sit"]; m.command.stand = vals["command.stand"]; m.command.idle = vals["command.idle"]; }
    }
    if (vals.ramp_s != null) { m.ramp_s = vals.ramp_s; m.unwind_s = vals.unwind_s; }
    m.source = { kind: "my_training", run: r.sourceRun, configuration: r.configId + "@v" + r.configVersion,
      template: { repo: DB.SOURCES.policiesRepo, revision: DB.SOURCES.policiesRev, file: a.file } };
    return m;
  }
  function parametersFor(r) {
    var cfg = DB.config(r.configId), run = DB.run(r.sourceRun), bot = DB.bot(r.botId);
    var vals = versionValues(r.configId, r.configVersion);
    var overrides = {};
    Object.keys(vals).forEach(function (k) { if (JSON.stringify(vals[k]) !== JSON.stringify(cfg.baseline[k])) overrides[k] = vals[k]; });
    return {
      configuration: { id: cfg.id, version: r.configVersion, name: cfg.name, action: r.actionId, source: cfg.source },
      template_baseline: cfg.baseline, user_overrides: overrides, effective_configuration: vals,
      curriculum_effective: "Not reported",
      hardware: { bot: r.botId, hardware_revision: r.snapshot.hardwareRev, appearance_revision: r.snapshot.appearanceRev, feet: r.snapshot.feet,
        motors: bot ? DB.botMotorIds(bot).map(function (id) { var m = DB.motor(id); return { id: id, name: m.name, revision: m.revision, model: m.model, actuator: m.actuator }; }) : [] },
      compute: run ? { gpu: run.gpu, maximum_runtime_h: run.maxRuntimeH, resume: run.resume } : null,
      sources: { policies: DB.SOURCES.policiesRepo + "@" + DB.SOURCES.policiesRev, training: DB.SOURCES.trainingRepo + "@" + DB.SOURCES.trainingRev, bam: "Rhoban/bam@" + DB.SOURCES.bamRev },
      _note: "Generated by the Microduck front-end prototype."
    };
  }
  function evaluationFor(r) { return { reports: r.evaluations, _note: "Sample evaluation data from the Microduck front-end prototype." }; }

  function downloadFile(r, f) {
    if (f.status !== "Ready") return;
    var base = f.name.replace("media/", "");
    if (f.name === "manifest.json") UI.download(base, JSON.stringify(manifestFor(r), null, 2), "application/json");
    else if (f.name === "parameters.json") UI.download(base, JSON.stringify(parametersFor(r), null, 2), "application/json");
    else if (f.name === "evaluation.json") UI.download(base, JSON.stringify(evaluationFor(r), null, 2), "application/json");
    else { UI.toast("Binary files (" + f.name + ") are not stored in this local demo."); return; }
    UI.toast(base + " downloaded.", "ok");
  }
  function downloadBundle(r) {
    var index = r.files.map(function (f) { return { name: f.name, type: f.type, status: f.status, included: f.status === "Ready" && /\.json$/.test(f.name) }; });
    var bundle = {
      bundle: r.name + " v" + r.version, complete_policy_bundle: false,
      files: index,
      missing: index.filter(function (f) { return f.status !== "Ready"; }).map(function (f) { return f.name; }),
      "manifest.json": manifestFor(r), "parameters.json": parametersFor(r),
      "evaluation.json": r.evaluations.length ? evaluationFor(r) : undefined,
      _note: "Binary files (ONNX, checkpoint, video) are not stored in this local demo."
    };
    UI.download(r.id + "-bundle.json", JSON.stringify(bundle, null, 2), "application/json");
    UI.toast("Available files downloaded. Missing items are listed in the bundle index.", "ok");
  }

  /* ============================ G-02 Result detail ============================ */
  Pages.galleryDetail = function (view, params) {
    var r = DB.result(params.id);
    if (!r) { view.appendChild(h("div", { class: "page" }, UI.empty("You do not have access to this result.", h("button", { class: "btn", onclick: function () { App.go("#/playyard"); } }, "Back to Playyard")))); return; }
    var q = params.query || {};
    var tab = q.tab || "files";
    var bot = DB.bot(r.botId), a = DB.action(r.actionId), cfg = DB.config(r.configId), run = DB.run(r.sourceRun);
    App.title("PLAYYARD / " + r.name);

    var page = h("div", { class: "page page-wide" },
      h("div", { class: "page-head" },
        h("div", {}, h("h1", { class: "page-title", text: r.name }),
          h("div", { class: "page-sub" }, "Version " + r.version + " · " + r.visibility + " · ", UI.badge(resultStatus(r)))),
        h("div", { class: "page-actions" },
          h("button", { class: "btn btn-primary", onclick: function () { downloadBundle(r); } }, r.files.every(function (f) { return f.status === "Ready"; }) ? "Download bundle" : "Download available files"),
          UI.menu("More result actions", [["Rename", rename]]))));
    view.appendChild(page);
    if (bot && bot.archived) page.appendChild(UI.alert("info", "Source bot archived. This result is still available."));
    if (bot && bot.hardwareRev > r.snapshot.hardwareRev) page.appendChild(UI.alert("info", "This result uses an earlier hardware revision (" + r.snapshot.hardwareRev + "; current " + bot.hardwareRev + ")."));
    if (r.training === "Partial training") page.appendChild(UI.alert("warn", "Partial training — the run stopped before its target. The policy is usable for review but is not a completed target."));

    var media = h("div", {});
    media.appendChild(h("div", { class: "media-frame" },
      UI.poster({ variant: r.snapshot.feet, w: 808, h: 420, label: "No recording", alt: r.name + " model poster" })));
    media.appendChild(h("div", { class: "media-meta" },
      h("span", { text: "No recording. View the model or generate a preview." }),
      h("span", { class: "muted", text: "Poster shows the bot model in its original colors — not policy behaviour." })));
    media.appendChild(h("div", { class: "flex mt8 mb20" },
      h("button", { class: "btn btn-sm", disabled: true, title: "Recording service not connected in this demo" }, "Generate recording"),
      h("button", { class: "btn btn-sm", disabled: true, title: "Policy playback not connected in this demo" }, "Start simulation"),
      h("span", { class: "small muted", text: "Recording and policy simulation are not connected in this local demo." })));

    var rail = h("div", { class: "rail" },
      h("div", { class: "rail-card" },
        h("div", { class: "rail-title", text: "Source" }),
        UI.kv("Bot", bot ? h("button", { class: "link-btn", onclick: function () { App.go("#/gallery/bots/" + r.botId); } }, bot.name) : "—"),
        UI.kv("Hardware revision", String(r.snapshot.hardwareRev)),
        UI.kv("Foot type", feetLabel(r.snapshot.feet)),
        UI.kv("Configuration", cfg ? h("button", { class: "link-btn", onclick: function () { App.go("#/gallery/bots/" + r.botId + "?cfg=" + r.configId + "&v=" + r.configVersion); } }, cfg.name + " · v" + r.configVersion) : "—"),
        UI.kv("Action", a.name),
        UI.kv("Source run", run ? h("button", { class: "link-btn", onclick: function () { App.go("#/arena/runs/" + run.id); } }, run.name) : "—"),
        UI.kv("GPU profile", (DB.gpu(r.gpu) || {}).name || "—"),
        UI.kv("Finished at", r.created),
        UI.kv("Model API", "model_api " + DB.SHARED_MANIFEST.model_api + " · [1," + DB.SHARED_MANIFEST.obs_len + "] → [1," + DB.SHARED_MANIFEST.action_len + "]"),
        h("div", { class: "rail-divider" }),
        UI.kv("Produced by", "My training"),
        UI.kv("Template reference", a.file + " @ " + DB.SOURCES.policiesRev.slice(0, 7))),
      h("div", { class: "rail-card" },
        h("div", { class: "rail-title", text: "Validation" }),
        UI.kv("Compatibility", UI.badge(r.compatibility)),
        UI.kv("Simulation evaluation", UI.badge(r.simEval, r.simEval === "Simulation evaluated" ? "ok" : "neutral")),
        UI.kv("Hardware validation", UI.badge(r.hwValidation, "neutral")),
        h("div", { class: "small muted mt8", text: "These are independent. No hardware test has been run, so this result is not ready to deploy." })));
    page.appendChild(h("div", { class: "two-col" }, media, rail));

    var tabHost = h("div", {});
    page.appendChild(tabHost);
    function paintTabs() {
      tabHost.innerHTML = "";
      tabHost.appendChild(UI.tabs([["files", "Files"], ["evaluation", "Evaluation"], ["configuration", "Configuration"], ["versions", "Versions"]], tab, function (t) {
        tab = t; history.replaceState(null, "", "#/playyard/results/" + r.id + "?tab=" + t); App._prevHash = location.hash; paintTabs();
      }));
      var body = h("div", {});
      tabHost.appendChild(body);
      if (tab === "evaluation") evaluationTab(body);
      else if (tab === "configuration") configurationTab(body);
      else if (tab === "versions") versionsTab(body);
      else filesTab(body);
    }

    function filesTab(body) {
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Name"), UI.th("Type"), UI.th("Size", true), UI.th("Validation"), UI.th("Download"))));
      var tb = h("tbody", {});
      r.files.forEach(function (f) {
        tb.appendChild(h("tr", {},
          h("td", {}, h("code", { text: f.name })), h("td", { text: f.type }), h("td", { class: "num", text: f.size || "—" }),
          h("td", {}, UI.badge(f.status)),
          h("td", {}, f.status === "Ready" ? h("button", { class: "btn btn-sm", onclick: function () { downloadFile(r, f); } }, "Download") : h("span", { class: "muted small", text: "Not available" }))));
      });
      tbl.appendChild(tb);
      body.appendChild(h("div", { class: "flex-between mb8" }, h("span", { class: "small muted", text: "Only files that exist can be downloaded. Downloading never starts training, recording or paid resources." }), UI.sampleTag("Sample artifacts")));
      body.appendChild(h("div", { class: "table-wrap" }, tbl));
      if (!hasCheckpoint(r)) body.appendChild(h("div", { class: "small muted mt8", text: "ONNX-only result: it can be reused as a reference, but training cannot be resumed from it." }));
    }

    function evaluationTab(body) {
      var req = evalRequest(r);
      var sig = evalSignature(r);
      var confirmed = req && req.status === "Confirmed" && req.signature === sig;
      var actionBtn;
      if (r.evalJob) actionBtn = h("button", { class: "btn", disabled: true }, "Evaluating…");
      else if (confirmed) actionBtn = h("button", { class: "btn btn-primary", onclick: function () { runEvaluation(req); } }, r.evaluations.length ? "Run evaluation again" : "Run evaluation");
      else actionBtn = h("button", { class: "btn btn-primary", onclick: reviewEvaluation }, "Review in Master");
      var vals = versionValues(r.configId, r.configVersion);
      body.appendChild(h("div", { class: "flex-between mb12" },
        h("div", { class: "small muted", text: "Evaluation preset from configuration v" + r.configVersion + ": " + vals["eval.protocol"] + " · scene " + vals["eval.scene"] + " · seeds " + vals["eval.seeds"] + " · " + vals["eval.episodes"] + " episodes per seed." }),
        h("div", { class: "flex" }, confirmed ? h("span", { class: "small ok-text", text: "Request confirmed." }) : req && req.status === "Confirmed" ? h("span", { class: "small muted", text: "Review this request in Master to continue." }) : null, actionBtn)));
      if (!r.evaluations.length) {
        body.appendChild(UI.empty(r.evalJob ? "Evaluation running. Your policy files remain available." : "Not evaluated. Loss or reward values are not used as a substitute."));
      }
      r.evaluations.slice().reverse().forEach(function (ev) {
        var t = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Metric"), UI.th("Value", true), UI.th("Unit"))));
        t.appendChild(h("tbody", {}, ev.metrics.map(function (m) { return h("tr", {}, h("td", { text: m.label }), h("td", { class: "num", text: m.value }), h("td", { class: "muted", text: m.unit || "—" })); })));
        body.appendChild(UI.section("Report v" + ev.version, ev.protocol + " · scene " + ev.scene + " · seeds " + ev.seeds + " · " + ev.episodes + " episodes per seed · checkpoint " + UI.fmtNum(ev.checkpoint) + " · " + ev.created,
          ev.sample ? h("div", { class: "mb8" }, UI.sampleTag()) : null, h("div", { class: "table-wrap" }, t),
          h("div", { class: "small muted mt8", text: "Simulation evaluated. Not hardware validated. Comparable only with reports that use the same hardware, task, scene, seeds and protocol." })));
      });
    }
    function reviewEvaluation() {
      var sig = evalSignature(r);
      var prev = evalRequest(r);
      var req = prev && prev.status === "Pending review" && prev.signature === sig ? prev : null;
      if (!req) {
        req = { id: "req-" + String(DB.state.nextReq++).padStart(4, "0"), kind: "evaluation", status: "Pending review",
          source: { type: "result", resultId: r.id, version: r.version }, signature: sig, createdAt: DB.stamp(), limit: null,
          returnHash: "#/playyard/results/" + r.id + "?tab=evaluation", returnLabel: "Return to result" };
        DB.finance.requests.push(req);
      }
      App.go("#/master/credits/review/" + req.id);
    }
    function runEvaluation(req) {
      if (req.status !== "Confirmed") return;
      req.status = "Consumed";
      r.evalJob = { ticks: 3, reqId: req.id, started: DB.stamp() };
      UI.toast("Evaluation started.", "ok");
      paintTabs();
    }

    function configurationTab(body) {
      if (!cfg) { body.appendChild(UI.empty("Configuration unavailable.")); return; }
      var schema = DB.schemaFor(cfg.actionId, cfg.source);
      var vals = versionValues(cfg.id, r.configVersion);
      var ckOk = hasCheckpoint(r);
      body.appendChild(h("div", { class: "flex mb12" },
        h("button", { class: "btn", onclick: createConfiguration }, "Create configuration"),
        ckOk ? h("button", { class: "btn", onclick: function () { App.go("#/arena/new?fromResult=" + r.id); } }, "Resume in Arena") : null,
        h("button", { class: "btn", onclick: function () { App.go("#/gallery/bots/" + r.botId + "/new-config?action=" + r.actionId); } }, "New policy in Gallery")));
      body.appendChild(h("div", { class: "small muted mb12", text: ckOk ? "Resume in Arena checks hardware, task and runtime compatibility and prepares a new run; nothing starts automatically." : "ONNX-only result: Resume training is not available. Create a configuration to train again." }));
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Parameter"), UI.th("Effective run value"), UI.th("Original template"), UI.th("Custom override"))));
      var tb = h("tbody", {});
      function fmt(v) { return v == null ? "Not provided" : Array.isArray(v) ? v.map(UI.fmtValue).join(" – ") : UI.fmtValue(v); }
      schema.groups.forEach(function (g) {
        if (!g.params.length) return;
        tb.appendChild(h("tr", { class: "group-row" }, h("td", { colspan: "4", text: g.name })));
        g.params.forEach(function (p) {
          var ov = JSON.stringify(vals[p.key]) !== JSON.stringify(cfg.baseline[p.key]);
          tb.appendChild(h("tr", {}, h("td", {}, p.label, h("div", { class: "p-key", text: p.key })), h("td", { text: fmt(vals[p.key]) + (p.unit ? " " + p.unit : "") }), h("td", { class: "muted", text: fmt(cfg.baseline[p.key]) }), h("td", { text: ov ? "Yes" : "—" })));
        });
      });
      tb.appendChild(h("tr", { class: "group-row" }, h("td", { colspan: "4", text: "Rewards (snapshot at run creation)" })));
      schema.rewards.forEach(function (rw) {
        var k = "rw:" + rw.term, ov = vals[k] !== cfg.baseline[k];
        tb.appendChild(h("tr", {}, h("td", { text: rw.term }), h("td", { text: fmt(vals[k]) }), h("td", { class: "muted", text: fmt(cfg.baseline[k]) }), h("td", { text: ov ? "Yes" : "—" })));
      });
      if (schema.curriculum.length) {
        tb.appendChild(h("tr", { class: "group-row" }, h("td", { colspan: "4", text: "Curriculum" })));
        schema.curriculum.forEach(function (c) {
          tb.appendChild(h("tr", {}, h("td", { text: c.term }), h("td", { class: "muted", text: "Not reported" }), h("td", { class: "muted", text: c.rule }), h("td", { text: "—" })));
        });
      }
      tbl.appendChild(tb);
      body.appendChild(h("div", { class: "table-wrap" }, tbl));
      body.appendChild(h("div", { class: "small muted mt8", text: "Read-only. Training parameters are edited only in GALLERY; effective curriculum values are shown only when a run reports them." }));
    }
    function createConfiguration() {
      var target = DB.bot(r.botId);
      if (!target || target.archived) { UI.toast("Source bot archived. Restore it in Gallery first.", "err"); return; }
      var src = DB.configVersion(cfg, r.configVersion);
      var c = { id: "cfg-" + (DB.state.nextCfg++), botId: r.botId, actionId: cfg.actionId, name: cfg.name + " — from " + r.name, source: cfg.source,
        templateRev: cfg.templateRev, baseline: DB.clone(cfg.baseline), derivedFrom: r.id,
        versions: [{ v: 1, savedAt: DB.stamp(), values: DB.clone(src.values), note: "Created from result " + r.name + " v" + r.version }], draft: null, archived: false };
      DB.configs.push(c);
      UI.toast("Configuration created in Gallery.", "ok");
      App.go("#/gallery/bots/" + r.botId + "?cfg=" + c.id);
    }

    function versionsTab(body) {
      var series = DB.results.filter(function (x) { return x.name.replace(/ \(partial\)$/, "") === r.name.replace(/ \(partial\)$/, "") && x.botId === r.botId; });
      var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Version"), UI.th("Source run"), UI.th("Configuration"), UI.th("Created"), UI.th("Status"))));
      var tb = h("tbody", {});
      series.forEach(function (x) {
        var rr = DB.run(x.sourceRun);
        tb.appendChild(h("tr", { class: x.id === r.id ? "selected" : "", onclick: function () { App.go("#/playyard/results/" + x.id); } },
          h("td", { class: "row-title", text: "v" + x.version + (x.id === r.id ? " (shown)" : "") }), h("td", { text: rr ? rr.name : x.sourceRun }),
          h("td", { text: "v" + x.configVersion }), h("td", { text: x.created }), h("td", {}, UI.badge(resultStatus(x)))));
      });
      tbl.appendChild(tb);
      body.appendChild(h("div", { class: "table-wrap" }, tbl));
      body.appendChild(h("div", { class: "small muted mt8", text: "Latest is by creation order, not quality. Each version keeps its own files, evaluation and source run." }));
    }

    function rename() {
      var inp = h("input", { class: "input", value: r.name });
      UI.modal({ title: "Rename result", body: UI.field("Name", inp, { helper: "Only the display name changes. Artifact IDs and files stay the same." }), actions: [{ label: "Cancel" }, { label: "Rename", kind: "primary", onClick: function () {
        if (!inp.value.trim()) return true; r.name = inp.value.trim(); App.rerender();
      } }] });
    }

    paintTabs();
    Pages._runUpdate = function () { if (tab === "evaluation" && (r.evalJob || r._justEvaluated)) { r._justEvaluated = false; paintTabs(); } };
  };

  /* evaluation jobs started from PLAYYARD */
  Pages._ticks.push(function () {
    DB.results.forEach(function (r) {
      if (!r.evalJob) return;
      if (--r.evalJob.ticks > 0) { if (Pages._runUpdate) Pages._runUpdate(r); return; }
      var vals = versionValues(r.configId, r.configVersion);
      var ck = r.files.filter(function (f) { return f.type === "Training checkpoint"; })[0];
      r.evaluations.push({ id: "eval-" + (r.evaluations.length + 1), version: r.evaluations.length + 1, protocol: vals["eval.protocol"], scene: vals["eval.scene"],
        seeds: vals["eval.seeds"], episodes: vals["eval.episodes"], checkpoint: ck ? +ck.name.replace(/\D/g, "") : DB.run(r.sourceRun).iters, created: DB.stamp(), sample: true,
        metrics: [{ label: "Evaluator output", value: "Not reported", unit: "" }, { label: "Episodes requested", value: String(vals["eval.episodes"] * String(vals["eval.seeds"]).split(",").length), unit: "" }] });
      r.simEval = "Simulation evaluated";
      if (!r.files.some(function (f) { return f.name === "evaluation.json"; })) r.files.splice(3, 0, { name: "evaluation.json", type: "Evaluation", size: "3 KB", status: "Ready" });
      var er = DB.finance.rates.evaluation;
      DB.finance.bills.unshift({ id: "bill-e" + String(DB.finance.bills.length + 1).padStart(3, "0"), runId: r.sourceRun, resultId: r.id, requestId: r.evalJob.reqId, service: "Evaluation",
        date: r.evalJob.started, status: "Finalizing", settledAt: null, rateVersion: er.version,
        items: [{ service: "Evaluation", interval: r.evalJob.started + " – " + DB.stamp(), qty: 1, unit: er.unit, rate: er.rate, credits: er.rate }], adjustments: [], _f: 0 });
      r.evalJob = null;
      r._justEvaluated = true;
      if (Pages._runUpdate) Pages._runUpdate(r);
    });
    DB.finance.bills.forEach(function (b) {
      if (b.service === "Evaluation" && b.status === "Finalizing" && ++b._f >= 3) {
        b.status = "Settled"; b.settledAt = DB.stamp();
        DB.finance.balance = Math.round((DB.finance.balance - b.items.reduce(function (s, i) { return s + i.credits; }, 0)) * 100) / 100;
        DB.finance.balanceUpdated = DB.stamp();
      }
    });
  });
})();
