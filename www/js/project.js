/* Project + rig JSON (localStorage, download, optional /api). */
(function (global) {
  "use strict";

  var PROJ_KEY = "sh_project";
  var RIG_KEY = "sh_rig";

  function defaultLanes() {
    return [
      {
        id: 1, name: "slide", unit: "mm",
        keys: [
          { t: 0, value: 0, interp: "auto", in: { dx: -0.4, dy: 0 }, out: { dx: 0.8, dy: 0 } },
          { t: 6, value: 180, interp: "auto", in: { dx: -0.8, dy: 0 }, out: { dx: 0.4, dy: 0 } }
        ]
      },
      {
        id: 2, name: "pan", unit: "deg",
        keys: [
          { t: 0, value: 0, interp: "ease_inout", in: { dx: -0.3, dy: 0 }, out: { dx: 0.3, dy: 0 } },
          { t: 6, value: 45, interp: "linear", in: { dx: -0.3, dy: 0 }, out: { dx: 0.3, dy: 0 } }
        ]
      },
      {
        id: 3, name: "tilt", unit: "deg",
        keys: [
          { t: 0, value: 0, interp: "ease_inout", in: { dx: -0.3, dy: 0 }, out: { dx: 0.3, dy: 0 } },
          { t: 6, value: 15, interp: "linear", in: { dx: -0.3, dy: 0 }, out: { dx: 0.3, dy: 0 } }
        ]
      }
    ];
  }

  function defaultProject() {
    return {
      name: "untitled",
      frame_rate: 30,
      mark_count: 4,
      layout_rev: 11,
      panels: SHLayout.defaultVisible(),
      layout: SHLayout.defaultLayout(),
      lanes: defaultLanes(),
      markers: [],
      play_hz: 50
    };
  }

  function defaultRig() {
    return {
      name: "default slider",
      axes: [
        { id: 1, name: "slide", unit: "mm", min: 0, max: 600, max_spd: 100, max_acc: 500, mc_id: 1, slot: 1 },
        { id: 2, name: "pan", unit: "deg", min: null, max: null, max_spd: 80, max_acc: 400, mc_id: 1, slot: 2 },
        { id: 3, name: "tilt", unit: "deg", min: -90, max: 90, max_spd: 60, max_acc: 300, mc_id: 1, slot: 3 }
      ]
    };
  }

  function loadLocal(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback();
      var o = JSON.parse(raw);
      return o && typeof o === "object" ? o : fallback();
    } catch (e) {
      return fallback();
    }
  }

  function saveLocal(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {}
  }

  function download(name, obj) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function downloadText(name, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function readFile(input, cb) {
    var f = input.files && input.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { cb(JSON.parse(r.result)); } catch (e) { alert("Bad JSON"); }
    };
    r.readAsText(f);
    input.value = "";
  }

  global.SHProject = {
    defaultProject: defaultProject,
    defaultRig: defaultRig,
    loadProject: function () {
      var p = loadLocal(PROJ_KEY, defaultProject);
      if (!p.layout || p.layout_rev !== 11) {
        p.layout = SHLayout.defaultLayout();
        p.layout_rev = 11;
        p.panels = SHLayout.defaultVisible();
        saveLocal(PROJ_KEY, p);
      }
      if (!p.markers) p.markers = [];
      else if (window.TimelineEditor && typeof TimelineEditor.normalizeMarker === "function") {
        p.markers = p.markers.map(TimelineEditor.normalizeMarker);
      }
      if (!p.play_hz) p.play_hz = 50;
      var mc = parseInt(p.mark_count, 10);
      if (isNaN(mc) || mc < 2) mc = 4;
      if (mc > 8) mc = 8;
      p.mark_count = mc;
      return p;
    },
    saveProject: function (p) { saveLocal(PROJ_KEY, p); },
    loadRig: function () { return loadLocal(RIG_KEY, defaultRig); },
    saveRig: function (r) { saveLocal(RIG_KEY, r); },
    download: download,
    downloadText: downloadText,
    readFile: readFile
  };
})(window);
