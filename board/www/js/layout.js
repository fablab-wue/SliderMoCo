/* Nested splitters + project panel visibility. */
(function (global) {
  "use strict";

  var PANELS = [
    { id: "timeline", title: "Timeline", noCap: true },
    { id: "ctrl", title: "Ctrl", noCap: true }
  ];

  /* Pastel wheel: +1/12 turn (30°) then ÷6. STOP stays --stop red; shared buttons ochre. */
  var AXIS_COLORS = ["#bd9eda", "#9edabd", "#dabd9f", "#9ebdda", "#bdda9f", "#da9ebd"];
  var AXIS_COLORS_SEL = ["#8b1ff0", "#1ff08b", "#ef8921", "#1f8bf0", "#89ef21", "#f01f8b"];

  function axisColor(id, selected) {
    var cols = selected ? AXIS_COLORS_SEL : AXIS_COLORS;
    var i = Number(id) - 1;
    if (!isFinite(i) || i < 0) i = 0;
    return cols[i % cols.length] || "#7ec8d9";
  }

  function defaultLayout() {
    return {
      split: "vertical",
      a: { id: "timeline" },
      b: { id: "ctrl" }
    };
  }

  function defaultVisible() {
    return {
      timeline: true,
      ctrl: true
    };
  }

  function prune(node, vis) {
    if (!node) return null;
    if (node.id && !node.split && !node.kids) {
      if (!vis[node.id]) return null;
      var leaf = { id: node.id };
      if (node.frac != null) leaf.frac = node.frac;
      return leaf;
    }
    if (node.kids) {
      var kids = [];
      node.kids.forEach(function (k) {
        var p = prune(k, vis);
        if (p) kids.push(p);
      });
      if (!kids.length) return null;
      if (kids.length === 1) return kids[0];
      return { split: node.split, kids: kids };
    }
    var a = prune(node.a, vis);
    var b = prune(node.b, vis);
    if (a && b) return { split: node.split, frac: node.frac == null ? 0.5 : node.frac, a: a, b: b };
    return a || b;
  }

  function collectIds(node, out) {
    if (!node) return;
    if (node.id && !node.split && !node.kids) { out.push(node.id); return; }
    if (node.kids) {
      node.kids.forEach(function (k) { collectIds(k, out); });
      return;
    }
    collectIds(node.a, out);
    collectIds(node.b, out);
  }

  function mountPanel(id) {
    var tpl = document.getElementById("tpl-" + id);
    var frame = document.createElement("div");
    frame.className = "panel-frame";
    frame.dataset.panel = id;
    var cap = document.createElement("div");
    cap.className = "panel-cap";
    var meta = PANELS.filter(function (p) { return p.id === id; })[0];
    if (!meta || !meta.noCap) {
      cap.textContent = meta ? meta.title : id;
      frame.appendChild(cap);
    }
    if (tpl) frame.appendChild(tpl.content.cloneNode(true));
    return frame;
  }

  function kidsOf(node) {
    if (node.kids && node.kids.length) return node.kids;
    return [node.a || {}, node.b || {}];
  }

  /* Pane shares in the parent. A split node's own `frac` is its a/b ratio, not
     its size in the parent — using it as flex-grow left empty space under Timeline. */
  function paneFracs(node, kids) {
    var raw, i, x, sum = 0;
    if (node.kids && node.kids.length) {
      raw = [];
      for (i = 0; i < kids.length; i++) {
        x = kids[i].frac == null ? 1 / kids.length : Number(kids[i].frac);
        raw.push(x);
      }
    } else {
      x = node.frac == null ? 0.5 : Number(node.frac);
      if (!isFinite(x)) x = 0.5;
      raw = [x, 1 - x];
    }
    for (i = 0; i < raw.length; i++) {
      x = raw[i];
      sum += isFinite(x) && x > 0 ? x : 0;
    }
    if (sum <= 0) {
      return kids.map(function () { return 1 / kids.length; });
    }
    return raw.map(function (v) {
      v = isFinite(v) && v > 0 ? v : 0;
      return v / sum;
    });
  }

  function applyPaneFlex(splitEl, fracs) {
    var panes = splitEl.querySelectorAll(":scope > .split-pane");
    var i, n = 0;
    for (i = 0; i < panes.length; i++) {
      if (panes[i].classList.contains("ctrl-pane")) {
        panes[i].style.flex = "0 0 auto";
        continue;
      }
      if (n < fracs.length) {
        panes[i].style.flex = fracs[n] + " 1 0";
        n++;
      }
    }
  }

  function bindKids(splitEl, node, kids) {
    var handles = splitEl.querySelectorAll(":scope > .split-handle");
    Array.prototype.forEach.call(handles, function (handle, i) {
      var start = null;
      function down(ev) {
        var src = ev.touches ? ev.touches[0] : ev;
        var fracs = paneFracs(node, kids);
        start = {
          x: src.clientX,
          y: src.clientY,
          fa: fracs[i],
          fb: fracs[i + 1],
          rect: splitEl.getBoundingClientRect()
        };
        ev.preventDefault();
      }
      function move(ev) {
        if (!start) return;
        var src = ev.touches ? ev.touches[0] : ev;
        var r = start.rect;
        var span = start.fa + start.fb;
        var delta = splitEl.classList.contains("row")
          ? (src.clientX - start.x) / r.width
          : (src.clientY - start.y) / r.height;
        var next = start.fa + delta;
        var lo = Math.min(0.08, span * 0.2);
        if (next < lo) next = lo;
        if (next > span - lo) next = span - lo;
        if (node.kids) {
          kids[i].frac = next;
          kids[i + 1].frac = span - next;
        } else if (i === 0) {
          node.frac = next;
        }
        applyPaneFlex(splitEl, paneFracs(node, kids));
        if (global.timelineEditor) global.timelineEditor.draw();
      }
      function up() { start = null; }
      handle.addEventListener("mousedown", down);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      handle.addEventListener("touchstart", down, { passive: false });
      window.addEventListener("touchmove", move, { passive: false });
      window.addEventListener("touchend", up);
    });
  }

  function build(node, host) {
    if (!node) return;
    if (node.id && !node.split && !node.kids) {
      host.appendChild(mountPanel(node.id));
      return;
    }
    var kids = kidsOf(node);
    var fracs = paneFracs(node, kids);
    var split = document.createElement("div");
    split.className = "split " + (node.split === "horizontal" ? "row" : "col");
    var pinCtrl = kids.some(function (k) { return k.id === "ctrl"; });
    kids.forEach(function (kid, i) {
      if (i && kid.id !== "ctrl") {
        var handle = document.createElement("div");
        handle.className = "split-handle";
        split.appendChild(handle);
      }
      var pane = document.createElement("div");
      pane.className = "split-pane" + (kid.id === "ctrl" ? " ctrl-pane" : "");
      if (kid.id === "ctrl") pane.style.flex = "0 0 auto";
      else if (pinCtrl) pane.style.flex = "1 1 0";
      else pane.style.flex = fracs[i] + " 1 0";
      build(kid, pane);
      split.appendChild(pane);
    });
    host.appendChild(split);
    bindKids(split, node, kids);
  }

  function renderWorkspace(root, layout, visible) {
    root.innerHTML = "";
    var vis = visible || defaultVisible();
    var tree = prune(layout || defaultLayout(), vis);
    if (!tree) {
      var empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "All panels hidden — enable some in Config.";
      root.appendChild(empty);
      return [];
    }
    build(tree, root);
    var ids = [];
    collectIds(tree, ids);
    return ids;
  }

  function phoneMode() {
    return window.matchMedia && window.matchMedia("(max-width: 800px)").matches;
  }

  function applyPhoneChrome() {
    var phone = phoneMode();
    var app = document.getElementById("phoneApp");
    var ws = document.getElementById("workspace");
    var top = document.querySelector(".topbar");
    document.body.classList.toggle("phone-ui", phone);
    if (app) app.hidden = !phone;
    if (ws) {
      ws.hidden = phone;
      ws.classList.toggle("phone", phone);
    }
    if (top) top.hidden = phone;
    if (!phone) return;
    var nav = document.getElementById("phoneNav");
    if (!nav || nav._bound) return;
    nav._bound = true;
    Array.prototype.forEach.call(nav.querySelectorAll(".tab"), function (tab) {
      tab.onclick = function () {
        var id = tab.getAttribute("data-tab");
        Array.prototype.forEach.call(nav.querySelectorAll(".tab"), function (x) {
          x.classList.toggle("active", x === tab);
        });
        Array.prototype.forEach.call(document.querySelectorAll("#phoneApp .phone-panel"), function (p) {
          p.classList.toggle("hidden", p.getAttribute("data-show") !== id);
        });
      };
    });
  }

  global.SHLayout = {
    PANELS: PANELS,
    AXIS_COLORS: AXIS_COLORS,
    AXIS_COLORS_SEL: AXIS_COLORS_SEL,
    axisColor: axisColor,
    defaultLayout: defaultLayout,
    defaultVisible: defaultVisible,
    renderWorkspace: renderWorkspace,
    applyPhoneChrome: applyPhoneChrome,
    phoneMode: phoneMode
  };
})(window);
