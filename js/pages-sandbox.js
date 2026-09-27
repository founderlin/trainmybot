/* GALLERY: robot showcase (Microduck, Beni, Sesame), bot detail, configurations. Motors are catalog-only.
 * GALLERY is the only place where training parameters are edited. No financial values appear here. */
(function () {
  "use strict";
  var h = UI.h;
  window.Pages = window.Pages || {};

  /* ------------------------------ helpers ------------------------------ */
  function botConfigs(bot) { return DB.configs.filter(function (c) { return c.botId === bot.id && !c.archived; }); }
  function hardwareLabel(bot) {
    var ids = DB.botMotorIds(bot);
    if (ids.length > 1) return "Mixed motors (" + ids.length + " types)";
    var m = DB.motor(ids[0]);
    return m ? (m.official ? m.family : m.name) : "No motor";
  }
  function softwareCats(bot) {
    var seen = {}, out = [];
    botConfigs(bot).forEach(function (c) { var a = DB.action(c.actionId); if (!seen[a.category]) { seen[a.category] = true; out.push(a.category); } });
    return out;
  }
  function feetLabel(f) {
    if (f === "roller") return "Roller skates";
    if (f === "wheel") return "Wheels";
    if (f === "quad") return "Quadruped";
    if (f === "standard") return "Standard feet";
    return "—";
  }
  function feetSummary(bot) {
    var p = DB.platform(bot.platform);
    if (p.feet && p.feet.length > 1) return "Standard feet / Roller skates";
    if (p.form) return p.form;
    return feetLabel(bot.feet);
  }
  function motorOptions(selected, platformId) {
    var sel = h("select", { class: "input" });
    DB.motorsFor(platformId).forEach(function (m) {
      sel.appendChild(h("option", { value: m.id, selected: m.id === selected, text: m.name }));
    });
    return sel;
  }
  function modelHost(host, bot, opts) {
    opts = opts || {};
    var plat = DB.platform(bot.platform);
    if (plat.viewer) {
      return UI.viewer(host, {
        label: "Model preview", variant: DB.previewVariant(bot, plat.preview ? null : opts.variant),
        assist: plat.preview ? false : opts.assist,
        size: opts.size, reset: opts.reset, commands: opts.commands, sub: opts.sub,
        onState: opts.onState, onModelError: opts.onModelError
      });
    }
    host.appendChild(h("div", { class: "viewer-placeholder" },
      h("div", { class: "strong", text: bot.name }),
      h("div", { text: "Model preview is not connected for this robot." }),
      h("div", { class: "small", text: DB.platform(bot.platform).repo })));
    return { setModel: function () {}, destroy: function () {} };
  }
  function cfgStatus(cfg, bot) { return DB.validate(cfg, cfg.draft || DB.latestVersion(cfg).values, bot).status; }
  function versionStatus(cfg, v, bot) { return DB.validate(cfg, DB.configVersion(cfg, v).values, bot).status; }
  function runsUsing(cfgId, v) { return DB.runs.filter(function (r) { return r.configId === cfgId && (v == null || r.configVersion === v); }); }
  function pageHead(title, sub, actions) {
    return h("div", { class: "page-head" },
      h("div", {}, h("h1", { class: "page-title", text: title }), sub ? h("div", { class: "page-sub" }, sub) : null),
      actions ? h("div", { class: "page-actions" }, actions) : null);
  }

  function swatches(selected, onPick) {
    var wrap = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Color" });
    DB.palettes.forEach(function (p) {
      var on = p.key === selected;
      wrap.appendChild(h("button", {
        class: "swatch" + (on ? " selected" : ""), role: "radio", "aria-checked": on ? "true" : "false", title: p.label,
        onclick: function () { onPick(p.key); }
      }, h("span", { class: "swatch-chip", style: "background:" + p.hex }, on ? h("span", { class: "swatch-check", text: "✓" }) : null), h("span", { class: "swatch-label", text: p.label })));
    });
    return wrap;
  }
  function segmented(options, value, onPick, label) {
    var wrap = h("div", { class: "segmented", role: "radiogroup", "aria-label": label || "" });
    options.forEach(function (o) {
      wrap.appendChild(h("button", { class: "seg" + (o[0] === value ? " active" : ""), role: "radio", "aria-checked": o[0] === value ? "true" : "false", onclick: function () { onPick(o[0]); } }, o[1]));
    });
    return wrap;
  }
  /* ============================ S-01 Showcase ============================ */
  Pages.sandbox = function (view) {
    App.title("GALLERY");
    var F = App.state.botFilter;
    var page = h("div", { class: "page" },
      pageHead("Robots", "Microduck, Beni and Sesame. Choose a motor from the catalog — new motors are added in the backend.", null));

    var feet = h("select", { class: "input", "aria-label": "Foot type", onchange: function () { F.feet = feet.value; paint(); } },
      h("option", { value: "", text: "All foot types" }), h("option", { value: "standard", text: "Standard feet", selected: F.feet === "standard" }), h("option", { value: "roller", text: "Roller skates", selected: F.feet === "roller" }));
    var motor = h("select", { class: "input", "aria-label": "Motor", onchange: function () { F.motor = motor.value; paint(); } }, h("option", { value: "", text: "All motors" }));
    DB.motors.forEach(function (m) { motor.appendChild(h("option", { value: m.id, text: m.name, selected: F.motor === m.id })); });
    var cat = h("select", { class: "input", "aria-label": "Action category", onchange: function () { F.category = cat.value; paint(); } }, h("option", { value: "", text: "All action categories" }));
    ["Locomotion", "Posture", "Manipulation", "Tricks", "Skating"].forEach(function (c) { cat.appendChild(h("option", { value: c, text: c, selected: F.category === c })); });
    var sort = h("select", { class: "input", "aria-label": "Sort", onchange: function () { F.sort = sort.value; paint(); } },
      h("option", { value: "updated", text: "Last updated" }), h("option", { value: "name", text: "Name", selected: F.sort === "name" }));
    page.appendChild(h("div", { class: "toolbar" }, feet, motor, cat, sort));
    var meta = h("div", {});
    page.appendChild(meta);
    var grid = h("div", {});
    page.appendChild(grid);
    view.appendChild(page);

    function clearBotFilters() { App.state.botFilter = { q: "", feet: "", motor: "", category: "", sort: "updated" }; App.rerender(); }
    function paint() {
      grid.innerHTML = "";
      meta.innerHTML = "";
      var list = DB.bots.filter(function (b) {
        if (F.feet) {
          var opts = DB.platform(b.platform).feet || [];
          if (opts.indexOf(F.feet) < 0 && b.feet !== F.feet) return false;
        }
        if (F.motor && DB.botMotorIds(b).indexOf(F.motor) < 0) return false;
        if (F.category && softwareCats(b).indexOf(F.category) < 0) return false;
        return true;
      });
      list.sort(function (a, b) { return F.sort === "name" ? a.name.localeCompare(b.name) : (a.updated < b.updated ? 1 : -1); });
      var filtered = !!(F.feet || F.motor || F.category);
      meta.appendChild(UI.filterMeta(list.length, DB.bots.length, filtered, clearBotFilters, "robots"));
      if (!list.length) {
        grid.appendChild(UI.empty("No matching robots.", h("button", { class: "btn", onclick: clearBotFilters }, "Clear filters")));
        return;
      }
      var g = h("div", { class: "card-grid" });
      list.forEach(function (b) { g.appendChild(botCard(b)); });
      grid.appendChild(g);
    }
    paint();
  };

  function botPoster(b) {
    return UI.poster({ variant: DB.previewVariant(b), w: 376, h: 282, alt: b.name + " model poster" });
  }
  function botCard(b) {
    var cfgs = botConfigs(b);
    var cats = softwareCats(b);
    var actionNames = cfgs.map(function (c) { return DB.action(c.actionId).name; });
    var status = !DB.platform(b.platform).catalog ? "Motor catalog" : !cfgs.length ? "Configuration needed" : "Configured";
    var open = function () { App.go("#/gallery/bots/" + b.id); };
    var card = h("article", { class: "card", tabindex: "0", onclick: open, onkeydown: function (e) { if (e.key === "Enter") open(); } },
      botPoster(b),
      h("div", { class: "card-body" },
        h("div", { class: "card-title-row" }, h("div", { class: "card-title", text: b.name })),
        h("div", { class: "card-line" }, h("span", { class: "k", text: "Hardware" }), h("span", { text: hardwareLabel(b) })),
        h("div", { class: "card-line" }, h("span", { class: "k", text: "Software" }),
          cats.length ? h("span", { class: "tags", title: actionNames.join(", ") },
            cats.slice(0, 2).map(function (c) { return h("span", { class: "tag", text: c }); }),
            cats.length > 2 ? h("span", { class: "tag", text: "+" + (cats.length - 2) }) : null)
            : h("span", { class: "muted", text: DB.platform(b.platform).catalog ? "No configuration" : "No official templates" })),
        h("div", { class: "card-meta" }, feetSummary(b) + " · " + cfgs.length + " configuration" + (cfgs.length === 1 ? "" : "s")),
        h("div", { class: "card-foot" }, UI.badge(status, !cfgs.length ? "neutral" : "ok"),
          h("button", { class: "link-btn", onclick: function (e) { e.stopPropagation(); open(); } }, "Open"))
      ));
    return card;
  }

  function renameBot(b, after) {
    var inp = h("input", { class: "input", value: b.name });
    UI.modal({ title: "Rename bot", body: UI.field("Bot name", inp, { req: true }), actions: [{ label: "Cancel" }, { label: "Rename", kind: "primary", onClick: function () {
      var v = inp.value.trim();
      if (!v) { UI.toast("Bot name is required.", "err"); return true; }
      b.name = v; b.updated = DB.stamp(); UI.toast("Bot renamed.", "ok"); (after || App.rerender)();
    } }] });
  }
  function duplicateBot(b) {
    var copy = DB.clone(b);
    copy.id = "bot-" + (DB.state.nextBot++); copy.name = b.name + " copy"; copy.updated = DB.stamp(); copy.lastConfig = null; copy.archived = false;
    DB.bots.unshift(copy);
    UI.toast("Bot duplicated without configurations or runs.", "ok");
    App.rerender();
  }
  function archiveBot(b) {
    if (b.archived) { b.archived = false; UI.toast("Bot restored.", "ok"); App.rerender(); return; }
    var runs = DB.runs.filter(function (r) { return r.botId === b.id; }).length;
    var res = DB.results.filter(function (r) { return r.botId === b.id; }).length;
    UI.confirm("Archive " + b.name + "?", h("div", {},
      h("p", { text: "Archiving hides the bot from the showcase. Nothing is deleted." }),
      h("ul", { class: "plain-list" },
        h("li", { text: botConfigs(b).length + " configurations stay available (read-only)." }),
        h("li", { text: runs + " runs in ARENA keep their references." }),
        h("li", { text: res + " results in PLAYYARD stay available." }))),
      "Archive", function () { b.archived = true; UI.toast("Bot archived.", "ok"); App.rerender(); });
  }

  /* ============================ S-02 New bot ============================ */
  Pages.newBot = function (view, params) {
    App.title("GALLERY / New bot");
    var q = params.query || {};
    var D = App.state.newBotDraft || (App.state.newBotDraft = { name: "", color: "orange", feet: "standard", mode: "all", all: "mot-xl330-m6", groups: { "Left leg": "mot-xl330-m6", "Right leg": "mot-xl330-m6", "Head": "mot-xl330-m6" }, touched: false });
    if (q.motor && DB.motor(q.motor)) { UI.toast("Motor saved. Assign it to joints to apply the change."); App.state.pendingMotor = q.motor; }
    var viewerState = "Loading model";
    var checks = h("div", { class: "check-list" });

    var left = h("div", {});
    var viewer = UI.viewer(left, { label: "Model preview", variant: D.feet, color: D.color, size: "lg", reset: true, commands: true,
      onState: function (s) { viewerState = s; paintChecks(); },
      onModelError: function (shown) { D.feet = shown.variant; D.color = shown.color; if (typeof paintAppearance === "function") paintAppearance(); } });
    App.onLeave(viewer.destroy);

    var right = h("div", {});
    var nameErr = h("div", { class: "field-error" });
    var nameIn = h("input", { class: "input", value: D.name, placeholder: "e.g. Garden duck", oninput: function () { D.name = nameIn.value; D.touched = true; nameErr.textContent = ""; paintChecks(); } });
    right.appendChild(UI.section("Bot name", null, nameIn, nameErr));

    var appearance = h("div", {});
    right.appendChild(UI.section("Appearance", "Color changes only the accent materials the model exposes. Foot type loads a different model, collisions and passive wheel joints.", appearance));
    function paintAppearance() {
      appearance.innerHTML = "";
      appearance.appendChild(UI.field("Color", swatches(D.color, function (k) { D.color = k; D.touched = true; paintAppearance(); viewer.setModel({ color: k }); })));
      appearance.appendChild(UI.field("Foot type", segmented([["standard", "Standard feet"], ["roller", "Roller skates"]], D.feet, function (f) {
        if (f === D.feet) return;
        D.feet = f; D.touched = true; paintAppearance(); paintHardware(); viewer.setModel({ variant: f });
      }, "Foot type")));
      if (D.feet === "roller") appearance.appendChild(h("div", { class: "field-helper", text: "Passive wheels get no motor. The action space stays 14 actuated joints." }));
    }
    paintAppearance();

    var hw = h("div", {});
    right.appendChild(UI.section("Hardware", "Motor revision and joint assignment become the bot's hardware revision.", hw));
    function paintHardware() {
      hw.innerHTML = "";
      if (App.state.pendingMotor) {
        var pm = DB.motor(App.state.pendingMotor);
        hw.appendChild(UI.alert("info", h("div", {}, "New motor ", h("b", { text: pm.name }), " is available. ",
          h("button", { class: "link-btn", onclick: function () { if (D.mode === "all") D.all = pm.id; else Object.keys(D.groups).forEach(function (g) { D.groups[g] = pm.id; }); App.state.pendingMotor = null; paintHardware(); paintChecks(); } }, "Assign to all joints"),
          " · ", h("button", { class: "link-btn", onclick: function () { App.state.pendingMotor = null; paintHardware(); } }, "Not now"))));
      }
      hw.appendChild(UI.field("Assignment", segmented([["all", "All active joints"], ["groups", "By joint group"]], D.mode, function (m) { D.mode = m; paintHardware(); paintChecks(); }, "Assignment")));
      if (D.mode === "all") {
        var sel = motorOptions(D.all);
        sel.addEventListener("change", function () { D.all = sel.value; D.touched = true; paintChecks(); });
        hw.appendChild(UI.field("Motor", sel));
      } else {
        Object.keys(D.groups).forEach(function (g) {
          var s = motorOptions(D.groups[g]);
          s.addEventListener("change", function () { D.groups[g] = s.value; D.touched = true; paintChecks(); });
          hw.appendChild(UI.field(g, s));
        });
      }
      hw.appendChild(h("div", { class: "flex-between" },
        h("span", { class: "small muted", text: "14 active joints mapped · names from the MJCF actuator list" }),
        h("button", { class: "btn btn-sm", onclick: function () { App.guard = null; App.go("#/gallery/motors/new?return=new-bot"); } }, "New motor")));
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Joint"), UI.th("Motor"), UI.th("Direction"), UI.th("Zero offset"), UI.th("Position limits"), UI.th("Status"))));
      var tb = h("tbody", {});
      DB.joints.forEach(function (j) {
        var mid = D.mode === "all" ? D.all : D.groups[DB.jointGroup(j)];
        var m = DB.motor(mid);
        tb.appendChild(h("tr", {},
          h("td", {}, h("code", { text: j })),
          h("td", { text: m ? m.name : "—" }),
          h("td", { class: "muted", text: "From MJCF" }),
          h("td", { class: "muted", text: "From MJCF" }),
          h("td", { class: "muted", text: "From MJCF" }),
          h("td", {}, UI.badge(m && m.official ? "Compatible" : "Needs validation"))));
      });
      tbl.appendChild(tb);
      hw.appendChild(h("div", { class: "table-scroll mt12" }, tbl));
    }
    paintHardware();

    right.appendChild(UI.section("Model checks", null, checks));
    function motorIds() { return D.mode === "all" ? [D.all] : Object.keys(D.groups).map(function (g) { return D.groups[g]; }); }
    function paintChecks() {
      checks.innerHTML = "";
      var compiled = viewerState === "Ready" || viewerState === "Previous model shown";
      var custom = motorIds().some(function (id) { var m = DB.motor(id); return m && !m.official; });
      [
        [D.name.trim() ? "ok" : "fail", D.name.trim() ? "Bot name set" : "Bot name is required"],
        [compiled ? "ok" : viewerState === "Viewer unavailable" ? "warn" : "pending", compiled ? "Simulation model compiles (" + feetLabel(D.feet).toLowerCase() + ")" : viewerState === "Viewer unavailable" ? "Viewer unavailable — model not checked" : "Checking simulation model…"],
        ["ok", "Joint mapping complete (14 / 14 active joints)"],
        [custom ? "warn" : "ok", custom ? "Custom motor needs validation before training" : "Motor parameters complete (BAM m6 reference)"]
      ].forEach(function (c) {
        checks.appendChild(h("div", { class: "check-item check-" + c[0] }, h("span", { class: "check-icon", text: c[0] === "ok" ? "✓" : c[0] === "fail" ? "✕" : c[0] === "pending" ? "…" : "!" }), h("span", { text: c[1] })));
      });
      checks.appendChild(h("div", { class: "small muted mt8", text: compiled && !custom ? "Result: Model checked — not hardware validated. New bots start as Draft — configuration required." : "The bot can still be saved as Draft — configuration required." }));
    }
    paintChecks();

    App.guard = function () { return D.touched ? "This bot has not been created yet. Discard it?" : null; };
    App.onDiscard = function () { App.state.newBotDraft = null; App.state.pendingMotor = null; };

    var page = h("div", { class: "page page-wide" },
      pageHead("New bot", null, h("button", { class: "btn", onclick: function () { App.go("#/gallery"); } }, "Cancel")),
      h("div", { class: "grid-newbot" }, left, right),
      h("div", { class: "action-bar" }, h("span", { class: "save-state", text: "Unsaved bot" }),
        h("button", { class: "btn btn-primary", onclick: create }, "Create bot")));
    view.appendChild(page);

    function create() {
      if (!D.name.trim()) { nameErr.textContent = "Bot name is required."; nameIn.focus(); return; }
      var byJoint = {};
      var all = D.mode === "all" ? D.all : D.groups["Left leg"];
      if (D.mode === "groups") DB.joints.forEach(function (j) { var m = D.groups[DB.jointGroup(j)]; if (m !== all) byJoint[j] = m; });
      var bot = { id: "bot-" + (DB.state.nextBot++), name: D.name.trim(), description: "", color: D.color, feet: D.feet,
        motors: { all: all, byJoint: byJoint }, appearanceRev: 1, hardwareRev: 1, updated: DB.stamp(), archived: false, lastConfig: null };
      DB.bots.unshift(bot);
      App.state.newBotDraft = null;
      App.guard = null;
      UI.toast("Bot created — Draft, configuration required.", "ok");
      App.go("#/gallery/bots/" + bot.id);
    }
  };

  /* ============================ S-03 New motor ============================ */
  Pages.newMotor = function (view, params) {
    App.title("GALLERY / New motor");
    var q = params.query || {};
    var ret = q.return || "new-bot";
    var base = DB.motor("mot-xl330-m6");
    var M = { source: "duplicate", name: "", manufacturer: "", sku: "", iface: "", doc: "", license: "", notes: "", physical: {}, params: DB.clone(base.params), model: "m6", actuator: "xl330" };
    var touched = false;
    App.guard = function () { return touched ? "This motor has not been saved. Discard it?" : null; };

    var body = h("div", {});
    function returnHash(motorId, assign) {
      var suffix = assign ? "?motor=" + motorId : "";
      if (ret.indexOf("bot:") === 0) return "#/gallery/bots/" + ret.slice(4) + "?tab=hardware" + (assign ? "&motor=" + motorId : "");
      return "#/gallery/new" + suffix;
    }

    function paint() {
      body.innerHTML = "";
      body.appendChild(UI.section("Source", "Official motors are read-only. Saving here creates a custom revision; no other bot changes.",
        segmented([["duplicate", "Duplicate existing motor"], ["blank", "Blank motor"]], M.source, function (s) {
          M.source = s; touched = true;
          M.params = s === "duplicate" ? DB.clone(base.params) : DB.M6_PARAMS.reduce(function (o, p) { o[p.key] = null; return o; }, {});
          paint();
        }, "Source"),
        M.source === "duplicate" ? UI.alert("warn", "Copied from XL330 — not calibrated for this motor.") : null));

      function tIn(key, ph) {
        var i = h("input", { class: "input", value: M[key], placeholder: ph || "Not provided", oninput: function () { M[key] = i.value; touched = true; } });
        return i;
      }
      var nameIn = tIn("name", "e.g. Custom XL330 clone");
      body.appendChild(UI.section("Identity", null,
        h("div", { class: "form-row" }, UI.field("Name", nameIn, { req: true }), UI.field("Manufacturer", tIn("manufacturer"))),
        h("div", { class: "form-row" }, UI.field("Model / SKU", tIn("sku"), { helper: "Same family does not mean same SKU." }), UI.field("Interface / protocol", tIn("iface"))),
        h("div", { class: "form-row" }, UI.field("Documentation URL", tIn("doc")), UI.field("License / source", tIn("license"))),
        UI.field("Notes", tIn("notes"))));

      var phys = h("div", { class: "form-row-3" });
      DB.PHYSICAL_FIELDS.forEach(function (f) {
        var i = h("input", { class: "input", placeholder: "Not provided", inputmode: f.text ? "text" : "decimal", value: M.physical[f.key] != null ? String(M.physical[f.key]) : "",
          oninput: function () { touched = true; M.physical[f.key] = f.text ? (i.value || null) : UI.parseNum(i.value); i.classList.toggle("invalid", !f.text && M.physical[f.key] !== null && !isFinite(M.physical[f.key])); } });
        phys.appendChild(UI.field(f.label + (f.unit ? " (" + f.unit + ")" : ""), i));
      });
      body.appendChild(UI.section("Physical specifications", "Datasheet values. Missing values stay Not provided; the motor can be saved as a draft. Stall torque is not continuous torque.", phys));

      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Field"), UI.th("Label"), UI.th("Value"), UI.th("Unit"), UI.th("XL330 m6 reference", true))));
      var tb = h("tbody", {});
      DB.M6_PARAMS.forEach(function (p) {
        var v = M.params[p.key];
        var inp = h("input", { class: "input input-num", inputmode: "decimal", value: v == null ? "" : String(v), placeholder: "Not provided", "aria-label": p.label,
          oninput: function () { touched = true; M.params[p.key] = UI.parseNum(inp.value); inp.classList.toggle("invalid", !!motorError(p.key, M.params[p.key])); } });
        tb.appendChild(h("tr", {},
          h("td", {}, h("code", { text: p.key })),
          h("td", {}, p.label, p.pending ? h("div", {}, UI.badge("Applicability pending")) : null),
          h("td", {}, inp),
          h("td", { class: "muted", text: p.unit }),
          h("td", { class: "num muted", title: String(p.value), text: UI.fmtValue(p.value) })));
      });
      var modelSel = h("select", { class: "input", onchange: function () { M.model = modelSel.value; } }, h("option", { value: "m6", text: "m6" }));
      var actSel = h("select", { class: "input", onchange: function () { M.actuator = actSel.value; } }, h("option", { value: "xl330", text: "xl330 (registered backend)" }));
      tbl.appendChild(tb);
      body.appendChild(UI.section("Actuator model", "All 15 numeric keys from the locked BAM m6 file (" + DB.SOURCES.bamRev.slice(0, 7) + "). These are model-identification values, not nameplate ratings. Units follow the locked model schema; the JSON file itself carries none.",
        h("div", { class: "form-row" }, UI.field("Model family (model)", modelSel), UI.field("Actuator backend (actuator)", actSel)),
        h("div", { class: "table-wrap" }, tbl),
        h("div", { class: "small muted mt8", text: "q_offset is an identification offset — it is not written to the joint zero offset. Display uses 6 significant digits; stored values keep full precision." })));

      var s = base.sim;
      body.appendChild(UI.section("Simulation actuator preset", "From the locked training code. Kept separate from the M6 parameters and from hardware ratings.",
        h("div", { class: "prop-grid" },
          UI.prop("kp_fw", String(s.kp_fw) + " (firmware encoding)"),
          UI.prop("vin_range", s.vin_range.join(" – ") + " V"),
          UI.prop("vin_drop_gain_range", s.vin_drop_gain_range.join(" – ") + " V/N·m"),
          UI.prop("vin_min", s.vin_min + " V"),
          UI.prop("delay lag", s.delay_min_lag + " – " + s.delay_max_lag + " sim steps")),
        UI.alert("warn", "Simulation parameters are not hardware voltage recommendations. The XL330-M288-T manual lists 3.7–6.0 V input; the simulation preset is higher. Requires review before any physical use.")));
    }
    function motorError(key, v) {
      if (v == null) return null;
      if (!isFinite(v)) return "not a finite number";
      if ((key === "R" || key === "kt") && !(v > 0)) return "must be > 0";
      if ((key === "armature" || key.indexOf("friction") >= 0 || key === "alpha" || key === "dtheta_stribeck") && v < 0) return "must be ≥ 0";
      return null;
    }
    paint();

    function save(assign) {
      if (!M.name.trim()) { UI.toast("Motor name is required.", "err"); return; }
      var bad = DB.M6_PARAMS.filter(function (p) { return motorError(p.key, M.params[p.key]); });
      if (bad.length) { UI.toast(bad[0].label + ": " + motorError(bad[0].key, M.params[bad[0].key]) + ".", "err"); return; }
      var m = { id: "mot-custom-" + (DB.state.nextMotor++), official: false, revision: 1, name: M.name.trim(), family: M.name.trim(),
        manufacturer: M.manufacturer || null, sku: M.sku || null, interface: M.iface || null, docUrl: M.doc || null, license: M.license || null, notes: M.notes,
        physical: M.physical, params: M.params, model: M.model, actuator: M.actuator, sim: DB.clone(base.sim),
        validation: "Needs validation", copiedFrom: M.source === "duplicate" ? base.id : null };
      DB.motors.push(m);
      touched = false; App.guard = null;
      UI.toast("Motor saved. Assign it to joints to apply the change.", "ok");
      App.go(returnHash(m.id, assign));
    }

    view.appendChild(h("div", { class: "page" },
      pageHead("New motor", "Motor definitions are versioned. Changing a bot's motor creates a new hardware revision; existing runs keep their snapshot."),
      body,
      h("div", { class: "action-bar" }, h("span", { class: "save-state", text: "Unsaved motor" }),
        h("div", { class: "flex" },
          h("button", { class: "btn", onclick: function () { App.go(returnHash(null, false)); } }, "Cancel"),
          h("button", { class: "btn", onclick: function () { save(false); } }, "Save motor"),
          h("button", { class: "btn btn-primary", onclick: function () { save(true); } }, "Save and assign")))));
  };

  /* ============================ S-04 Bot detail ============================ */
  Pages.botDetail = function (view, params) {
    var bot = DB.bot(params.id);
    if (!bot) { App.go("#/gallery"); return; }
    var q = params.query || {};
    var tab = q.tab || "configuration";
    if (tab === "appearance") tab = "configuration";
    App.title("GALLERY / " + bot.name);
    var sel = (App.state.sel = App.state.sel || {})[bot.id] || (App.state.sel[bot.id] = {});
    if (q.cfg && DB.config(q.cfg)) { sel.configId = q.cfg; sel.actionId = DB.config(q.cfg).actionId; sel.version = q.v ? +q.v : null; }
    if (q.action) { sel.actionId = q.action; sel.configId = null; }
    if (!sel.actionId && DB.platform(bot.platform).catalog) {
      var last = bot.lastConfig && DB.config(bot.lastConfig);
      if (last && !last.archived) { sel.actionId = last.actionId; sel.configId = last.id; }
      else { var first = botConfigs(bot)[0]; sel.actionId = first ? first.actionId : DB.actions[0].id; sel.configId = first ? first.id : null; }
    }

    var cfgs = botConfigs(bot);
    var ready = cfgs.filter(function (c) { return versionStatus(c, DB.latestVersion(c).v, bot) === "Ready to run"; }).length;
    var headActions = h("div", { class: "page-actions" });
    var page = h("div", { class: "page page-wide" },
      h("div", { class: "page-head" },
        h("div", {},
          h("h1", { class: "page-title", text: bot.name }),
          h("div", { class: "page-sub" }, feetSummary(bot) + " · Hardware revision " + bot.hardwareRev + " · ",
            DB.platform(bot.platform).catalog
              ? (cfgs.length ? cfgs.length + " configurations, " + ready + " ready to run" : "Configuration required")
              : "Select a motor on Hardware. No official training templates in this workspace.")),
        headActions),
      UI.tabs([["configuration", "Configuration"], ["hardware", "Hardware"], ["versions", "Versions"]], tab, function (t) {
        App.go("#/gallery/bots/" + bot.id + "?tab=" + t);
      }));
    view.appendChild(page);

    if (tab === "hardware") hardwareTab(page, bot, q);
    else if (tab === "versions") versionsTab(page, bot);
    else configurationTab(page, bot, sel, headActions);
  };

  /* ---------------- Configuration workbench ---------------- */
  function configurationTab(page, bot, sel, headActions) {
    if (!DB.platform(bot.platform).catalog) {
      var host = h("div", {});
      modelHost(host, bot, { sub: [DB.platform(bot.platform).summary] });
      page.appendChild(host);
      page.appendChild(UI.empty(bot.name + " has no official policy templates in this workspace. Choose its motors on the Hardware tab."));
      return;
    }
    var cfg = sel.configId ? DB.config(sel.configId) : null;
    if (cfg && (cfg.actionId !== sel.actionId || cfg.archived)) cfg = null;
    var actionCfgs = botConfigs(bot).filter(function (c) { return c.actionId === sel.actionId; });
    if (!cfg && actionCfgs.length) { cfg = actionCfgs[actionCfgs.length - 1]; sel.configId = cfg.id; }
    if (cfg) bot.lastConfig = cfg.id;
    var action = DB.action(sel.actionId);
    var schema = cfg ? DB.schemaFor(cfg.actionId, cfg.source) : null;
    var baseVersion = cfg ? (sel.version && DB.configVersion(cfg, sel.version)) || DB.latestVersion(cfg) : null;
    var undoStack = null;

    var saveBtn = h("button", { class: "btn btn-primary", onclick: saveVersion }, "Save version");
    var trainBtn = h("button", { class: "btn", onclick: trainInArena }, "Train in Arena");
    headActions.insertBefore(trainBtn, headActions.firstChild);
    headActions.insertBefore(saveBtn, headActions.firstChild);

    /* top: viewer + selector */
    var viewerBox = h("div", {});
    var viewer = modelHost(viewerBox, bot, { sub: ["No policy loaded — current model only"] });
    App.onLeave(viewer.destroy);

    var rail = h("div", { class: "rail" });
    var top = h("div", { class: "two-col" }, viewerBox, rail);
    page.appendChild(top);

    /* bottom: actions list + parameters */
    var actionsList = h("div", { class: "action-list", role: "listbox", "aria-label": "Actions" });
    var paramsPane = h("div", { class: "params-pane" });
    var trainableCount = botConfigs(bot).filter(function (c) { return versionStatus(c, DB.latestVersion(c).v, bot) === "Ready to run"; }).length;
    page.appendChild(h("div", { class: "section section-flush" },
      h("div", { class: "section-head-row pad" },
        h("div", {}, h("div", { class: "section-title", text: "Actions" }),
          h("div", { class: "section-desc", text: "All official actions (" + DB.actions.length + ") · Trainable configurations (" + trainableCount + "). One configuration trains one action." })),
        h("button", { class: "btn btn-sm", onclick: function () { App.go("#/gallery/bots/" + bot.id + "/new-config?action=" + sel.actionId); } }, "New configuration")),
      h("div", { class: "workbench" }, actionsList, paramsPane)));

    DB.actions.forEach(function (a) {
      var n = botConfigs(bot).filter(function (c) { return c.actionId === a.id; }).length;
      var needsRoller = a.feet === "roller" && bot.feet !== "roller";
      actionsList.appendChild(h("button", {
        class: "action-item" + (a.id === sel.actionId ? " active" : ""), role: "option", "aria-selected": a.id === sel.actionId ? "true" : "false",
        onclick: function () {
          if (a.id === sel.actionId) return;
          var go = function () { if (cfg) cfg.draft = null; sel.actionId = a.id; sel.configId = null; sel.version = null; App.rerender(); };
          if (cfg && cfg.draft) UI.modal({ title: "Unsaved changes", body: h("p", { text: "Changes to " + cfg.name + " are not saved. Discard them?" }), actions: [{ label: "Keep editing" }, { label: "Discard", kind: "danger", onClick: go }] });
          else go();
        }
      }, h("span", { class: "ai-name", text: a.name }),
        h("span", { class: "ai-meta" }, a.category + " · ", needsRoller ? "Requires roller skates" : n ? "Configured" + (n > 1 ? " (" + n + ")" : "") : "New configuration")));
    });

    function values() { return cfg.draft || baseVersion.values; }
    function editable() { if (!cfg.draft) cfg.draft = DB.clone(baseVersion.values); return cfg.draft; }

    function paintRail() {
      rail.innerHTML = "";
      if (!cfg) {
        rail.appendChild(h("div", { class: "rail-card" },
          h("div", { class: "rail-title", text: action.name }),
          h("div", { class: "small muted mb8", text: "No configuration yet. Add an official template or start from scratch." }),
          action.feet === "roller" && bot.feet !== "roller" ? UI.alert("warn", "Requires roller skates.") : null,
          h("button", { class: "btn btn-primary", onclick: function () { App.go("#/gallery/bots/" + bot.id + "/new-config?action=" + action.id); } }, "New configuration")));
        return;
      }
      var list = actionCfgs;
      var cfgSel = h("select", { class: "input", "aria-label": "Configuration", onchange: function () {
        var go = function () { cfg.draft = null; sel.configId = cfgSel.value; sel.version = null; App.rerender(); };
        if (cfg.draft) UI.modal({ title: "Unsaved changes", body: h("p", { text: "Discard unsaved changes to " + cfg.name + "?" }), actions: [{ label: "Keep editing", onClick: function () { cfgSel.value = cfg.id; } }, { label: "Discard", kind: "danger", onClick: go }] });
        else go();
      } });
      list.forEach(function (c) { cfgSel.appendChild(h("option", { value: c.id, selected: c.id === cfg.id, text: c.name })); });
      var verSel = h("select", { class: "input", "aria-label": "Version", onchange: function () {
        if (cfg.draft) { UI.toast("Save or discard the draft before switching versions.", "err"); verSel.value = baseVersion.v; return; }
        sel.version = +verSel.value; App.rerender();
      } });
      cfg.versions.forEach(function (v) { verSel.appendChild(h("option", { value: v.v, selected: v.v === baseVersion.v, text: "Version " + v.v + (v.v === DB.latestVersion(cfg).v ? " (latest)" : "") })); });
      var result = DB.validate(cfg, values(), bot);
      var used = runsUsing(cfg.id, baseVersion.v);
      rail.appendChild(h("div", { class: "rail-card" },
        h("div", { class: "rail-title", text: "Configuration" }),
        UI.field(null, cfgSel), UI.field(null, verSel),
        UI.kv("Action", action.name),
        UI.kv("Source", cfg.source === "official" ? "Official policy template" : "From scratch"),
        cfg.source === "official" ? UI.kv("Template", action.file) : null,
        UI.kv("Saved", baseVersion.savedAt),
        UI.kv("Modified parameters", String(modifiedKeys(values()).length)),
        UI.kv("Status", h("span", { id: "cfg-status" }, UI.badge(cfg.draft ? "Draft" : result.status))),
        cfg.draft ? h("div", { class: "small warn-text mt8", text: "Unsaved changes — Save version to use them in ARENA." }) : null,
        used.length ? h("div", { class: "small muted mt8", text: "Version " + baseVersion.v + " is used by " + used.length + " run" + (used.length > 1 ? "s" : "") + ". Edits are saved as a new version; existing runs are not changed." }) : null));
      var issues = h("div", { class: "rail-card", id: "cfg-issues" });
      rail.appendChild(issues);
      paintIssues(result);
    }
    function paintIssues(result) {
      var box = document.getElementById("cfg-issues");
      if (!box) return;
      box.innerHTML = "";
      box.appendChild(h("div", { class: "rail-title", text: "Checks" }));
      if (!result.issues.length) box.appendChild(h("div", { class: "check-item check-ok" }, h("span", { class: "check-icon", text: "✓" }), h("span", { text: "Platform checks passed. Ready to run does not mean hardware validated." })));
      result.issues.forEach(function (i) { box.appendChild(h("div", { class: "check-item check-fail" }, h("span", { class: "check-icon", text: "✕" }), h("span", { text: i.msg }))); });
    }

    function modifiedKeys(vals) {
      return Object.keys(cfg.baseline).filter(function (k) { return JSON.stringify(vals[k]) !== JSON.stringify(cfg.baseline[k]); });
    }

    function refreshState() {
      var result = DB.validate(cfg, values(), bot);
      var st = document.getElementById("cfg-status");
      if (st) { st.innerHTML = ""; st.appendChild(UI.badge(cfg.draft ? "Draft" : result.status)); }
      paintIssues(result);
      saveBtn.disabled = !cfg.draft;
      trainBtn.disabled = !!cfg.draft || result.status !== "Ready to run";
      trainBtn.title = cfg.draft ? "Save version first" : result.status !== "Ready to run" ? "Configuration is " + result.status : "";
      retrainNote.style.display = cfg.draft ? "" : "none";
    }

    var retrainNote = UI.alert("info", "Changing rewards or training values requires a new training run. Runtime values only change how the existing policy is executed.");

    function paintParams() {
      paramsPane.innerHTML = "";
      if (!cfg) {
        paramsPane.appendChild(UI.empty(action.feet === "roller" && bot.feet !== "roller" ? "Requires roller skates. You can still create a configuration; training stays disabled." : "No configuration for " + action.name + " yet.",
          h("button", { class: "btn btn-primary", onclick: function () { App.go("#/gallery/bots/" + bot.id + "/new-config?action=" + action.id); } }, "New configuration")));
        saveBtn.disabled = true; trainBtn.disabled = true;
        return;
      }
      paramsPane.appendChild(h("div", { class: "params-head" },
        h("div", {}, h("div", { class: "strong", text: cfg.name }),
          h("div", { class: "small muted", text: (cfg.source === "official" ? "Official template " + action.file + " · manifest @ " + cfg.templateRev.slice(0, 7) : "From scratch · Platform starter preset") + (action.task ? " · Task preset " + action.task : " · No official task recipe") })),
        h("div", { class: "flex" },
          h("button", { class: "btn btn-sm", onclick: restoreAll }, "Restore defaults"),
          h("button", { class: "btn btn-sm", onclick: function () { UI.toast("Model preview only — no policy is loaded, so parameter changes are not animated. Changing rewards requires a new training run."); } }, "Preview changes"))));
      if (action.note) paramsPane.appendChild(h("div", { class: "small muted mb8", text: action.note }));
      paramsPane.appendChild(retrainNote);
      var undoBar = h("div", { id: "undo-bar" });
      paramsPane.appendChild(undoBar);
      schema.groups.forEach(function (g, gi) {
        if (g.id === "targets" && !g.params.length) return;
        paramsPane.appendChild(groupFold(g, gi === 0 || g.id === "training"));
        if (g.id === "targets") {
          paramsPane.appendChild(rewardsFold());
          if (schema.curriculum.length) paramsPane.appendChild(curriculumFold());
        }
      });
      refreshState();
    }

    function sourceTag(src, modified) {
      return h("span", { class: "src-tag" + (modified ? " mod" : "") }, modified ? "User override" : src);
    }
    function groupFold(g, open) {
      var d = h("details", { class: "fold" }, h("summary", {}, g.name, h("span", { class: "fold-count", text: g.params.length ? String(g.params.length) : "" })));
      if (open) d.open = true;
      var b = h("div", { class: "fold-body" });
      if (g.note) b.appendChild(h("div", { class: "small muted mb8", text: g.note }));
      if (!g.params.length) { b.appendChild(h("div", { class: "small muted", text: "Not provided." })); d.appendChild(b); return d; }
      var tbl = h("table", { class: "tbl tbl-static tbl-params" }, h("thead", {}, h("tr", {}, UI.th("Parameter"), UI.th("Value"), UI.th("Unit"), UI.th("Default"), UI.th("Source"), UI.th(""))));
      var tb = h("tbody", {});
      g.params.forEach(function (p) { tb.appendChild(paramRow(p)); });
      tbl.appendChild(tb);
      b.appendChild(h("div", { class: "table-scroll" }, tbl));
      b.appendChild(h("div", { class: "fold-actions" }, h("button", { class: "btn btn-sm btn-ghost", onclick: function () { restoreKeys(g.params.map(function (p) { return p.key; }), g.name + " section"); } }, "Restore section")));
      d.appendChild(b);
      return d;
    }

    function paramRow(p) {
      var tr = h("tr", {});
      var v = values()[p.key];
      var mod = JSON.stringify(v) !== JSON.stringify(cfg.baseline[p.key]);
      tr.classList.toggle("modified", mod);
      var valueCell = h("td", {}, paramInput(p, v, function (nv) {
        var d = editable(); d[p.key] = nv;
        if (p.key === "period_s" || p.key === "end_phase") {
          if (isFinite(d.period_s) && isFinite(d.end_phase)) d.duration_s = +(d.period_s * d.end_phase).toFixed(6);
          var dc = document.getElementById("computed-duration"); if (dc) dc.textContent = d.duration_s == null ? "—" : UI.fmtValue(d.duration_s);
        }
        var m2 = JSON.stringify(nv) !== JSON.stringify(cfg.baseline[p.key]);
        tr.classList.toggle("modified", m2);
        srcCell.innerHTML = ""; srcCell.appendChild(sourceTag(p.src, m2));
        refreshState();
      }));
      var srcCell = h("td", {}, sourceTag(p.src, mod));
      tr.appendChild(h("td", {}, h("div", { class: "p-label", text: p.label }), h("div", { class: "p-key", text: p.key }),
        p.help ? h("div", { class: "p-help", text: p.help }) : null,
        p.warn ? h("div", { class: "p-warn", text: p.warn }) : null));
      tr.appendChild(valueCell);
      tr.appendChild(h("td", { class: "muted", text: p.unit || "—" }));
      tr.appendChild(h("td", { class: "muted", text: fmtAny(cfg.baseline[p.key]) || "Not provided" }));
      tr.appendChild(srcCell);
      tr.appendChild(h("td", {}, p.readonly ? null : h("button", { class: "btn btn-sm btn-ghost", title: "Reset to default", onclick: function () { restoreKeys([p.key], p.label); } }, "Reset")));
      return tr;
    }

    function fmtAny(v) {
      if (v == null) return "";
      if (Array.isArray(v)) return v.map(UI.fmtValue).join(" – ");
      return UI.fmtValue(v);
    }

    function numInput(v, onVal, label) {
      var i = h("input", { class: "input input-num", inputmode: "decimal", value: v == null ? "" : String(v), placeholder: "Not provided", "aria-label": label });
      i.addEventListener("input", function () {
        var n = UI.parseNum(i.value);
        i.classList.toggle("invalid", n !== null && !isFinite(n));
        onVal(n !== null && !isFinite(n) ? NaN : n);
      });
      return i;
    }
    function paramInput(p, v, onChange) {
      if (p.computed) {
        return h("div", { class: "flex" }, h("span", { id: "computed-duration", class: "num-text", text: v == null ? "—" : UI.fmtValue(v) }),
          h("button", { class: "btn btn-sm btn-ghost", onclick: function () { editDuration(p); } }, "Edit duration"));
      }
      if (p.readonly) return h("span", { class: "num-text", text: fmtAny(v) || "Not provided" });
      if (p.type === "number" || p.type === "int") return numInput(v, onChange, p.label);
      if (p.type === "range") {
        var cur = Array.isArray(v) ? v.slice() : [null, null];
        return h("div", { class: "pair" },
          numInput(cur[0], function (n) { cur[0] = n; onChange(cur[0] == null && cur[1] == null ? null : cur.slice()); }, p.label + " min"),
          h("span", { class: "muted", text: "to" }),
          numInput(cur[1], function (n) { cur[1] = n; onChange(cur[0] == null && cur[1] == null ? null : cur.slice()); }, p.label + " max"));
      }
      if (p.type === "vec3") {
        var vec = Array.isArray(v) ? v.slice() : [null, null, null];
        return h("div", { class: "pair" }, ["X", "Y", "Z"].map(function (ax, i) {
          return numInput(vec[i], function (n) { vec[i] = n; onChange(vec.slice()); }, p.label + " " + ax);
        }));
      }
      if (p.type === "bool") {
        var chk = h("input", { type: "checkbox", checked: !!v });
        chk.addEventListener("change", function () { onChange(chk.checked); });
        return h("label", { class: "toggle" }, chk, h("span", { class: "tk" }), h("span", { class: "tl", text: chk.checked ? "On" : "Off" }));
      }
      if (p.type === "enum") {
        var s = h("select", { class: "input", "aria-label": p.label });
        if (p.def == null) s.appendChild(h("option", { value: "", text: "Not provided" }));
        p.options.forEach(function (o) { s.appendChild(h("option", { value: o, selected: o === v, text: o })); });
        s.addEventListener("change", function () { onChange(s.value || null); });
        return s;
      }
      var t = h("input", { class: "input", value: v == null ? "" : String(v), placeholder: "Not provided", "aria-label": p.label });
      t.addEventListener("input", function () { onChange(t.value.trim() === "" ? null : t.value); });
      return t;
    }

    function editDuration(p) {
      var vals = values();
      var inp = h("input", { class: "input input-num", inputmode: "decimal", value: String(vals.duration_s) });
      UI.modal({
        title: "Edit duration", body: h("div", {},
          UI.field("Duration (s)", inp, { helper: "Duration = Command period × End phase. Editing it recomputes End phase; the period stays " + UI.fmtValue(vals.period_s) + " s." })),
        actions: [{ label: "Cancel" }, { label: "Update end phase", kind: "primary", onClick: function () {
          var d = UI.parseNum(inp.value);
          if (!(d > 0) || !(vals.period_s > 0)) { UI.toast("Duration and period must be greater than 0.", "err"); return true; }
          var ep = +(d / vals.period_s).toFixed(6);
          if (ep > 1) { UI.toast("End phase would be " + ep + " (> 1). Choose a shorter duration or change the period.", "err"); return true; }
          var dd = editable(); dd.end_phase = ep; dd.duration_s = +(vals.period_s * ep).toFixed(6);
          UI.toast("End phase changed to " + UI.fmtValue(ep) + ".", "ok");
          paintParams();
        } }]
      });
    }

    function rewardsFold() {
      var d = h("details", { class: "fold", open: true }, h("summary", {}, "Rewards", h("span", { class: "fold-count", text: String(schema.rewards.length) })));
      var b = h("div", { class: "fold-body" });
      b.appendChild(h("div", { class: "small muted mb8", text: "Edited only here. ARENA shows a read-only snapshot of the saved version when a run is created." }));
      var tbl = h("table", { class: "tbl tbl-static tbl-params" }, h("thead", {}, h("tr", {}, UI.th("Reward term"), UI.th("Weight"), UI.th("Default"), UI.th("Source"), UI.th(""))));
      var tb = h("tbody", {});
      var curTerms = schema.curriculum.map(function (c) { return c.term; });
      schema.rewards.forEach(function (r) {
        var key = "rw:" + r.term;
        var mod = values()[key] !== cfg.baseline[key];
        var srcCell = h("td", {}, sourceTag(r.src, mod));
        var tr = h("tr", { class: mod ? "modified" : "" },
          h("td", {}, h("div", { class: "p-label", text: r.term }),
            values()[key] === 0 ? h("div", { class: "p-help", text: "Weight 0 — disabled, still listed." }) : null,
            curTerms.indexOf(r.term) >= 0 ? h("div", { class: "p-warn", text: "Active curriculum: this initial weight is overridden during training." }) : null),
          h("td", {}, numInput(values()[key], function (n) {
            editable()[key] = n; var m2 = n !== cfg.baseline[key]; tr.classList.toggle("modified", m2);
            srcCell.innerHTML = ""; srcCell.appendChild(sourceTag(r.src, m2)); refreshState();
          }, r.term + " weight")),
          h("td", { class: "muted", text: UI.fmtValue(cfg.baseline[key]) }),
          srcCell,
          h("td", {}, h("button", { class: "btn btn-sm btn-ghost", onclick: function () { restoreKeys([key].concat(r.params.map(function (rp) { return key + ":" + rp.key; })), r.term); } }, "Reset")));
        tb.appendChild(tr);
        r.params.forEach(function (rp) {
          var pk = key + ":" + rp.key;
          var ptr = h("tr", { class: "sub-row" + (values()[pk] !== cfg.baseline[pk] ? " modified" : "") },
            h("td", {}, h("div", { class: "p-label", text: "↳ " + rp.label }), h("div", { class: "p-key", text: rp.key + (rp.unit ? " · " + rp.unit : "") })),
            h("td", {}, numInput(values()[pk], function (n) { editable()[pk] = n; ptr.classList.toggle("modified", n !== cfg.baseline[pk]); refreshState(); }, rp.label)),
            h("td", { class: "muted", text: UI.fmtValue(cfg.baseline[pk]) }), h("td", {}), h("td", {}));
          tb.appendChild(ptr);
        });
      });
      tbl.appendChild(tb);
      b.appendChild(h("div", { class: "table-scroll" }, tbl));
      b.appendChild(h("div", { class: "fold-actions" }, h("button", { class: "btn btn-sm btn-ghost", onclick: function () { restoreKeys(Object.keys(cfg.baseline).filter(function (k) { return k.indexOf("rw:") === 0; }), "Rewards section"); } }, "Restore section")));
      d.appendChild(b);
      return d;
    }

    function curriculumFold() {
      var b = h("div", {});
      b.appendChild(h("div", { class: "small muted mb8", text: "Configured rules only. Effective runtime values appear only when a run reports curriculum telemetry." }));
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Term"), UI.th("Initial"), UI.th("Final"), UI.th("Rule"), UI.th("Effective at runtime"))));
      var tb = h("tbody", {});
      schema.curriculum.forEach(function (c) {
        var key = "cur:" + c.term;
        tb.appendChild(h("tr", {},
          h("td", { class: "p-label", text: c.term }),
          h("td", { class: "muted", text: values()["rw:" + c.term] != null ? UI.fmtValue(values()["rw:" + c.term]) : "Stage rules" }),
          h("td", {}, c.final == null ? h("span", { class: "muted", text: "Stage rules" }) : numInput(values()[key], function (n) { editable()[key] = n; refreshState(); }, c.term + " final")),
          h("td", { class: "small", text: c.rule }),
          h("td", { class: "muted", text: "Not reported" })));
      });
      tbl.appendChild(tb);
      b.appendChild(h("div", { class: "table-scroll" }, tbl));
      return UI.fold("Curriculum", false, b);
    }

    function restoreKeys(keys, label) {
      var vals = values();
      var changed = keys.filter(function (k) { return JSON.stringify(vals[k]) !== JSON.stringify(cfg.baseline[k]); });
      if (!changed.length) { UI.toast("Already at default values."); return; }
      var apply = function () {
        var d = editable();
        var before = {};
        changed.forEach(function (k) { before[k] = DB.clone(d[k]); d[k] = DB.clone(cfg.baseline[k]); });
        if (changed.indexOf("period_s") >= 0 || changed.indexOf("end_phase") >= 0) d.duration_s = cfg.baseline.duration_s;
        undoStack = before;
        paintParams();
        showUndo(changed.length);
      };
      if (changed.length === 1 && keys.length === 1) apply();
      else UI.confirm("Restore defaults", h("div", {},
        h("p", { text: "Restore " + changed.length + " changed value" + (changed.length > 1 ? "s" : "") + " in " + label + " for " + action.name + "?" }),
        h("ul", { class: "plain-list small" }, changed.slice(0, 12).map(function (k) { return h("li", { text: k + ": " + fmtAny(vals[k]) + " → " + (fmtAny(cfg.baseline[k]) || "Not provided") }); })),
        h("p", { class: "small muted", text: "Only this configuration draft changes. Other actions, hardware, saved versions and runs are not affected." })), "Restore", apply);
    }
    function restoreAll() {
      var vals = values();
      var changed = Object.keys(cfg.baseline).filter(function (k) { return JSON.stringify(vals[k]) !== JSON.stringify(cfg.baseline[k]); });
      if (!changed.length) { UI.toast("Already at default values."); return; }
      UI.confirm("Restore defaults for this action only?", h("div", {},
        h("p", { text: "Restore " + changed.length + " changed value" + (changed.length > 1 ? "s" : "") + " for " + action.name + "?" }),
        h("p", { class: "small muted", text: "Baseline: " + (cfg.source === "official" ? "manifest revision " + cfg.templateRev.slice(0, 7) + " and its task preset, locked when the configuration was created." : "the Platform starter preset locked when the configuration was created.") + " Other actions, hardware, appearance, run history and authorizations are not changed." })),
        "Restore", function () {
          var d = editable(), before = {};
          changed.forEach(function (k) { before[k] = DB.clone(d[k]); d[k] = DB.clone(cfg.baseline[k]); });
          undoStack = before; paintParams(); showUndo(changed.length);
        });
    }
    function showUndo(n) {
      var bar = document.getElementById("undo-bar");
      if (!bar) return;
      bar.innerHTML = "";
      bar.appendChild(UI.alert("info", h("div", { class: "flex-between" }, h("span", { text: n + " value" + (n > 1 ? "s" : "") + " restored in the draft." }),
        h("button", { class: "btn btn-sm", onclick: function () {
          var d = editable(); Object.keys(undoStack || {}).forEach(function (k) { d[k] = undoStack[k]; });
          undoStack = null; paintParams(); UI.toast("Restore undone.", "ok");
        } }, "Undo"))));
    }

    function saveVersion() {
      if (!cfg || !cfg.draft) return;
      var result = DB.validate(cfg, cfg.draft, bot);
      var nonFinite = result.issues.filter(function (i) { return /finite|integer|≥|≤|greater|Min must/.test(i.msg); });
      if (nonFinite.length) { UI.toast("Fix invalid values before saving: " + nonFinite[0].msg, "err"); return; }
      var v = { v: DB.latestVersion(cfg).v + 1, savedAt: DB.stamp(), values: cfg.draft, note: "Edited in Gallery" };
      cfg.versions.push(v);
      cfg.draft = null;
      sel.version = null;
      bot.updated = DB.stamp();
      UI.toast("Version " + v.v + " saved — " + result.status + ".", "ok");
      App.rerender();
    }
    function trainInArena() {
      if (!cfg || cfg.draft) return;
      App.go("#/arena/new?bot=" + bot.id + "&config=" + cfg.id + "&v=" + baseVersion.v);
    }

    App.guard = function () { return cfg && cfg.draft ? "Changes to " + cfg.name + " are not saved. Discard them?" : null; };
    App.onDiscard = function () { if (cfg) cfg.draft = null; };

    paintRail();
    paintParams();
  }

  /* ---------------- Hardware tab ---------------- */
  function hardwareTab(page, bot, q) {
    var H = { feet: bot.feet, mode: Object.keys(bot.motors.byJoint).length ? "joint" : "all", all: bot.motors.all, byJoint: DB.clone(bot.motors.byJoint) };
    if (q.motor && DB.motor(q.motor)) { H.all = q.motor; H.mode = "all"; }
    var left = h("div", {});
    var viewer = modelHost(left, bot, { variant: H.feet, onModelError: function (m) { H.feet = m.variant; paint(); } });
    App.onLeave(viewer.destroy);
    var right = h("div", {});
    page.appendChild(h("div", { class: "two-col" }, left, right));
    var tableBox = h("div", {});
    page.appendChild(tableBox);

    function joints() { return DB.jointsOf(bot); }
    function motorFor(j) { return H.mode === "all" ? H.all : (H.byJoint[j.name] || H.all); }
    function dirty() { return H.feet !== bot.feet || JSON.stringify(currentMap()) !== JSON.stringify(savedMap()); }
    function currentMap() { var o = {}; joints().forEach(function (j) { if (j.selectable !== false) o[j.name] = motorFor(j); }); return o; }
    function savedMap() { var o = {}; joints().forEach(function (j) { if (j.selectable !== false) o[j.name] = bot.motors.byJoint[j.name] || bot.motors.all; }); return o; }

    function paint() {
      right.innerHTML = "";
      var ids = {}; joints().forEach(function (j) { if (j.selectable !== false) ids[motorFor(j)] = true; });
      var m0 = DB.motor(Object.keys(ids)[0]);
      var active = joints().filter(function (j) { return j.selectable !== false; }).length;
      right.appendChild(UI.section("Current hardware", DB.platform(bot.platform).summary,
        UI.kv("Hardware revision", String(bot.hardwareRev)),
        UI.kv("Motor", Object.keys(ids).length > 1 ? "Mixed motors (" + Object.keys(ids).length + " types)" : (m0 ? m0.name : "—")),
        UI.kv("Source", DB.platform(bot.platform).repo),
        UI.kv("Active joints", String(active) + " mapped"),
        H.feet === "roller" ? h("div", { class: "small muted mt8", text: "Passive wheels are not assigned motors." }) : null));
      if (DB.platform(bot.platform).feet.length > 1) {
        right.appendChild(UI.section("Foot type", "Loads a different model, collisions, inertia and passive wheel joints. Creates a new hardware revision.",
          segmented([["standard", "Standard feet"], ["roller", "Roller skates"]], H.feet, function (f) { H.feet = f; paint(); viewer.setModel({ variant: f }); }, "Foot type")));
      }
      var modeSeg = segmented([["all", "All active joints"], ["joint", "By joint"]], H.mode, function (m) { H.mode = m; paint(); }, "Assignment");
      var sec = UI.section("Motor assignment", "Choose a motor from this robot's catalog. New motors are added in the backend, not here.", UI.field(null, modeSeg));
      if (H.mode === "all") {
        var s = motorOptions(H.all, bot.platform);
        s.addEventListener("change", function () { H.all = s.value; paint(); });
        sec.appendChild(UI.field("Motor for all active joints", s));
      }
      sec.appendChild(h("div", { class: "flex" },
        h("button", { class: "btn btn-sm btn-primary", disabled: !dirty(), onclick: apply }, "Apply as new revision")));
      right.appendChild(sec);
      paintTable();
    }
    function paintTable() {
      tableBox.innerHTML = "";
      var tbl = h("table", { class: "tbl tbl-static" }, h("thead", {}, h("tr", {}, UI.th("Joint"), UI.th("Group"), UI.th("Motor"), UI.th("Direction"), UI.th("Zero offset"), UI.th("Position limits"), UI.th("Status"))));
      var tb = h("tbody", {});
      joints().forEach(function (j) {
        var mid = j.selectable === false ? null : motorFor(j);
        var m = mid ? DB.motor(mid) : null;
        var cell;
        if (j.selectable === false) cell = h("span", { class: "muted", text: j.note || "Not assigned" });
        else if (H.mode === "joint") {
          cell = motorOptions(mid, bot.platform);
          cell.addEventListener("change", function () { if (cell.value === H.all) delete H.byJoint[j.name]; else H.byJoint[j.name] = cell.value; paint(); });
        } else cell = h("span", { text: m ? m.name : "—" });
        tb.appendChild(h("tr", {}, h("td", {}, h("code", { text: j.name })), h("td", { text: j.group }), h("td", {}, cell),
          h("td", { class: "muted", text: "From model" }), h("td", { class: "muted", text: "From model" }), h("td", { class: "muted", text: "From model" }),
          h("td", {}, j.selectable === false ? UI.badge("Not a motor", "neutral") : UI.badge(m && m.official ? "Compatible" : "Needs validation"))));
      });
      tbl.appendChild(tb);
      var nActive = joints().filter(function (j) { return j.selectable !== false; }).length;
      tableBox.appendChild(UI.section("Joint mapping", nActive + " actuated joints. Direction, zero offset and limits belong to the robot model, not to the motor definition.", h("div", { class: "table-scroll" }, tbl)));
      var catalog = h("div", {});
      DB.motorsFor(bot.platform).forEach(function (m) {
        var rows = Object.keys(m.params).map(function (k) { return UI.kv(k, String(m.params[k])); });
        catalog.appendChild(UI.section(m.name, m.notes, rows.length ? h("div", { class: "summary-row" }, rows) : null, h("div", { class: "small muted mt8", text: m.license })));
      });
      tableBox.appendChild(catalog);
    }
    function apply() {
      var affected = botConfigs(bot);
      UI.confirm("Create hardware revision " + (bot.hardwareRev + 1) + "?", h("div", {},
        h("p", { text: "Affected configurations need to be re-checked and saved as new versions before training:" }),
        h("ul", { class: "plain-list" }, affected.length ? affected.map(function (c) { return h("li", { text: c.name }); }) : h("li", { text: "None" })),
        h("p", { class: "small muted", text: "Existing runs and results keep the hardware revision they were created with." })),
        "Create revision", function () {
          bot.feet = H.feet;
          var byJoint = {};
          if (H.mode === "joint") joints().forEach(function (j) { if (j.selectable !== false && H.byJoint[j.name] && H.byJoint[j.name] !== H.all) byJoint[j.name] = H.byJoint[j.name]; });
          bot.motors = { all: H.all, byJoint: byJoint };
          bot.hardwareRev += 1; bot.updated = DB.stamp();
          UI.toast("Hardware revision " + bot.hardwareRev + " created.", "ok");
          App.go("#/gallery/bots/" + bot.id + "?tab=hardware");
        });
    }
    App.guard = function () { return dirty() ? "Hardware changes are not applied. Discard them?" : null; };
    paint();
  }

  /* ---------------- Versions tab ---------------- */
  function versionsTab(page, bot) {
    var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th("Configuration"), UI.th("Action"), UI.th("Version"), UI.th("Saved"), UI.th("Note"), UI.th("Status"), UI.th("Runs", true))));
    var tb = h("tbody", {});
    botConfigs(bot).forEach(function (c) {
      c.versions.slice().reverse().forEach(function (v) {
        tb.appendChild(h("tr", { onclick: function () { App.go("#/gallery/bots/" + bot.id + "?cfg=" + c.id + "&v=" + v.v); } },
          h("td", { class: "row-title", text: c.name }), h("td", { text: DB.action(c.actionId).name }), h("td", { text: "v" + v.v }),
          h("td", { text: v.savedAt }), h("td", { class: "small", text: v.note || "" }), h("td", {}, UI.badge(versionStatus(c, v.v, bot))),
          h("td", { class: "num", text: String(runsUsing(c.id, v.v).length) })));
      });
    });
    tbl.appendChild(tb);
    page.appendChild(UI.section("Configuration versions", "Saved versions are immutable. Runs reference a fixed version, never “latest”.",
      botConfigs(bot).length ? h("div", { class: "table-wrap" }, tbl) : UI.empty("No configuration yet. Add an official template or start from scratch.")));
    page.appendChild(UI.section("Bot revisions", null,
      h("div", { class: "prop-grid" },
        UI.prop("Hardware revision", String(bot.hardwareRev)),
        UI.prop("Foot type", feetSummary(bot)),
        UI.prop("Updated", bot.updated))));
  }

  /* ============================ S-05 New configuration ============================ */
  Pages.newConfig = function (view, params) {
    var bot = DB.bot(params.id);
    if (!bot || !DB.platform(bot.platform).catalog) { App.go(bot ? "#/gallery/bots/" + bot.id : "#/gallery"); return; }
    var q = params.query || {};
    App.title("GALLERY / " + bot.name + " / New configuration");
    var S = { name: "", source: "official", actionId: q.action || null, scratchTask: null };
    var body = h("div", {});
    function paint() {
      body.innerHTML = "";
      var nameIn = h("input", { class: "input", value: S.name, placeholder: "e.g. Walking — stronger stand-still", oninput: function () { S.name = nameIn.value; } });
      body.appendChild(UI.section("Configuration", null, UI.field("Configuration name", nameIn, { req: true }),
        UI.field("Source", segmented([["official", "Official policy template"], ["scratch", "From scratch"]], S.source, function (s) { S.source = s; paint(); }, "Source"))));
      if (S.source === "official") {
        var tbl = h("table", { class: "tbl" }, h("thead", {}, h("tr", {}, UI.th(""), UI.th("Action"), UI.th("File"), UI.th("Category"), UI.th("Feet"), UI.th("Kind"), UI.th("Parameter sources"))));
        var tb = h("tbody", {});
        DB.actions.forEach(function (a) {
          var completeness = !a.task ? "Recipe not provided" : a.adapterPending ? "Training adapter pending" : Object.keys(a.manifest).length > 1 ? "Manifest + task preset" : "Task preset only";
          var radio = h("input", { type: "radio", name: "tmpl", checked: S.actionId === a.id, "aria-label": a.name });
          var tr = h("tr", { class: S.actionId === a.id ? "selected" : "", onclick: function () { S.actionId = a.id; paint(); } },
            h("td", {}, radio), h("td", { class: "row-title", text: a.name }), h("td", {}, h("code", { text: a.file })), h("td", { text: a.category }),
            h("td", {}, a.feet === "roller" ? (bot.feet === "roller" ? "Roller skates" : UI.badge("Requires roller skates", "warn")) : "Any"),
            h("td", { text: a.manifest.kind }), h("td", { class: "small", text: completeness }));
          tb.appendChild(tr);
        });
        tbl.appendChild(tb);
        body.appendChild(UI.section("Official policy templates (" + DB.actions.length + ")", "Source " + DB.SOURCES.policiesRepo + " @ " + DB.SOURCES.policiesRev.slice(0, 7) + ". Choosing a template copies readable configuration and the policy reference — not the original checkpoint, optimizer state or training history. One template per configuration.",
          h("div", { class: "table-wrap" }, tbl)));
      } else {
        var s = h("select", { class: "input", onchange: function () { S.actionId = s.value || null; } }, h("option", { value: "", text: "Choose a task family…" }));
        DB.actions.forEach(function (a) { if (a.task) s.appendChild(h("option", { value: a.id, selected: S.actionId === a.id, text: a.task + (a.id === "kick_left" ? " (left foot, adapter pending)" : a.id === "kick_right" ? " (right foot)" : "") })); });
        body.appendChild(UI.section("From scratch", "Does not reference official ONNX weights. Values start from the Platform starter preset (not an official default); required fields left empty must be filled before training.",
          UI.field("Task family", s)));
      }
    }
    paint();
    function create() {
      if (!S.name.trim()) { UI.toast("Configuration name is required.", "err"); return; }
      if (!S.actionId) { UI.toast(S.source === "official" ? "Choose a template." : "Choose a task family.", "err"); return; }
      var schema = DB.schemaFor(S.actionId, S.source);
      var vals = DB.defaultsFor(schema);
      var cfg = { id: "cfg-" + (DB.state.nextCfg++), botId: bot.id, actionId: S.actionId, name: S.name.trim(), source: S.source,
        templateRev: DB.SOURCES.policiesRev, baseline: DB.clone(vals), versions: [{ v: 1, savedAt: DB.stamp(), values: vals, note: S.source === "official" ? "Created from official template" : "Created from Platform starter preset" }], draft: null, archived: false };
      DB.configs.push(cfg);
      bot.lastConfig = cfg.id; bot.updated = DB.stamp();
      var st = DB.validate(cfg, vals, bot).status;
      UI.toast("Configuration created — " + st + ".", "ok");
      App.go("#/gallery/bots/" + bot.id + "?cfg=" + cfg.id);
    }
    view.appendChild(h("div", { class: "page" },
      pageHead("New configuration", bot.name + " · " + feetLabel(bot.feet)),
      body,
      h("div", { class: "action-bar" }, h("span", {}),
        h("div", { class: "flex" }, h("button", { class: "btn", onclick: function () { App.go("#/gallery/bots/" + bot.id); } }, "Cancel"),
          h("button", { class: "btn btn-primary", onclick: create }, "Create configuration")))));
  };

  Pages.sandboxHelpers = { botConfigs: botConfigs, hardwareLabel: hardwareLabel, feetLabel: feetLabel };
})();
