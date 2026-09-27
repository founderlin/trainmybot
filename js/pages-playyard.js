/* PLAYYARD — MuJoCo floor. One robot instance is bound to one ONNX file. */
window.Pages = window.Pages || {};
(function () {
  "use strict";
  var h = UI.h;
  var ROBOTS = [
    { id: "microduck", name: "Microduck" },
    { id: "beni", name: "Beni" },
    { id: "sesame", name: "Sesame" }
  ];

  function base() { return (window.DB && DB.viewerBase != null) ? DB.viewerBase : "http://localhost:8766"; }
  function robotName(id) {
    var hit = ROBOTS.filter(function (r) { return r.id === id; })[0];
    return hit ? hit.name : id;
  }

  Pages.playyard = function (view) {
    App.title("PLAYYARD");
    var robot = "microduck";
    var onnx = "";
    var busy = false;

    var robotBox = h("div", { class: "playyard-robots", role: "group", "aria-label": "Robot" });
    ROBOTS.forEach(function (r) {
      robotBox.appendChild(h("button", {
        type: "button",
        "aria-pressed": r.id === robot ? "true" : "false",
        onclick: function () { setRobot(r.id); }
      }, r.name));
    });

    var select = h("select", { class: "input input-sm", "aria-label": "ONNX file", onchange: function () {
      onnx = select.value;
      if (onnx) { fileInput.value = ""; fileLabel.textContent = onnx; }
    } });
    function fillSelect() {
      select.innerHTML = "";
      select.appendChild(h("option", { value: "", text: "Select an ONNX file" }));
      select.style.display = robot === "microduck" ? "" : "none";
      if (robot !== "microduck") return;
      DB.actions.forEach(function (a) {
        select.appendChild(h("option", { value: a.file, text: a.file }));
      });
      select.value = DB.actions.some(function (a) { return a.file === onnx; }) ? onnx : "";
    }

    var fileLabel = h("span", { class: "playyard-file" });
    var fileInput = h("input", { type: "file", accept: ".onnx,application/octet-stream", hidden: true });
    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (!/\.onnx$/i.test(f.name)) {
        UI.toast("Choose an .onnx file.");
        fileInput.value = "";
        return;
      }
      onnx = f.name;
      select.value = "";
      fileLabel.textContent = f.name;
    });

    var list = h("div", { class: "playyard-list" });
    var stage = h("div", { class: "playyard-stage" });
    var root = h("div", { class: "playyard" },
      h("div", { class: "playyard-bar" },
        robotBox,
        select,
        h("button", { class: "btn btn-sm", type: "button", onclick: function () { fileInput.click(); } }, "ONNX file"),
        fileInput,
        fileLabel,
        h("button", { class: "btn btn-sm btn-danger", type: "button", onclick: resetYard }, "Reset")),
      stage,
      list);
    view.appendChild(root);
    fillSelect();
    paint([]);

    function setRobot(id) {
      var catalog = robot === "microduck" && DB.actions.some(function (a) { return a.file === onnx; });
      robot = id;
      if (id !== "microduck" && catalog) { onnx = ""; fileLabel.textContent = ""; fileInput.value = ""; }
      Array.prototype.forEach.call(robotBox.children, function (btn, i) {
        btn.setAttribute("aria-pressed", ROBOTS[i].id === id ? "true" : "false");
      });
      fillSelect();
      if (select.value) fileLabel.textContent = select.value;
    }

    function paint(items) {
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(h("div", { class: "playyard-empty", text: "Choose a robot and an ONNX file, then click the floor." }));
        return;
      }
      items.forEach(function (inst, i) {
        list.appendChild(h("div", { class: "playyard-chip" },
          h("b", { text: (i + 1) + "  " + robotName(inst.robot) }),
          h("span", { text: inst.onnx + " · " + (inst.motion === "pose" ? "Standing pose" : "Preview motion") })));
      });
    }

    function place(nx, ny, viewId) {
      if (!onnx) { UI.toast("Select an ONNX file first."); return; }
      if (!viewId || busy) return;
      busy = true;
      fetch(base() + "/api/yard/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view: viewId, nx: nx, ny: ny, robot: robot, onnx: onnx })
      }).then(function (r) { return r.json(); }).then(function (s) {
        busy = false;
        if (!s.ok) { UI.toast(s.error || "Could not place the robot."); return; }
        paint(s.instances || []);
      }).catch(function () {
        busy = false;
        UI.toast("The playyard is not reachable.");
      });
    }

    function resetYard() {
      if (busy) return;
      busy = true;
      fetch(base() + "/api/yard/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          busy = false;
          if (!s.ok) { UI.toast(s.error || "Could not reset."); return; }
          paint([]);
        })
        .catch(function () { busy = false; UI.toast("The playyard is not reachable."); });
    }

    var live = UI.viewer(stage, {
      variant: "yard",
      assist: false,
      head: false,
      hint: "Click the floor to place · Left-drag orbit · Right-drag pan · Scroll zoom · R reset view",
      onPick: place
    });
    App.onLeave(function () { live.destroy(); });

    fetch(base() + "/api/status?variant=yard").then(function (r) { return r.json(); }).then(function (s) {
      if (s && s.instances) paint(s.instances);
    }).catch(function () {});
  };
})();
