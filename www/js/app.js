/* SliderMoCo UI — /ws JSON with axes[]. */
(function () {
  "use strict";

  var TAP_MS = 333;
  var WDT_MS = 1000;
  var LIMIT_SET_MS = 3000;
  var LIMIT_RESET_MS = 5000;
  var GAMMA = 2;
  var SS_MS = 80;

  var ws = null;
  var lastStatus = {};
  var cmdSpd = 40;
  var cmdAcc = 100;
  var spdMin = 1;
  var spdMax = 100;
  var accMin = 1;
  var accMax = 500;
  var ssTimer = 0;
  var marks = { a: null, b: null, c: null, d: null, e: null, f: null, g: null, h: null };
  var held = {};
  var project = SHProject.loadProject();
  var rig = SHProject.loadRig();
  var editor = null;
  var lastPhone = null;
  var lastHello = null;
  var mtTimer = 0;
  var pathBufferSize = 32000;
  var playing = false;
  var playRaf = 0;
  var playT0 = 0;
  var playhead0 = 0;
  var playDir = 1;
  var playEndT = 0;
  var playLastT = 0;
  var preroll = null;
  var silentSeek = null;
  var audioCtx = null;
  var markerEdit = null;
  var mkFilling = false;

  function $(id) { return document.getElementById(id); }

  function uiRoot() {
    return document.body.classList.contains("phone-ui") ? ($("phoneApp") || document) : document;
  }

  function q(sel) {
    return uiRoot().querySelector(sel);
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  window.__shSend = send;
  function sendMc(line, silent) {
    if (silent) send({ mc: line, silent: true });
    else send({ mc: line });
  }

  function isUnset(v) {
    if (v == null || v === "") return true;
    var t = String(v).trim().toLowerCase();
    return t === "none" || t === "-";
  }
  function cfgNum(v) {
    if (isUnset(v)) return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function fmt(n, d) {
    if (n === null || n === undefined || n === "") n = 0;
    n = Number(n);
    if (isNaN(n)) n = 0;
    return n.toFixed(d == null ? 1 : d);
  }

  function axisColor(id) {
    var cols = (window.SHLayout && SHLayout.AXIS_COLORS) || [];
    var i = Number(id) - 1;
    if (i < 0) i = 0;
    return cols[i % Math.max(1, cols.length)] || "#7ec8d9";
  }

  function sliderToSpeed(t) {
    t = Math.max(0, Math.min(1, t));
    return spdMin + (spdMax - spdMin) * Math.pow(t, GAMMA);
  }
  function speedToSlider(v) {
    var u = (Number(v) - spdMin) / Math.max(1e-9, spdMax - spdMin);
    u = Math.max(0, Math.min(1, u));
    return Math.pow(u, 1 / GAMMA) * 1000;
  }

  function ensureLanesFromAxes(axes) {
    if (!editor || !axes || !axes.length) return;
    var have = {};
    var lanes = editor.lanes || [];
    lanes.forEach(function (ln) { have[Number(ln.id)] = true; });
    var extra = [];
    axes.forEach(function (ax) {
      var id = Number(ax.id);
      if (!id || have[id]) return;
      extra.push({
        id: id,
        name: ax.name || ("A" + id),
        unit: ax.unit || "",
        keys: [
          { t: 0, value: 0, interp: "auto", in: { dx: -0.4, dy: 0 }, out: { dx: 0.8, dy: 0 } }
        ]
      });
    });
    if (!extra.length) return;
    editor.setLanes(lanes.concat(extra));
    saveTimeline();
    pushEditorLimits();
  }

  function liveAxes() {
    if (lastStatus && lastStatus.axes && lastStatus.axes.length) return lastStatus.axes;
    if (lastHello && lastHello.axes && lastHello.axes.length) return lastHello.axes;
    if (lastHello && lastHello.config && lastHello.config.axes && lastHello.config.axes.length) {
      return lastHello.config.axes;
    }
    return [];
  }

  function syncRigFromAxes(axes) {
    if (!axes || !axes.length) return;
    if (!rig || typeof rig !== "object") rig = SHProject.defaultRig();
    rig.axes = axes.map(function (ax) {
      return {
        id: ax.id,
        name: ax.name,
        unit: ax.unit,
        min: ax.min,
        max: ax.max,
        max_spd: ax.max_spd,
        max_acc: ax.max_acc,
        mc_id: ax.mc_id || 1,
        slot: ax.slot != null ? ax.slot : ax.id
      };
    });
    SHProject.saveRig(rig);
  }

  function applyHello(h) {
    if (!h) return;
    lastHello = h;
    if (h.axes && h.axes.length) {
      if (!lastStatus || typeof lastStatus !== "object") lastStatus = {};
      lastStatus.axes = h.axes;
      syncRigFromAxes(h.axes);
    }
    if (h.config && h.config.path_buffer_size) {
      pathBufferSize = Number(h.config.path_buffer_size) || 32000;
    }
    if (h.config && h.config.axes && h.config.axes.length) {
      h.config.axes.forEach(function (ax) {
        if (ax.id === 1 || ax.id == null) {
          if (ax.max_spd) spdMax = Number(ax.max_spd) || spdMax;
          if (ax.max_acc) accMax = Number(ax.max_acc) || accMax;
        }
      });
    }
    var axes = liveAxes();
    if (window.SWUi) SWUi.applyHello(h);
    renderInfo(axes);
    fillAxisJog(axes);
    fillCtrlAxes(axes);
    fillJoyRows(axes);
    ensureLanesFromAxes(axes);
    var n = axes.length;
    Array.prototype.forEach.call(document.querySelectorAll(".phone-ax2"), function (el) {
      el.classList.toggle("hidden", n < 2);
    });
    pushEditorLimits();
  }

  function renderInfo(axes) {
    axes = axes || [];
    var box = $("infoAxes");
    if (box) {
      if (!box.children.length || box.children.length !== axes.length) {
        box.innerHTML = "";
        axes.forEach(function (ax) {
          var row = document.createElement("div");
          row.className = "info-row";
          row.dataset.axisId = String(ax.id);
          row.style.setProperty("--axis", axisColor(ax.id));
          row.innerHTML =
            '<span class="name"></span>' +
            '<span class="num pos"></span>' +
            '<span class="num spd"></span>' +
            '<span class="num acc"></span>' +
            '<span class="letter"></span>';
          box.appendChild(row);
        });
      }
      axes.forEach(function (ax, i) {
        var row = box.children[i];
        if (!row) return;
        row.style.setProperty("--axis", axisColor(ax.id));
        row.querySelector(".name").textContent = ax.name || ("A" + ax.id);
        row.querySelector(".pos").innerHTML = fmt(ax.pos) + ' <span class="u">' + (ax.unit || "") + "</span>";
        row.querySelector(".spd").innerHTML = fmt(ax.spd) + ' <span class="u">/s</span>';
        row.querySelector(".acc").innerHTML = fmt(ax.acc) + ' <span class="u">/s²</span>';
        row.querySelector(".letter").textContent = ax.state || "I";
      });
    }
    renderPhoneTele(axes);
    syncCtrlReadouts();
    var l1 = lastStatus.line1 != null ? lastStatus.line1 : "Ready";
    var l2 = lastStatus.line2 || "";
    if ($("line1")) $("line1").textContent = l1;
    if ($("line2")) $("line2").textContent = l2;
    if ($("phoneLine1")) $("phoneLine1").textContent = l1;
    if ($("phoneLine2")) $("phoneLine2").textContent = l2;
    syncCtrlStatus();
  }

  function renderPhoneTele(axes) {
    var box = $("phoneTele");
    if (!box) return;
    box.innerHTML = "";
    (axes || []).forEach(function (ax) {
      var row = document.createElement("div");
      row.className = "info-row";
      row.style.setProperty("--axis", axisColor(ax.id));
      row.innerHTML =
        '<span class="name">' + (ax.name || ("A" + ax.id)) + "</span>" +
        '<span class="num">' + fmt(ax.pos) + ' <span class="u">' + (ax.unit || "") + "</span></span>" +
        '<span class="num">' + fmt(ax.spd) + ' <span class="u">/s</span></span>' +
        '<span class="num">' + fmt(ax.acc) + ' <span class="u">/s²</span></span>' +
        '<span class="letter">' + (ax.state || "I") + "</span>";
      box.appendChild(row);
    });
  }

  function fillAxisJog(axes) {
    var box = $("axisJogRows");
    if (!box) return;
    var list = (axes && axes.length) ? axes : liveAxes();
    if (!list.length) return;
    box.innerHTML = "";
    list.forEach(function (ax, i) {
      var id = ax.id != null ? ax.id : i + 1;
      var col = axisColor(id);
      var n = Number(id) === 2 ? "2" : "";
      var row = document.createElement("div");
      row.className = "jog-row pad-grid-6";
      row.innerHTML =
        '<button type="button" class="btn axis-btn" data-btn="LIMIT_L" data-ax="' + id + '" style="background:' + col + '">⍇</button>' +
        '<button type="button" class="btn axis-btn" data-btn="FAST_L' + n + '" data-ax="' + id + '" style="background:' + col + '">◀◀</button>' +
        '<button type="button" class="btn axis-btn" data-btn="MOVE_L' + n + '" data-ax="' + id + '" style="background:' + col + '">◀</button>' +
        '<button type="button" class="btn axis-btn" data-btn="MOVE_R' + n + '" data-ax="' + id + '" style="background:' + col + '">▶</button>' +
        '<button type="button" class="btn axis-btn" data-btn="FAST_R' + n + '" data-ax="' + id + '" style="background:' + col + '">▶▶</button>' +
        '<button type="button" class="btn axis-btn" data-btn="LIMIT_R" data-ax="' + id + '" style="background:' + col + '">⍈</button>';
      box.appendChild(row);
    });
    bindButtons(box);
    if (window.SWUi && typeof SWUi.rebind === "function") SWUi.rebind();
    syncLimitBtns();
  }

  var CTRL_EYE_ON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10 S5.5 4 10 4 S18 10 18 10 S14.5 16 10 16 S2 10 2 10 Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.3" fill="currentColor"/></svg>';
  var CTRL_EYE_OFF = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10 S5.5 4 10 4 S18 10 18 10 S14.5 16 10 16 S2 10 2 10 Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 16 L16 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var CTRL_LOCK_ON = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9 V7 a3 3 0 0 1 6 0 v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  var CTRL_LOCK_OFF = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9 V7 a3 3 0 0 1 6 0" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  var CTRL_DIAMOND = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 L17 10 L10 17 L3 10 Z" fill="currentColor"/></svg>';

  function fillCtrlAxes(axes) {
    var box = $("ctrlAxes");
    if (!box) return;
    var list = (axes && axes.length) ? axes : liveAxes();
    var i, same = box.children.length === list.length;
    if (same) {
      for (i = 0; i < list.length; i++) {
        if (Number(box.children[i].getAttribute("data-ax")) !== Number(list[i].id != null ? list[i].id : i + 1)) {
          same = false;
          break;
        }
      }
      if (same) {
        syncCtrlReadouts();
        return;
      }
    }
    box.innerHTML = "";
    list.forEach(function (ax, idx) {
      var id = ax.id != null ? ax.id : idx + 1;
      var col = axisColor(id);
      var n = Number(id) === 2 ? "2" : "";
      var row = document.createElement("div");
      row.className = "ctrl-line ctrl-cols";
      row.setAttribute("data-ax", String(id));
      row.style.setProperty("--axis", col);
      row.innerHTML =
        '<span class="ctrl-name"></span>' +
        '<span class="ctrl-sep"></span>' +
        '<span class="ctrl-live">' +
          '<span class="ctrl-val js-ctrl-pos"><span class="v"></span><span class="u"></span></span>' +
          '<span class="ctrl-val js-ctrl-spd"><span class="v"></span><span class="u"></span></span>' +
          '<span class="ctrl-val js-ctrl-acc"><span class="v"></span><span class="u"></span></span>' +
        "</span>" +
        '<span class="ctrl-sep"></span>' +
        '<span class="ctrl-val js-ctrl-pose"><span class="v"></span><span class="u"></span></span>' +
        '<span class="ctrl-sep"></span>' +
        '<span class="ctrl-jog">' +
          '<button type="button" class="btn axis-btn" data-btn="LIMIT_L" data-ax="' + id + '" style="background:' + col + '">⍇</button>' +
          '<button type="button" class="btn axis-btn" data-btn="FAST_L' + n + '" data-ax="' + id + '" style="background:' + col + '">◀◀</button>' +
          '<button type="button" class="btn axis-btn" data-btn="MOVE_L' + n + '" data-ax="' + id + '" style="background:' + col + '">◀</button>' +
          '<button type="button" class="btn axis-btn" data-btn="MOVE_R' + n + '" data-ax="' + id + '" style="background:' + col + '">▶</button>' +
          '<button type="button" class="btn axis-btn" data-btn="FAST_R' + n + '" data-ax="' + id + '" style="background:' + col + '">▶▶</button>' +
          '<button type="button" class="btn axis-btn" data-btn="LIMIT_R" data-ax="' + id + '" style="background:' + col + '">⍈</button>' +
        "</span>" +
        '<span class="ctrl-sep"></span>' +
        '<span class="ctrl-tools">' +
          '<button type="button" class="btn ghost ctrl-half ctrl-eye js-ctrl-eye" title="Show / hide lane"></button>' +
          '<button type="button" class="btn ghost ctrl-half ctrl-lock js-ctrl-lock" title="Lock keys"></button>' +
        "</span>" +
        '<span class="ctrl-sep"></span>' +
        '<span class="ctrl-keys">' +
          '<button type="button" class="btn ghost ctrl-half js-ctrl-prev" title="Previous key — left: playhead, right: also move slider">&#x291d;</button>' +
          '<button type="button" class="btn ghost ctrl-half js-ctrl-key" title="Key live pose at playhead">' + CTRL_DIAMOND + "</button>" +
          '<button type="button" class="btn ghost ctrl-half js-ctrl-next" title="Next key — left: playhead, right: also move slider">&#x291e;</button>' +
        "</span>" +
        '<span class="ctrl-sep"></span>' +
        '<div class="ctrl-joy" data-ax="' + id + '"></div>';
      box.appendChild(row);
      bindCtrlLine(row);
    });
    bindButtons(box);
    if (window.SWUi && typeof SWUi.rebind === "function") SWUi.rebind();
    syncLimitBtns();
    syncCtrlReadouts();
  }

  function bindCtrlLine(row) {
    var id = Number(row.getAttribute("data-ax"));
    row.addEventListener("click", function (ev) {
      if (ev.target.closest("button, .ctrl-joy, .jc-track")) return;
      setKbAxis(id);
    });
    var eye = row.querySelector(".js-ctrl-eye");
    if (eye) {
      eye.onclick = function (ev) {
        ev.stopPropagation();
        if (!editor) return;
        editor.visible[id] = !editor.visible[id];
        editor._tracks();
        editor.draw();
      };
    }
    var lock = row.querySelector(".js-ctrl-lock");
    if (lock) {
      lock.onclick = function (ev) {
        ev.stopPropagation();
        if (!editor) return;
        editor.locked[id] = !editor.locked[id];
        editor._tracks();
        editor.draw();
      };
    }
    function jumpLane(dir, seek) {
      if (!editor || !editor.jumpLaneKey(id, dir)) return;
      var t = editor.playhead;
      if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
      syncCtrlReadouts();
      if (seek) onPlayhead(t, true, true);
    }
    function bindJump(el, dir) {
      if (!el) return;
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        jumpLane(dir, false);
      });
      el.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        jumpLane(dir, true);
      });
    }
    bindJump(row.querySelector(".js-ctrl-prev"), -1);
    bindJump(row.querySelector(".js-ctrl-next"), 1);
    var keyBtn = row.querySelector(".js-ctrl-key");
    if (keyBtn) {
      keyBtn.onclick = function (ev) {
        ev.stopPropagation();
        if (editor) editor.keyAtPlayhead(editor.live, id);
      };
    }
  }

  function syncCtrlReadouts() {
    var axes = liveAxes();
    var pose = editor ? editor.poseAt(editor.playhead) : {};
    var timeEl = document.querySelector(".js-ctrl-time");
    if (timeEl) {
      var tv = timeEl.querySelector(".v");
      var tu = timeEl.querySelector(".u");
      if (tv) tv.textContent = (editor ? editor.playhead : 0).toFixed(2);
      if (tu) tu.textContent = "s";
    }
    Array.prototype.forEach.call(document.querySelectorAll(".ctrl-line"), function (row) {
      var id = Number(row.getAttribute("data-ax"));
      var ax = null;
      var i;
      for (i = 0; i < axes.length; i++) {
        if (Number(axes[i].id) === id) { ax = axes[i]; break; }
      }
      var unit = (ax && ax.unit) || "";
      var nameEl = row.querySelector(".ctrl-name");
      if (nameEl) nameEl.textContent = (ax && ax.name) || ("A" + id);
      function setNum(sel, val, suffix) {
        var el = row.querySelector(sel);
        if (!el) return;
        var v = el.querySelector(".v");
        var u = el.querySelector(".u");
        if (v) v.textContent = fmt(val);
        if (u) u.textContent = suffix || "";
      }
      setNum(".js-ctrl-pos", ax ? ax.pos : 0, unit);
      setNum(".js-ctrl-spd", ax ? ax.spd : 0, "/s");
      setNum(".js-ctrl-acc", ax ? ax.acc : 0, "/s²");
      setNum(".js-ctrl-pose", pose[id], unit);
      row.classList.toggle("active", !!(editor && editor.activeId === id));
      var vis = !editor || editor.visible[id] !== false;
      var locked = !!(editor && editor.locked[id]);
      var eye = row.querySelector(".js-ctrl-eye");
      if (eye) {
        eye.classList.toggle("on", vis);
        eye.title = vis ? "Hide lane" : "Show lane";
        eye.innerHTML = vis ? CTRL_EYE_ON : CTRL_EYE_OFF;
      }
      var lock = row.querySelector(".js-ctrl-lock");
      if (lock) {
        lock.classList.toggle("on", locked);
        lock.title = locked ? "Unlock keys" : "Lock keys";
        lock.innerHTML = locked ? CTRL_LOCK_ON : CTRL_LOCK_OFF;
      }
    });
    syncCtrlAllEyeLock();
  }

  function ctrlAllVisible() {
    if (!editor || !editor.lanes.length) return true;
    return editor.lanes.every(function (ln) { return editor.visible[ln.id] !== false; });
  }

  function ctrlAllLocked() {
    if (!editor || !editor.lanes.length) return false;
    return editor.lanes.every(function (ln) { return !!editor.locked[ln.id]; });
  }

  function syncCtrlAllEyeLock() {
    var allVis = ctrlAllVisible();
    var allLock = ctrlAllLocked();
    var eyeAll = document.querySelector(".js-ctrl-eye-all");
    if (eyeAll) {
      eyeAll.classList.toggle("on", allVis);
      eyeAll.title = allVis ? "Hide all lanes" : "Show all lanes";
      eyeAll.innerHTML = allVis ? CTRL_EYE_ON : CTRL_EYE_OFF;
    }
    var lockAll = document.querySelector(".js-ctrl-lock-all");
    if (lockAll) {
      lockAll.classList.toggle("on", allLock);
      lockAll.title = allLock ? "Unlock all keys" : "Lock all keys";
      lockAll.innerHTML = allLock ? CTRL_LOCK_ON : CTRL_LOCK_OFF;
    }
  }

  function setAllLaneVisible(on) {
    if (!editor) return;
    editor.lanes.forEach(function (ln) { editor.visible[ln.id] = !!on; });
    editor._tracks();
    editor.draw();
  }

  function setAllLaneLocked(on) {
    if (!editor) return;
    editor.lanes.forEach(function (ln) { editor.locked[ln.id] = !!on; });
    editor._tracks();
    editor.draw();
  }

  function bindCtrlPanel() {
    var play = document.querySelector(".js-ctrl-play");
    var rev = document.querySelector(".js-ctrl-play-rev");
    var from = document.querySelector(".js-ctrl-play-from");
    var fromRev = document.querySelector(".js-ctrl-play-from-rev");
    var start = document.querySelector(".js-ctrl-to-start");
    var end = document.querySelector(".js-ctrl-to-end");
    if (play) play.onclick = function () { if (mcIdle()) playGraph("fwd"); };
    if (rev) rev.onclick = function () { if (mcIdle()) playGraph("rev"); };
    if (from) from.onclick = function () { if (mcIdle()) playGraph("from"); };
    if (fromRev) fromRev.onclick = function () { if (mcIdle()) playGraph("fromRev"); };
    if (start) {
      start.onclick = function () {
        if (!editor) return;
        editor.playhead = 0;
        editor.draw();
        if ($("tlTime")) $("tlTime").textContent = "0.00 s";
        syncCtrlReadouts();
        seekAtMax(editor.poseAt(0));
      };
    }
    if (end) {
      end.onclick = function () {
        if (!editor) return;
        var t = editor.motionDuration();
        editor.playhead = t;
        editor.draw();
        if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
        syncCtrlReadouts();
        seekAtMax(editor.poseAt(t));
      };
    }
    function jumpVisibleKey(dir, seek) {
      if (!editor || !editor.jumpVisibleKey(dir)) return;
      var t = editor.playhead;
      if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
      syncCtrlReadouts();
      if (seek) onPlayhead(t, true, true);
    }
    function bindJumpAll(el, dir) {
      if (!el) return;
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        jumpVisibleKey(dir, false);
      });
      el.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        jumpVisibleKey(dir, true);
      });
    }
    bindJumpAll(document.querySelector(".js-ctrl-prev-all"), -1);
    bindJumpAll(document.querySelector(".js-ctrl-next-all"), 1);
    var keyAll = document.querySelector(".js-ctrl-key-all");
    if (keyAll) {
      keyAll.onclick = function () {
        if (editor) editor.keyAtPlayhead(editor.live);
      };
    }
    var eyeAll = document.querySelector(".js-ctrl-eye-all");
    if (eyeAll) {
      eyeAll.onclick = function () { setAllLaneVisible(!ctrlAllVisible()); };
    }
    var lockAll = document.querySelector(".js-ctrl-lock-all");
    if (lockAll) {
      lockAll.onclick = function () { setAllLaneLocked(!ctrlAllLocked()); };
    }
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-dlg"), function (btn) {
      btn.onclick = function () { openFloatWin(btn.getAttribute("data-float")); };
    });
    syncCtrlAllEyeLock();
    syncCtrlStatus();
  }

  function limitSide(isLeft, axis) {
    var swap = false;
    if (window.SWUi) {
      if (Number(axis) === 2 && typeof SWUi.swapDir2 === "function") swap = !!SWUi.swapDir2();
      else if (typeof SWUi.swapDir === "function") swap = !!SWUi.swapDir();
    }
    return (isLeft ? -1 : 1) * (swap ? -1 : 1) < 0 ? "min" : "max";
  }

  function axisEntry(axis) {
    axis = Number(axis);
    var axes = lastStatus.axes || (lastHello && lastHello.axes) || [];
    var i;
    for (i = 0; i < axes.length; i++) {
      if (Number(axes[i].id) === axis) return axes[i];
    }
    return null;
  }

  function liveAxisCount() {
    var axes = (lastStatus && lastStatus.axes) || (lastHello && lastHello.axes) || [];
    return axes.length || 1;
  }

  function slotLine(cmd, axis, tok) {
    var n = Math.max(Number(axis) || 1, liveAxisCount());
    var parts = [cmd];
    var i;
    for (i = 1; i <= n; i++) {
      parts.push(i === Number(axis) ? tok : "_");
    }
    return parts.join(" ");
  }

  function softVal(axis, side) {
    var s = lastStatus.soft || {};
    var v;
    var ax;
    var key;
    axis = Number(axis);
    ax = axisEntry(axis);
    if (ax) {
      v = cfgNum(side === "min" ? ax.soft_min : ax.soft_max);
      if (v != null) return v;
    }
    if (axis <= 1) v = side === "min" ? s.min : s.max;
    else {
      key = (side === "min" ? "min" : "max") + String(axis);
      v = s[key];
    }
    if ((v == null || v === "") && lastStatus) {
      if (axis === 2) v = side === "min" ? lastStatus.soft_min_2 : lastStatus.soft_max_2;
      else v = side === "min" ? lastStatus.soft_min : lastStatus.soft_max;
    }
    if ((v == null || v === "") && lastHello && lastHello.soft) {
      s = lastHello.soft;
      if (axis <= 1) v = side === "min" ? s.min : s.max;
      else v = s[(side === "min" ? "min" : "max") + String(axis)];
    }
    return cfgNum(v);
  }

  function physicalVal(axis, side) {
    axis = Number(axis);
    var cfg = lastHello && lastHello.config;
    var axes = (cfg && cfg.axes) || (lastHello && lastHello.axes) || (rig && rig.axes) || [];
    var i, v;
    for (i = 0; i < axes.length; i++) {
      if (Number(axes[i].id) === axis) {
        v = cfgNum(side === "min" ? axes[i].min : axes[i].max);
        if (v != null) return v;
      }
    }
    if (!cfg) return null;
    if (axis <= 1) {
      v = side === "min" ? cfg.slider_min : cfg.slider_max;
      if (v == null) v = side === "min" ? cfg.MOTOR_1_min : cfg.MOTOR_1_max;
    } else {
      v = side === "min" ? cfg["slider_min_" + axis] : cfg["slider_max_" + axis];
      if (v == null) {
        v = side === "min" ? cfg["MOTOR_" + axis + "_min"] : cfg["MOTOR_" + axis + "_max"];
      }
    }
    return cfgNum(v);
  }

  function sendSoft(axis, side, posOrNone) {
    axis = Number(axis);
    var cmd = side === "min" ? "SL" : "SR";
    if (cfgNum(posOrNone) == null) {
      sendMc(slotLine(cmd, axis, "none"));
      return;
    }
    sendMc(slotLine(cmd, axis, Number(posOrNone).toFixed(2)));
  }

  function goSoft(axis, side) {
    var v = softVal(axis, side);
    if (v == null) return;
    sendMc(slotLine("MT", axis, v.toFixed(2)));
  }

  function syncLimitBtns() {
    var near = (typeof ABC_NEAR_MM === "number") ? ABC_NEAR_MM : 1.0;
    function nearTo(a, b) {
      return a != null && b != null && !isNaN(a) && !isNaN(b) && Math.abs(Number(a) - Number(b)) <= near;
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-btn='LIMIT_L'], [data-btn='LIMIT_R']"), function (el) {
      var ax = Number(el.getAttribute("data-ax"));
      var isLeft = el.getAttribute("data-btn") === "LIMIT_L";
      var side = limitSide(isLeft, ax);
      var lim = softVal(ax, side);
      var phys = physicalVal(ax, side);
      var has = lim != null;
      var live = currentPos(ax);
      var atPhys = nearTo(live, phys);
      var atSoft = has && nearTo(live, lim);
      el.classList.toggle("mark-unset", !has);
      el.classList.toggle("mark-here", !!(atSoft && !atPhys));
      el.classList.toggle("mark-end", !!atPhys);
      if (atPhys) {
        el.style.background = "#c42b2b";
        el.style.color = "#fff";
      } else if (atSoft) {
        el.style.background = "#2a9a4a";
        el.style.color = "#fff";
      } else if (has) {
        el.style.background = axisColor(ax);
        el.style.color = "";
      } else {
        el.style.background = "#2a333c";
        el.style.color = "#8a9aac";
      }
      var blocked = atPhys || atSoft;
      var row = el.parentNode;
      var lr = isLeft ? "L" : "R";
      function paintJog(btn) {
        if (!btn) return;
        btn.classList.toggle("mark-unset", !!blocked);
        if (blocked) {
          btn.style.background = "#2a333c";
          btn.style.color = "#8a9aac";
        } else {
          btn.style.background = axisColor(ax);
          btn.style.color = "";
        }
      }
      if (row) {
        paintJog(row.querySelector('[data-btn="MOVE_' + lr + '"]'));
        paintJog(row.querySelector('[data-btn="MOVE_' + lr + '2"]'));
        paintJog(row.querySelector('[data-btn="FAST_' + lr + '"]'));
        paintJog(row.querySelector('[data-btn="FAST_' + lr + '2"]'));
      }
    });
  }

  function bindLimitBtn(el) {
    if (el._limitBound) return;
    el._limitBound = true;
    var ax = Number(el.getAttribute("data-ax"));
    var isLeft = el.getAttribute("data-btn") === "LIMIT_L";
    var t3 = 0;
    var t5 = 0;
    var heldAct = false;
    function arm() {
      heldAct = false;
      var side = limitSide(isLeft, ax);
      if (t3) clearTimeout(t3);
      if (t5) clearTimeout(t5);
      t3 = setTimeout(function () {
        t3 = 0;
        heldAct = true;
        var pos = currentPos(ax);
        if (pos == null || isNaN(pos)) return;
        sendSoft(ax, side, pos);
      }, LIMIT_SET_MS);
      t5 = setTimeout(function () {
        t5 = 0;
        heldAct = true;
        sendSoft(ax, side, physicalVal(ax, side));
      }, LIMIT_RESET_MS);
    }
    function disarm() {
      if (t3) { clearTimeout(t3); t3 = 0; }
      if (t5) { clearTimeout(t5); t5 = 0; }
    }
    el.addEventListener("pointerdown", arm);
    el.addEventListener("pointerup", disarm);
    el.addEventListener("pointercancel", disarm);
    el.addEventListener("lostpointercapture", disarm);
    el.addEventListener("click", function (ev) {
      if (heldAct) {
        heldAct = false;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      goSoft(ax, limitSide(isLeft, ax));
    });
  }

  function applyStatus(s) {
    s = s || {};
    var incoming = s.axes || [];
    var prev = liveAxes();
    if (incoming.length && prev.length && incoming.length < prev.length) {
      incoming = prev.map(function (ax, i) {
        return incoming[i] || ax;
      });
      s.axes = incoming;
    }
    var prevMcState = lastStatus && lastStatus.state;
    lastStatus = s;
    if ((!s.axes || !s.axes.length) && prev.length) s.axes = prev;
    smOnMcState(prevMcState, s.state);
    var axes = s.axes || [];
    if (window.SWUi) SWUi.applyStatus(s);
    if (axes.length) renderInfo(axes);
    if (s.session && s.session.ss != null && !silentSeek) {
      cmdSpd = Number(s.session.ss);
      Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (el) {
        el.textContent = fmt(cmdSpd);
      });
    }
    updateAbcEtas();
    abcOnStatus();
    if (editor) {
      var live = {};
      axes.forEach(function (ax) {
        var id = Number(ax.id);
        if (!id) return;
        live[id] = Number(ax.pos);
      });
      editor.live = live;
      editor.draw();
    }
    if (silentSeek && silentSeek.armed && !mcBusy()) finishSilentSeek();
    if (preroll && preroll.seeking && !mcBusy()) {
      preroll.seeking = false;
      preroll.timer = setTimeout(function () {
        var fn = preroll && preroll.then;
        preroll = null;
        if (fn) fn();
      }, 1000);
    }
    syncMcLinkBanner(s);
    syncLimitBtns();
  }

  function setOfflineBanner(text, show) {
    var el = $("offline");
    if (!el) return;
    if (text) el.textContent = text;
    el.classList.toggle("hidden", !show);
  }

  function syncMcLinkBanner(d) {
    if (!d || typeof d !== "object") return;
    if (!ws || ws.readyState !== 1) return;
    if (d.sim || d.linked) {
      setOfflineBanner("Link lost…", false);
      return;
    }
    var reason = String(d.link_reason || "");
    var msg = "MC lost";
    if (reason === "not an MC" || reason.indexOf("protocol") === 0) {
      msg = "not an MC";
    }
    setOfflineBanner(msg, true);
  }

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var url = proto + "//" + location.host + "/ws";
    try { ws = new WebSocket(url); } catch (e) { return; }
    ws.onopen = function () {
      setOfflineBanner("Link lost…", false);
    };
    ws.onmessage = function (ev) {
      var o;
      try { o = JSON.parse(ev.data); } catch (e) { return; }
      if (o.t === "hello") applyHello(o);
      else if (o.t === "status") applyStatus(o);
      if (o.t === "hello" || o.t === "status") syncMcLinkBanner(o);
    };
    ws.onclose = function () {
      setOfflineBanner("Link lost…", true);
      setTimeout(connect, 800);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }

  function emitSs(force, el) {
    el = el || q(".js-spd");
    if (!el) return;
    var v = sliderToSpeed(Number(el.value) / 1000);
    cmdSpd = v;
    Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (n) { n.textContent = fmt(v); });
    var now = Date.now();
    if (!force && now - ssTimer < SS_MS) return;
    ssTimer = now;
    sendMc("SS " + v.toFixed(3));
  }

  function emitSa(el) {
    el = el && el.tagName ? el : q(".js-acc");
    if (!el) return;
    var t = Number(el.value) / 1000;
    var v = accMin + (accMax - accMin) * t;
    cmdAcc = v;
    Array.prototype.forEach.call(document.querySelectorAll(".js-sa-val"), function (n) { n.textContent = fmt(v); });
    sendMc("SA " + v.toFixed(3));
  }

  function poseLine(pose) {
    if (!pose) return null;
    var n = Math.max(3, liveAxisCount());
    var parts = [];
    var i, v, any;
    any = false;
    for (i = 1; i <= n; i++) {
      v = pose[i] != null ? pose[i] : pose[String(i)];
      if (v == null || isNaN(Number(v))) parts.push("_");
      else {
        parts.push(Number(v).toFixed(2));
        any = true;
      }
    }
    while (parts.length && parts[parts.length - 1] === "_") parts.pop();
    if (!any || !parts.length) return null;
    return "MT " + parts.join(" ");
  }

  function mcBusy() {
    var st = lastStatus && lastStatus.state;
    return st === "M" || st === "P" || st === "A" || st === "B" || st === "H";
  }

  function mcIdle() {
    if (playing) return false;
    var st = (lastStatus && lastStatus.state) || "?";
    return st === "I" || st === "D" || st === "?";
  }

  function envelopeMax() {
    var axes = liveAxes();
    var spd = spdMax;
    var acc = accMax;
    var i;
    var ax;
    for (i = 0; i < axes.length; i++) {
      ax = axes[i];
      if (!ax) continue;
      if (ax.max_spd != null && Number(ax.max_spd) > 0) {
        spd = Number(ax.max_spd);
        if (Number(ax.id) === 1 || ax.id == null) break;
      }
    }
    for (i = 0; i < axes.length; i++) {
      ax = axes[i];
      if (!ax) continue;
      if (ax.max_acc != null && Number(ax.max_acc) > 0) {
        acc = Number(ax.max_acc);
        if (Number(ax.id) === 1 || ax.id == null) break;
      }
    }
    if (window.SWUi) {
      if (typeof SWUi.spdMax === "function") spd = SWUi.spdMax() || spd;
      if (typeof SWUi.accMax === "function") acc = SWUi.accMax() || acc;
    }
    return { spd: spd, acc: acc };
  }

  function syncCtrlPlayBtns() {
    var idle = mcIdle();
    Array.prototype.forEach.call(document.querySelectorAll(
      ".js-ctrl-play, .js-ctrl-play-rev, .js-ctrl-play-from, .js-ctrl-play-from-rev"
    ), function (btn) {
      btn.disabled = !idle;
      btn.classList.toggle("disabled", !idle);
    });
  }

  function syncCtrlStatus() {
    var st = (lastStatus && lastStatus.state) || "?";
    if (st.length !== 1) st = "?";
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-state"), function (el) {
      el.textContent = st;
    });
    var l1 = lastStatus && lastStatus.line1 != null && lastStatus.line1 !== ""
      ? lastStatus.line1
      : "Ready";
    var l2 = (lastStatus && lastStatus.line2) || "";
    var warn = !!(lastStatus && lastStatus.warn);
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-line1"), function (el) {
      el.textContent = l1;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-line2"), function (el) {
      el.textContent = l2;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-oled"), function (el) {
      el.classList.toggle("warn", warn);
    });
    syncCtrlPlayBtns();
  }

  function syncSsSaUi() {
    Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (n) {
      n.textContent = fmt(cmdSpd);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-sa-val"), function (n) {
      n.textContent = fmt(cmdAcc);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-spd"), function (el) {
      el.value = String(Math.round(speedToSlider(cmdSpd)));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-acc"), function (el) {
      el.value = String(Math.round(((cmdAcc - accMin) / Math.max(1e-9, accMax - accMin)) * 1000));
    });
  }

  function setSessionSpeed(v) {
    v = Number(v);
    if (!isFinite(v)) return;
    if (v < spdMin) v = spdMin;
    if (v > spdMax) v = spdMax;
    cmdSpd = v;
    syncSsSaUi();
    if (window.SWUi && typeof SWUi.syncSpeedUi === "function") SWUi.syncSpeedUi(v);
    sendMc("SS " + v.toFixed(3));
  }

  function setSessionAccel(v) {
    v = Number(v);
    if (!isFinite(v)) return;
    if (v < accMin) v = accMin;
    if (v > accMax) v = accMax;
    cmdAcc = v;
    syncSsSaUi();
    if (window.SWUi && typeof SWUi.syncAccelUi === "function") SWUi.syncAccelUi(v);
    sendMc("SA " + v.toFixed(3));
  }

  function sessionSpd() {
    if (window.SWUi && typeof SWUi.sessionSpeed === "function") {
      var v = SWUi.sessionSpeed();
      if (v != null && !isNaN(v)) return Number(v);
    }
    return Number(cmdSpd);
  }

  function sessionAcc() {
    if (window.SWUi && typeof SWUi.sessionAccel === "function") {
      var v = SWUi.sessionAccel();
      if (v != null && !isNaN(v)) return Number(v);
    }
    return Number(cmdAcc);
  }

  function restoreSessionSsSa() {
    var spd = sessionSpd();
    var acc = sessionAcc();
    if (isFinite(spd)) sendMc("SS " + spd.toFixed(3), true);
    if (isFinite(acc)) sendMc("SA " + acc.toFixed(3), true);
  }

  function finishSilentSeek() {
    if (!silentSeek) return;
    var cb = silentSeek.onIdle;
    if (silentSeek.timer) clearTimeout(silentSeek.timer);
    silentSeek = null;
    window.__shSilentSsSa = false;
    restoreSessionSsSa();
    if (cb) cb();
  }

  function seekAtMax(pose) {
    var mx = envelopeMax();
    sendMc("SS " + mx.spd.toFixed(3), true);
    sendMc("SA " + mx.acc.toFixed(3), true);
    sendMc("SE 1");
    var line = poseLine(pose);
    if (line) sendMc(line);
    if (silentSeek && silentSeek.timer) clearTimeout(silentSeek.timer);
    silentSeek = { armed: false, onIdle: null, timer: 0 };
    window.__shSilentSsSa = true;
    silentSeek.timer = setTimeout(function () {
      if (!silentSeek) return;
      silentSeek.armed = true;
      if (!mcBusy()) finishSilentSeek();
    }, 150);
  }

  function poseOffEndpoint(target) {
    if (!editor) return false;
    var off = false;
    editor.lanes.forEach(function (ln) {
      if (!editor.visible[ln.id]) return;
      var live = currentPos(ln.id);
      if (live == null) return;
      var want = target[ln.id];
      if (want == null) return;
      if (Math.abs(live - want) > 0.1) off = true;
    });
    return off;
  }

  function onPlayhead(t, commit, force) {
    if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
    syncCtrlReadouts();
    smSyncFromPlayhead(t);
    if (!commit || !editor) return;
    var now = Date.now();
    if (!force && now - mtTimer < SS_MS) return;
    mtTimer = now;
    var pose = editor.poseAt(t);
    var line = poseLine(pose);
    if (line) {
      sendMc("SE 1");
      sendMc(line);
    }
  }

  function browserBeep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.1);
    } catch (e) {}
  }

  function fireMarker(mk) {
    if (!mk) return;
    if (mk.beep) {
      sendMc("BE");
      browserBeep();
    }
    if (mk.bloop) send({ bloop: 1 });
    var n, v;
    for (n = 1; n <= 4; n++) {
      v = mk["ext" + n];
      if (v == null) continue;
      sendMc("EO" + n + " " + (v ? "1" : "0"));
    }
    if (mk.camera) sendMc("CT");
  }

  function fireMarkersCrossing(prevT, nextT, dir) {
    if (!editor) return;
    (editor.markers || []).forEach(function (m) {
      var t = Number(m.t);
      if (dir > 0 && prevT < t && nextT >= t) fireMarker(m);
      if (dir < 0 && prevT > t && nextT <= t) fireMarker(m);
    });
  }

  function cancelTimelinePlay() {
    if (preroll) {
      if (preroll.timer) clearTimeout(preroll.timer);
      preroll = null;
    }
    if (silentSeek) finishSilentSeek();
    playing = false;
    if (editor) editor.playing = false;
    if (playRaf) {
      cancelAnimationFrame(playRaf);
      playRaf = 0;
    }
    syncCtrlPlayBtns();
  }
  window.__shCancelTimelinePlay = cancelTimelinePlay;

  function startPlayClock(fromT, toT, dir) {
    playing = true;
    playDir = dir;
    playhead0 = fromT;
    playEndT = toT;
    playLastT = fromT;
    playT0 = performance.now();
    if (editor) {
      editor.playing = true;
      editor.playhead = fromT;
      editor.draw();
    }
    fireMarkersCrossing(fromT - 1e-6, fromT, dir);
    syncCtrlPlayBtns();
    function tick(now) {
      if (!playing || !editor) return;
      var t = playhead0 + playDir * ((now - playT0) / 1000);
      if ((dir > 0 && t >= playEndT) || (dir < 0 && t <= playEndT)) {
        t = playEndT;
        fireMarkersCrossing(playLastT, t, dir);
        editor.playhead = t;
        if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
        playing = false;
        editor.playing = false;
        editor.draw();
        playRaf = 0;
        syncCtrlPlayBtns();
        return;
      }
      fireMarkersCrossing(playLastT, t, dir);
      playLastT = t;
      editor.playhead = t;
      if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
      editor.draw();
      playRaf = requestAnimationFrame(tick);
    }
    playRaf = requestAnimationFrame(tick);
  }

  function sampleDeltas(fromT, toT, hz) {
    hz = Number(hz);
    if (!(hz > 0)) hz = (editor && editor.playHz) || 50;
    var dt = 1 / hz;
    var samples = [];
    var n = Math.ceil(Math.max(0, toT - fromT) / dt);
    if (n > pathBufferSize) return null;
    var nAx = Math.max(1, Math.min(6, liveAxisCount()));
    var prev = editor.poseAt(fromT);
    var i, j, t, pose, row, d;
    for (i = 1; i <= n; i++) {
      t = fromT + i * dt;
      if (t > toT) t = toT;
      pose = editor.poseAt(t);
      row = [];
      for (j = 1; j <= nAx; j++) {
        d = Math.round(((pose[j] || 0) - (prev[j] || 0)) * 1000);
        if (d > 32767) d = 32767;
        if (d < -32768) d = -32768;
        row.push(d);
      }
      samples.push(row);
      prev = pose;
    }
    return samples;
  }

  function sendPath(samples, thenClock, opts) {
    if (!samples || !samples.length) return;
    opts = opts || {};
    var hz = Number(opts.hz);
    if (!(hz > 0)) hz = (editor && editor.playHz) || 50;
    var sliceUs = opts.sliceUs != null ? Number(opts.sliceUs) : Math.round(1e6 / hz);
    if (!(sliceUs > 0)) sliceUs = Math.round(1e6 / hz);
    send({ path: { cmd: "begin", slice_us: sliceUs } });
    var chunk = [];
    var i;
    function flush() {
      if (!chunk.length) return;
      send({ path: { cmd: "data", samples: chunk } });
      chunk = [];
    }
    for (i = 0; i < samples.length; i++) {
      chunk.push(samples[i]);
      if (chunk.length >= 40) flush();
    }
    flush();
    if (opts.go !== false) send({ path: { cmd: "go" } });
    if (thenClock) thenClock();
  }

  function fmtTlArg(v) {
    var n = Number(v);
    if (isNaN(n)) return "0.000000";
    return n.toFixed(6);
  }

  function tlPathFps() {
    var n = Number(project && project.frame_rate);
    return n > 0 ? n : 30;
  }

  function startTimelineTimelapse() {
    if (!mcIdle()) return;
    if (!editor) {
      if (window.SWUi && typeof SWUi.showUiError === "function") SWUi.showUiError("No timeline");
      return;
    }
    if (editor.hasLimitViolation()) {
      if (window.SWUi && typeof SWUi.showUiError === "function") SWUi.showUiError("Limit bands");
      return;
    }
    var mot = editor.motionDuration();
    if (!(mot > 0)) {
      if (window.SWUi && typeof SWUi.showUiError === "function") SWUi.showUiError("No motion");
      return;
    }
    var fps = tlPathFps();
    var samples = sampleDeltas(0, mot, fps);
    if (!samples || !samples.length) {
      if (window.SWUi && typeof SWUi.showUiError === "function") SWUi.showUiError("Path too long");
      return;
    }
    var factor = tlFactorNow();
    if (isNaN(factor) || factor < 3) factor = 3;
    var trigTime = factor / fps;
    if (trigTime < 0.2) trigTime = 0.2;
    var trigLen = 0.1;
    if (window.SWUi && typeof SWUi.tlExposure === "function") trigLen = SWUi.tlExposure();
    var msm = !!(window.SWUi && typeof SWUi.tlMsm === "function" && SWUi.tlMsm());
    function go() {
      sendPath(samples, null, { hz: fps, go: false });
      if (msm) {
        send({ task: "TSK_TL_PATH_MSM " + fmtTlArg(trigTime) + " " + fmtTlArg(trigLen) });
      } else {
        send({
          task:
            "TSK_TL_PATH_CONT " +
            fmtTlArg(factor) +
            " " +
            fmtTlArg(trigTime) +
            " " +
            fmtTlArg(trigLen)
        });
      }
    }
    var endpoint = editor.poseAt(0);
    if (!poseOffEndpoint(endpoint)) {
      go();
      return;
    }
    cancelTimelinePlay();
    seekAtMax(endpoint);
    editor.playhead = 0;
    editor.draw();
    if ($("tlTime")) $("tlTime").textContent = "0.00 s";
    preroll = { seeking: true, then: go };
    if (!mcBusy()) {
      preroll.seeking = false;
      preroll.timer = setTimeout(function () {
        var fn = preroll && preroll.then;
        preroll = null;
        if (fn) fn();
      }, 1000);
    }
  }

  function playGraph(mode) {
    if (!mcIdle()) return;
    if (!editor || editor.hasLimitViolation()) return;
    var dur = editor.playDuration();
    var mot = editor.motionDuration();
    if (mot <= 0) return;
    var fromT, toT, dir, samples;
    if (mode === "rev") {
      fromT = mot;
      toT = 0;
      dir = -1;
      samples = sampleDeltas(0, mot);
      if (!samples) return;
      samples.reverse();
      samples.forEach(function (s) {
        var j;
        for (j = 0; j < s.length; j++) s[j] = -s[j];
      });
    } else if (mode === "fromRev") {
      fromT = editor.playhead;
      toT = 0;
      dir = -1;
      if (fromT <= 1e-6) return;
      samples = sampleDeltas(0, fromT);
      if (!samples) return;
      samples.reverse();
      samples.forEach(function (s) {
        var j;
        for (j = 0; j < s.length; j++) s[j] = -s[j];
      });
    } else if (mode === "from") {
      fromT = editor.playhead;
      toT = dur;
      dir = 1;
      if (fromT >= mot - 1e-6) return;
      samples = sampleDeltas(fromT, mot);
      if (!samples) return;
    } else {
      fromT = 0;
      toT = dur;
      dir = 1;
      samples = sampleDeltas(0, mot);
      if (!samples) return;
    }
    function go() {
      editor.playhead = fromT;
      sendPath(samples, function () { startPlayClock(fromT, toT, dir); });
    }
    var endpoint = editor.poseAt(mode === "rev" ? mot : fromT);
    if (!poseOffEndpoint(endpoint)) {
      go();
      return;
    }
    cancelTimelinePlay();
    seekAtMax(endpoint);
    editor.playhead = fromT;
    editor.draw();
    if ($("tlTime")) $("tlTime").textContent = fromT.toFixed(2) + " s";
    preroll = { seeking: true, then: go };
    if (!mcBusy()) {
      preroll.seeking = false;
      preroll.timer = setTimeout(function () {
        var fn = preroll && preroll.then;
        preroll = null;
        if (fn) fn();
      }, 1000);
    }
  }

  function currentPos(id) {
    id = Number(id);
    var axes = lastStatus.axes || [];
    var i;
    for (i = 0; i < axes.length; i++) {
      if (Number(axes[i].id) === id) return axes[i].pos;
    }
    if (id === 1 && lastStatus.pos != null) return lastStatus.pos;
    if (id === 2 && lastStatus.pos2 != null) return lastStatus.pos2;
    return null;
  }

  function markLine(m) {
    return poseLine(m);
  }

  function jogAxisOf(name, ax) {
    if (name && name.charAt(name.length - 1) === "2") return 2;
    ax = Number(ax);
    return ax > 0 ? ax : 1;
  }

  function sendJog(dir, ax, fast) {
    ax = Number(ax) || 1;
    var swap = false;
    var n;
    var parts;
    var i;
    var pct;
    if (window.SWUi) {
      if (ax === 2 && typeof SWUi.swapDir2 === "function") swap = !!SWUi.swapDir2();
      else if (typeof SWUi.swapDir === "function") swap = !!SWUi.swapDir();
    }
    if (swap) dir = -dir;
    if (fast) sendMc("SS " + spdMax);
    if (ax <= 1) {
      sendMc(dir < 0 ? "MJ -100" : "MJ 100");
      return;
    }
    n = Math.max(ax, liveAxisCount());
    pct = dir < 0 ? "-100" : "100";
    parts = ["MJ"];
    for (i = 1; i <= n; i++) parts.push(i === ax ? pct : "0");
    sendMc(parts.join(" "));
  }

  function onBtn(name, isDown, longHold, ax) {
    var axis = jogAxisOf(name, ax);
    var run = isDown || !longHold;
    if (name === "STOP") {
      cancelTimelinePlay();
      cancelAbcLoop();
      sendMc("MS");
      return;
    }
    if (name === "HOME") { sendMc("MH"); return; }
    if (name === "MOVE_L" || name === "MOVE_L2") {
      if (run) sendJog(-1, axis, false);
      else sendMc("MS");
    }
    if (name === "MOVE_R" || name === "MOVE_R2") {
      if (run) sendJog(1, axis, false);
      else sendMc("MS");
    }
    if (name === "FAST_L" || name === "FAST_L2") {
      if (isDown) sendJog(-1, axis, true);
      else { sendMc("MS"); sendMc("SS " + cmdSpd); }
    }
    if (name === "FAST_R" || name === "FAST_R2") {
      if (isDown) sendJog(1, axis, true);
      else { sendMc("MS"); sendMc("SS " + cmdSpd); }
    }
    if (name === "SET_A") marks.a = { 1: currentPos(1), 2: currentPos(2) };
    if (name === "SET_B") marks.b = { 1: currentPos(1), 2: currentPos(2) };
    if (name === "SET_C") marks.c = { 1: currentPos(1), 2: currentPos(2) };
  }

  var ABC_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];
  var ABC_NEAR_MM = 1.0;
  var SET_HOLD_MS = 3000;
  var abcWaits = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 };
  var abcUse = { a: false, b: false, c: false, d: false, e: false, f: false, g: false, h: false };
  var abcSeq = { mode: null, letters: [], idx: 0, dir: 1, phase: "idle", waitTimer: 0, skipTimer: 0, target: null };

  function clampMarkCount(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = 4;
    if (n < 2) n = 2;
    if (n > 8) n = 8;
    return n;
  }

  function markCount() {
    return clampMarkCount(project && project.mark_count);
  }

  function markLetters() {
    return ABC_LETTERS.slice(0, markCount());
  }

  function abcAsPose(v) {
    if (window.SWUi && typeof SWUi.asPose === "function") return SWUi.asPose(v);
    if (v == null) return null;
    var out = {};
    var i;
    var pv;
    if (typeof v === "number") return isNaN(v) ? null : { 1: v };
    if (Array.isArray(v)) {
      if (!v.length) return null;
      for (i = 0; i < v.length && i < 8; i++) {
        pv = v[i];
        if (pv == null || pv === "" || isNaN(Number(pv))) continue;
        out[i + 1] = Number(pv);
      }
      return out[1] == null ? null : out;
    }
    if (typeof v !== "object") return null;
    for (i = 1; i <= 8; i++) {
      pv = v[i] != null ? v[i] : v[String(i)];
      if (pv == null || pv === "" || isNaN(Number(pv))) continue;
      out[i] = Number(pv);
    }
    return out[1] == null ? null : out;
  }

  function getAbcPose(letter) {
    var m = (window.SWUi && typeof SWUi.getMark === "function") ? SWUi.getMark(letter) : marks[letter];
    return abcAsPose(m);
  }

  function hasAbcPose(letter) {
    return !!getAbcPose(letter);
  }

  function getLetterMarkPose(letter) {
    if (!editor || typeof editor.letterMarker !== "function") return null;
    var mk = editor.letterMarker(letter);
    if (!mk) return null;
    return editor.poseAt(mk.t);
  }

  function hasLetterMark(letter) {
    return !!(editor && typeof editor.letterMarker === "function" && editor.letterMarker(letter));
  }

  function letterMarkHere(letter) {
    var pose = getLetterMarkPose(letter);
    var live = currentPos(1);
    if (!pose || live == null || isNaN(live) || pose[1] == null || isNaN(Number(pose[1]))) return false;
    return Math.abs(Number(pose[1]) - live) <= ABC_NEAR_MM;
  }

  function posedLetters() {
    return markLetters().filter(hasAbcPose);
  }

  function speedFromTimeAbc(time, distance, accel) {
    var T = Number(time);
    var d = Math.abs(Number(distance));
    var a = Number(accel);
    if (!(T > 0) || !(d >= 0) || isNaN(T) || isNaN(d)) return null;
    if (!(a > 0) || isNaN(a)) return d / T;
    var tMin = 2 * Math.sqrt(d / a);
    if (T < tMin) return Math.sqrt(a * d);
    var disc = (a * T) * (a * T) - 4 * a * d;
    if (disc < 0) return Math.sqrt(a * d);
    return (a * T - Math.sqrt(disc)) / 2;
  }

  function clampAbcWait(v, min, max) {
    var t = Number(v);
    if (isNaN(t)) t = min;
    if (t < min) t = min;
    if (t > max) t = max;
    return Math.round(t * 10) / 10;
  }

  function fmtAbcWait(v) {
    return Number(v).toFixed(1);
  }

  function poseNearAbc(pose) {
    if (!pose || pose[1] == null || isNaN(Number(pose[1]))) return false;
    var i;
    var v;
    var live;
    for (i = 1; i <= 8; i++) {
      v = pose[i] != null ? pose[i] : pose[String(i)];
      if (v == null || v === "" || isNaN(Number(v))) continue;
      live = currentPos(i);
      if (live == null || isNaN(live)) return false;
      if (Math.abs(live - Number(v)) > ABC_NEAR_MM) return false;
    }
    return true;
  }

  function inAbDlg(el) {
    return !!(el && el.closest && el.closest(".ab-col"));
  }

  function setEtaCell(el, sec, here) {
    if (!el) return;
    var intEl = el.querySelector(".int");
    var fracEl = el.querySelector(".frac");
    if (sec == null || isNaN(sec)) {
      el.classList.remove("here");
      if (intEl) intEl.textContent = "—";
      if (fracEl) fracEl.textContent = "—";
      return;
    }
    el.classList.toggle("here", !!here);
    var s = Number(sec).toFixed(1);
    var i = s.indexOf(".");
    if (intEl) intEl.textContent = i < 0 ? s : s.slice(0, i);
    if (fracEl) fracEl.textContent = i < 0 ? "0" : s.slice(i + 1);
  }

  function updateAbcEtas() {
    var live = currentPos(1);
    var spd = cmdSpd;
    if (window.SWUi && typeof SWUi.sessionSpeed === "function") {
      var ss = SWUi.sessionSpeed();
      if (ss != null && !isNaN(ss)) spd = ss;
    }
    Array.prototype.forEach.call(document.querySelectorAll(".abc-block"), function (block) {
      var k = block.getAttribute("data-mark");
      var cell = block.querySelector(".abc-eta");
      var pose = getAbcPose(k);
      if (!pose || live == null || isNaN(live)) {
        setEtaCell(cell, null, false);
        return;
      }
      var d = Math.abs(pose[1] - live);
      var here = d <= ABC_NEAR_MM;
      var sec = here ? 0 : (spd > 0 ? d / spd : null);
      setEtaCell(cell, sec, inAbDlg(block) ? false : here);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".abc-bar-eta, .tl-bar-eta"), function (cell) {
      var k = cell.getAttribute("data-mark");
      var pose = getAbcPose(k);
      if (!pose || live == null || isNaN(live)) {
        setEtaCell(cell, null, false);
        return;
      }
      var d = Math.abs(pose[1] - live);
      var here = d <= ABC_NEAR_MM;
      var sec = here ? 0 : (spd > 0 ? d / spd : null);
      setEtaCell(cell, sec, here);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-tl-eta"), function (cell) {
      var k = cell.getAttribute("data-mark");
      var pose = getLetterMarkPose(k);
      if (!pose || live == null || isNaN(live) || pose[1] == null || isNaN(Number(pose[1]))) {
        setEtaCell(cell, null, false);
        return;
      }
      var d = Math.abs(Number(pose[1]) - live);
      var here = d <= ABC_NEAR_MM;
      var sec = here ? 0 : (spd > 0 ? d / spd : null);
      setEtaCell(cell, sec, here);
    });
    var factor = tlFactorNow();
    var mot = editor ? editor.motionDuration() : 0;
    var pathSec = mot > 0 ? mot * factor : null;
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-path-eta"), function (cell) {
      setEtaCell(cell, pathSec, false);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tl-bar-eta-min"), function (cell) {
      var k = cell.getAttribute("data-mark");
      var pose = getAbcPose(k);
      if (!pose || live == null || isNaN(live)) {
        setEtaCell(cell, null, false);
        return;
      }
      var d = Math.abs(pose[1] - live);
      var here = d <= ABC_NEAR_MM;
      var sec = here ? 0 : (spd > 0 ? d / spd : null);
      var mins = sec == null ? null : (sec * factor) / 60;
      setEtaCell(cell, mins, here);
    });
    syncMarkBtns();
  }

  function tlFactorNow() {
    if (window.SWUi && typeof SWUi.tlFactor === "function") {
      var f = SWUi.tlFactor();
      if (f != null && !isNaN(f) && f >= 3) return f;
    }
    var el = document.querySelector(".js-tl-factor");
    var t = Number(el && el.value);
    if (isNaN(t) || t < 3) t = 3;
    return t;
  }

  function etaCellHtml(k, extraClass, unit) {
    return (
      '<div class="abc-eta eta-cell ' + extraClass + '" data-mark="' + k + '">' +
        '<span class="num"><span class="int">—</span>.<span class="frac">—</span></span>' +
        '<span class="u">' + unit + "</span>" +
      "</div>"
    );
  }

  function bindHoldSet(btn, onClick, onHold) {
    if (!btn || btn._holdSet) return;
    btn._holdSet = true;
    var timer = 0;
    var didHold = false;
    var k = markLetterOf(btn);
    function arm() {
      didHold = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = 0;
        didHold = true;
        if (onHold) onHold();
        else abcSet(k);
      }, SET_HOLD_MS);
    }
    function disarm() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    }
    btn.addEventListener("pointerdown", arm);
    btn.addEventListener("pointerup", disarm);
    btn.addEventListener("pointercancel", disarm);
    btn.addEventListener("lostpointercapture", disarm);
    btn.addEventListener("click", function (ev) {
      if (didHold) {
        didHold = false;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      if (onClick) onClick();
    });
  }

  function markLetterOf(el) {
    if (!el) return null;
    if (el.getAttribute("data-mark")) return el.getAttribute("data-mark");
    var block = el.closest && el.closest("[data-mark]");
    return block ? block.getAttribute("data-mark") : null;
  }

  function markHereAxis1(k) {
    var pose = getAbcPose(k);
    var live = currentPos(1);
    if (!pose || live == null || isNaN(live)) return false;
    return Math.abs(pose[1] - live) <= ABC_NEAR_MM;
  }

  function syncMarkBtns() {
    Array.prototype.forEach.call(document.querySelectorAll(".abc-move, .abc-fast, .tl-go, .tl-fast"), function (btn) {
      var k = markLetterOf(btn);
      var set = !!(k && hasAbcPose(k));
      btn.classList.toggle("mark-unset", !set);
      if (inAbDlg(btn)) btn.classList.remove("mark-here");
      else btn.classList.toggle("mark-here", !!(set && markHereAxis1(k)));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-tl-move, .js-ab-tl-fast, .js-ab-tl-set"), function (btn) {
      var k = markLetterOf(btn);
      var set = !!(k && hasLetterMark(k));
      btn.classList.toggle("mark-unset", !set);
      btn.classList.toggle("mark-here", !!(set && letterMarkHere(k)));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".abc-set"), function (btn) {
      var k = markLetterOf(btn);
      if (inAbDlg(btn)) btn.classList.remove("mark-here");
      else btn.classList.toggle("mark-here", !!(k && hasAbcPose(k) && markHereAxis1(k)));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".ab-col"), function (col) {
      var k = col.getAttribute("data-mark");
      col.classList.toggle("here", !!(k && hasAbcPose(k) && poseNearAbc(getAbcPose(k))));
    });
  }

  function syncAbcUseUi() {
    Array.prototype.forEach.call(document.querySelectorAll(".abc-block"), function (block) {
      var k = block.getAttribute("data-mark");
      var inp = block.querySelector(".abc-use-in");
      if (!inp) return;
      var ok = hasAbcPose(k);
      inp.disabled = !ok;
      if (!ok) abcUse[k] = false;
      inp.checked = !!(ok && abcUse[k]);
    });
    var posed = posedLetters();
    Array.prototype.forEach.call(document.querySelectorAll(".js-abc-all"), function (inp) {
      inp.disabled = !posed.length;
      inp.checked = posed.length > 0 && posed.every(function (k) { return !!abcUse[k]; });
    });
  }

  function abcApplyMaxSession() {
    cmdSpd = spdMax;
    cmdAcc = accMax;
    sendMc("SA " + accMax.toFixed(3));
    sendMc("SS " + spdMax.toFixed(3));
    if (window.SWUi) {
      if (typeof SWUi.syncAccelUi === "function") SWUi.syncAccelUi(accMax);
      if (typeof SWUi.syncSpeedUi === "function") SWUi.syncSpeedUi(spdMax);
    }
    Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (n) {
      n.textContent = fmt(cmdSpd);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-sa-val"), function (n) {
      n.textContent = fmt(cmdAcc);
    });
  }

  function abcSet(k) {
    var p1 = currentPos(1);
    if (p1 == null || isNaN(p1)) return;
    var n = Math.max(1, liveAxisCount());
    var pose = { 1: p1 };
    var i;
    var p;
    for (i = 2; i <= n; i++) {
      p = currentPos(i);
      if (p == null || isNaN(p)) continue;
      pose[i] = p;
    }
    marks[k] = pose;
    if (window.SWUi && typeof SWUi.setMarkPose === "function") SWUi.setMarkPose(k, pose);
    abcUse[k] = true;
    syncAbcUseUi();
    updateAbcEtas();
  }

  function abcClear(k) {
    marks[k] = null;
    abcUse[k] = false;
    if (window.SWUi && typeof SWUi.clearMark === "function") SWUi.clearMark(k);
    syncAbcUseUi();
    updateAbcEtas();
  }

  function abcMoveToPose(pose, fast) {
    if (!pose) return;
    var line = markLine(pose);
    if (!line) return;
    if (fast) abcApplyMaxSession();
    sendMc(line);
  }

  function abcMove(k, fast) {
    abcMoveToPose(getAbcPose(k), fast);
  }

  function abcSetLetterMark(k) {
    if (!editor || typeof editor.setLetterAtPlayhead !== "function") return;
    editor.setLetterAtPlayhead(k);
    updateAbcEtas();
  }

  function abcClearLetterMark(k) {
    if (!editor || typeof editor.clearLetter !== "function") return;
    editor.clearLetter(k);
    updateAbcEtas();
  }

  function abcMoveLetterMark(k, fast) {
    if (!editor || typeof editor.letterMarker !== "function") return;
    var mk = editor.letterMarker(k);
    if (!mk) return;
    var t = editor.clampT(mk.t);
    editor.playhead = t;
    editor.draw();
    if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
    syncCtrlReadouts();
    abcMoveToPose(editor.poseAt(t), fast);
  }

  function firstCheckedMark() {
    var letters = markLetters();
    for (var i = 0; i < letters.length; i++) {
      var k = letters[i];
      if (abcUse[k] && hasAbcPose(k)) return k;
    }
    return null;
  }

  function onAbcSetSpeed(ev) {
    var k = firstCheckedMark();
    if (!k) return;
    var pose = getAbcPose(k);
    var live = currentPos(1);
    if (!pose || live == null || isNaN(live)) return;
    var panel = ev && ev.target && ev.target.closest ? ev.target.closest(".abc-panel") : null;
    var timeEl = (panel && panel.querySelector(".js-abc-time")) || q(".js-abc-time");
    var T = clampAbcWait(timeEl && timeEl.value, 0.1, 60);
    if (timeEl) timeEl.value = fmtAbcWait(T);
    Array.prototype.forEach.call(document.querySelectorAll(".js-abc-time"), function (el) {
      el.value = fmtAbcWait(T);
    });
    var a = cmdAcc;
    if (window.SWUi && typeof SWUi.sessionAccel === "function") {
      var sa = SWUi.sessionAccel();
      if (sa != null && !isNaN(sa)) a = sa;
    }
    var fn = (window.SWUi && SWUi.speedFromTime) || speedFromTimeAbc;
    var v = fn(T, Math.abs(live - pose[1]), a);
    if (v == null || isNaN(v)) return;
    var mn = spdMin;
    var mx = spdMax;
    if (window.SWUi) {
      if (typeof SWUi.spdMin === "function") mn = SWUi.spdMin();
      if (typeof SWUi.spdMax === "function") mx = SWUi.spdMax();
    }
    v = Math.max(mn, Math.min(mx, v));
    cmdSpd = v;
    sendMc("SS " + v.toFixed(3));
    if (window.SWUi && typeof SWUi.syncSpeedUi === "function") SWUi.syncSpeedUi(v);
    Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (n) {
      n.textContent = fmt(v);
    });
    updateAbcEtas();
  }

  function onAbcAllClick(ev) {
    ev.preventDefault();
    var posed = posedLetters();
    if (!posed.length) return;
    var allOn = posed.every(function (k) { return !!abcUse[k]; });
    posed.forEach(function (k) { abcUse[k] = !allOn; });
    ABC_LETTERS.forEach(function (k) {
      if (posed.indexOf(k) < 0) abcUse[k] = false;
    });
    syncAbcUseUi();
  }

  function cancelAbcLoop() {
    if (abcSeq.waitTimer) clearTimeout(abcSeq.waitTimer);
    if (abcSeq.skipTimer) clearTimeout(abcSeq.skipTimer);
    abcSeq.mode = null;
    abcSeq.letters = [];
    abcSeq.idx = 0;
    abcSeq.dir = 1;
    abcSeq.phase = "idle";
    abcSeq.waitTimer = 0;
    abcSeq.skipTimer = 0;
    abcSeq.target = null;
  }

  function selectedAbcLetters() {
    return markLetters().filter(function (k) { return abcUse[k] && hasAbcPose(k); });
  }

  function abcAdvance() {
    if (!abcSeq.mode) return;
    var n = abcSeq.letters.length;
    if (n < 2) {
      cancelAbcLoop();
      return;
    }
    if (abcSeq.mode === "loop") {
      abcSeq.idx = (abcSeq.idx + 1) % n;
    } else {
      abcSeq.idx += abcSeq.dir;
      if (abcSeq.idx >= n) {
        abcSeq.dir = -1;
        abcSeq.idx = n - 2;
      } else if (abcSeq.idx < 0) {
        abcSeq.dir = 1;
        abcSeq.idx = 1;
      }
    }
    abcVisit();
  }

  function abcVisit() {
    if (!abcSeq.mode) return;
    var k = abcSeq.letters[abcSeq.idx];
    var pose = getAbcPose(k);
    abcSeq.target = k;
    if (!pose) {
      abcSeq.skipTimer = setTimeout(abcAdvance, 0);
      return;
    }
    if (poseNearAbc(pose)) {
      abcSeq.phase = "idle";
      abcSeq.skipTimer = setTimeout(abcAdvance, 0);
      return;
    }
    abcSeq.phase = "move";
    sendMc(markLine(pose));
  }

  function abcOnStatus() {
    if (!abcSeq.mode || abcSeq.phase !== "move") return;
    var pose = getAbcPose(abcSeq.target);
    if (!poseNearAbc(pose)) return;
    abcSeq.phase = "wait";
    var w = abcWaits[abcSeq.target] || 0;
    if (!(w > 0)) {
      abcAdvance();
      return;
    }
    abcSeq.waitTimer = setTimeout(function () {
      abcSeq.waitTimer = 0;
      if (!abcSeq.mode) return;
      abcAdvance();
    }, w * 1000);
  }

  function startAbcSeq(mode) {
    var letters = selectedAbcLetters();
    if (letters.length < 2) return;
    cancelAbcLoop();
    abcApplyMaxSession();
    abcSeq.mode = mode;
    abcSeq.letters = letters;
    abcSeq.idx = 0;
    abcSeq.dir = 1;
    abcVisit();
  }

  function fillAbcBlocks() {
    var letters = markLetters();
    var n = letters.length;
    Array.prototype.forEach.call(document.querySelectorAll(".abc-marks"), function (box) {
      box.style.gridTemplateColumns = "repeat(" + n + ", minmax(0, 1fr))";
      var html = "";
      letters.forEach(function (k) {
        html += '<button type="button" class="btn ochre abc-move" data-mark="' + k + '">▶' + k.toUpperCase() + "</button>";
      });
      letters.forEach(function (k) {
        html += '<button type="button" class="btn ochre abc-fast" data-mark="' + k + '">▶▶' + k.toUpperCase() + "</button>";
      });
      letters.forEach(function (k) {
        html += etaCellHtml(k, "abc-bar-eta", "s");
      });
      box.innerHTML = html;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".abc-blocks"), function (box) {
      box.innerHTML = letters.map(function (k) {
        var L = k.toUpperCase();
        return (
          '<div class="abc-block" data-mark="' + k + '">' +
            '<div class="abc-sep"><span>' + L + "</span></div>" +
            '<div class="abc-grid">' +
              '<button type="button" class="btn ochre abc-move" data-mark="' + k + '">▶' + L + "</button>" +
              '<button type="button" class="btn ochre abc-fast" data-mark="' + k + '">▶▶' + L + "</button>" +
              '<button type="button" class="btn ochre abc-set" data-mark="' + k + '">⚑</button>' +
              '<label class="abc-use">' +
                '<input type="checkbox" class="abc-use-in" disabled>' +
                '<span class="switch-ui" aria-hidden="true"></span>' +
              "</label>" +
              '<div class="abc-eta eta-cell">' +
                '<span class="num"><span class="int">—</span>.<span class="frac">—</span></span>' +
                '<span class="u">s</span>' +
              "</div>" +
              '<span class="abc-wait-lab">Wait time [s]</span>' +
              '<input type="number" class="abc-wait" inputmode="decimal" step="0.1" min="0" max="60" value="' +
                fmtAbcWait(abcWaits[k]) + '">' +
              "<span></span>" +
            "</div>" +
          "</div>"
        );
      }).join("");
    });
    bindAbc();
    syncAbcUseUi();
    updateAbcEtas();
  }

  function bindAbc() {
    Array.prototype.forEach.call(document.querySelectorAll(".abc-panel"), function (panel) {
      if (!panel._abcBound) {
        panel._abcBound = true;
        var all = panel.querySelector(".js-abc-all");
        if (all) all.addEventListener("click", onAbcAllClick);
        var loop = panel.querySelector(".js-abc-loop");
        if (loop) loop.addEventListener("click", function () { startAbcSeq("loop"); });
        var pp = panel.querySelector(".js-abc-pp");
        if (pp) pp.addEventListener("click", function () { startAbcSeq("pp"); });
        var setSp = panel.querySelector(".js-abc-set-speed");
        if (setSp) setSp.addEventListener("click", onAbcSetSpeed);
        var time = panel.querySelector(".js-abc-time");
        if (time) {
          time.addEventListener("change", function () {
            var t = clampAbcWait(time.value, 0.1, 60);
            Array.prototype.forEach.call(document.querySelectorAll(".js-abc-time"), function (el) {
              el.value = fmtAbcWait(t);
            });
          });
        }
      }
      Array.prototype.forEach.call(panel.querySelectorAll(".abc-marks .abc-move, .abc-marks .abc-fast"), function (btn) {
        var k = btn.getAttribute("data-mark");
        var fast = btn.classList.contains("abc-fast");
        bindHoldSet(btn, function () { abcMove(k, fast); });
      });
      Array.prototype.forEach.call(panel.querySelectorAll(".abc-block"), function (block) {
        if (block._abcBound) return;
        block._abcBound = true;
        var k = block.getAttribute("data-mark");
        var setBtn = block.querySelector(".abc-set");
        var moveBtn = block.querySelector(".abc-move");
        var fastBtn = block.querySelector(".abc-fast");
        var useIn = block.querySelector(".abc-use-in");
        var waitIn = block.querySelector(".abc-wait");
        if (setBtn) bindHoldSet(setBtn, function () { abcSet(k); }, function () { abcClear(k); });
        bindHoldSet(moveBtn, function () { abcMove(k, false); });
        bindHoldSet(fastBtn, function () { abcMove(k, true); });
        if (useIn) {
          useIn.addEventListener("change", function () {
            abcUse[k] = !!useIn.checked;
            syncAbcUseUi();
          });
        }
        if (waitIn) {
          waitIn.addEventListener("change", function () {
            abcWaits[k] = clampAbcWait(waitIn.value, 0, 60);
            waitIn.value = fmtAbcWait(abcWaits[k]);
          });
        }
      });
    });
  }

  function bumpMarkCount(delta) {
    var n = clampMarkCount(markCount() + delta);
    if (n === markCount()) {
      syncAbMarkCountBtns();
      return;
    }
    project.mark_count = n;
    SHProject.saveProject(project);
    if ($("cfgMarks")) $("cfgMarks").value = String(n);
    applyMarkCount();
  }

  function syncAbMarkCountBtns() {
    var n = markCount();
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-marks-minus"), function (el) {
      el.disabled = n <= 2;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-marks-plus"), function (el) {
      el.disabled = n >= 8;
    });
  }

  function bindAbMarkCountBtns() {
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-marks-minus"), function (el) {
      if (el._abMarksBound) return;
      el._abMarksBound = true;
      el.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        bumpMarkCount(-1);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-marks-plus"), function (el) {
      if (el._abMarksBound) return;
      el._abMarksBound = true;
      el.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        bumpMarkCount(1);
      };
    });
  }

  function fillAbCols(box) {
    if (!box) return;
    var letters = markLetters();
    box.style.gridTemplateColumns = "repeat(" + letters.length + ", minmax(0, 1fr))";
    box.innerHTML = letters.map(function (k) {
      var L = k.toUpperCase();
      return (
        '<div class="ab-col abc-block" data-mark="' + k + '">' +
          '<button type="button" class="btn ochre abc-move" data-mark="' + k + '">▶' + L + "</button>" +
          '<button type="button" class="btn ochre abc-fast" data-mark="' + k + '">▶▶' + L + "</button>" +
          '<button type="button" class="btn ochre abc-set" data-mark="' + k + '">⚑</button>' +
          etaCellHtml(k, "", "s") +
          '<input type="number" class="abc-wait" inputmode="decimal" step="0.1" min="0" max="60" value="' +
            fmtAbcWait(abcWaits[k]) + '">' +
          '<label class="abc-use">' +
            '<input type="checkbox" class="abc-use-in" disabled>' +
            '<span class="switch-ui" aria-hidden="true"></span>' +
          "</label>" +
        "</div>"
      );
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll(".ab-col"), function (col) {
      var k = col.getAttribute("data-mark");
      var setBtn = col.querySelector(".abc-set");
      var moveBtn = col.querySelector(".abc-move");
      var fastBtn = col.querySelector(".abc-fast");
      var useIn = col.querySelector(".abc-use-in");
      var waitIn = col.querySelector(".abc-wait");
      col._abcBound = true;
      if (setBtn) bindHoldSet(setBtn, function () { abcSet(k); }, function () { abcClear(k); });
      bindHoldSet(moveBtn, function () { abcMove(k, false); });
      bindHoldSet(fastBtn, function () { abcMove(k, true); });
      if (useIn) {
        useIn.addEventListener("change", function () {
          abcUse[k] = !!useIn.checked;
          syncAbcUseUi();
        });
      }
      if (waitIn) {
        waitIn.addEventListener("change", function () {
          abcWaits[k] = clampAbcWait(waitIn.value, 0, 60);
          waitIn.value = fmtAbcWait(abcWaits[k]);
        });
      }
    });
  }

  function fillAbDlg() {
    Array.prototype.forEach.call(document.querySelectorAll(".ab-dlg-cols"), fillAbCols);
    bindAbc();
    bindAbMarkCountBtns();
    syncAbMarkCountBtns();
    syncAbcUseUi();
    updateAbcEtas();
  }

  function poseToAbList(pose) {
    pose = abcAsPose(pose);
    if (!pose) return null;
    var i;
    var v;
    var last = 0;
    var out = [];
    for (i = 1; i <= 8; i++) {
      v = pose[i] != null ? pose[i] : pose[String(i)];
      if (v == null || v === "" || isNaN(Number(v))) out.push(null);
      else {
        out.push(Number(v));
        last = i;
      }
    }
    if (!last) return null;
    return out.slice(0, last);
  }

  function abListToPose(arr) {
    if (!arr || !arr.length) return null;
    var pose = {};
    var i;
    var v;
    for (i = 0; i < arr.length && i < 8; i++) {
      v = arr[i];
      if (v == null || v === "" || isNaN(Number(v))) continue;
      pose[i + 1] = Number(v);
    }
    return pose[1] == null ? null : pose;
  }

  function exportAbPositions() {
    var out = {};
    ABC_LETTERS.forEach(function (k) {
      var list = poseToAbList(getAbcPose(k));
      if (list) out[k.toUpperCase()] = list;
    });
    SHProject.download(projName() + "_ab.json", out);
  }

  function importAbPositions(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) {
      alert("Not an A/B positions file.");
      return;
    }
    var maxIdx = 0;
    ABC_LETTERS.forEach(function (k, i) {
      var raw = o[k.toUpperCase()] != null ? o[k.toUpperCase()] : o[k];
      if (raw == null) return;
      var pose = Array.isArray(raw) ? abListToPose(raw) : abcAsPose(raw);
      if (!pose) return;
      marks[k] = pose;
      if (window.SWUi && typeof SWUi.setMarkPose === "function") SWUi.setMarkPose(k, pose);
      abcUse[k] = true;
      maxIdx = i + 1;
    });
    if (maxIdx > markCount()) {
      project.mark_count = clampMarkCount(maxIdx);
      SHProject.saveProject(project);
      if ($("cfgMarks")) $("cfgMarks").value = String(project.mark_count);
      applyMarkCount();
    } else {
      syncAbcUseUi();
      updateAbcEtas();
    }
  }

  var smAct = 1;
  var smSeeking = false;
  var smAutoTimer = 0;
  var SM_LS_IMAGE = "sm_image";
  var SM_LS_AUTO = "sm_auto";
  var SM_LS_LOG = "sm_log";

  function smEl(sel) {
    var win = $("winSm");
    return win ? win.querySelector(sel) : null;
  }

  function smWinOpen() {
    var win = $("winSm");
    return !!(win && win.classList.contains("is-open"));
  }

  function smFps() {
    var n = Number(project && project.frame_rate);
    return n > 0 ? n : 30;
  }

  function smFrameMax() {
    if (!editor) return 1;
    return Math.max(1, Math.ceil(editor.motionDuration() * smFps()) + 1);
  }

  function smSecFrame(n, fps) {
    fps = fps || smFps();
    if (fps < 1) fps = 1;
    var z = Math.max(0, Math.floor(Number(n) || 1) - 1);
    var sec = Math.floor(z / fps);
    var ff = z % fps;
    return sec + ":" + (ff < 10 ? "0" + ff : String(ff));
  }

  function smParseTime(s) {
    s = String(s || "").trim();
    var fps = smFps();
    var m = s.match(/^(\d+)\s*:\s*(\d+)$/);
    if (m) return Number(m[1]) * fps + Number(m[2]) + 1;
    m = s.match(/^(\d+)$/);
    if (m) return Number(m[1]) * fps + 1;
    return NaN;
  }

  function smPad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function smNowStamp() {
    var d = new Date();
    return d.getFullYear() + "-" + smPad2(d.getMonth() + 1) + "-" + smPad2(d.getDate()) +
      " " + smPad2(d.getHours()) + ":" + smPad2(d.getMinutes()) + ":" + smPad2(d.getSeconds());
  }

  function smIncImage(s) {
    s = String(s == null ? "" : s);
    var m = s.match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return s;
    var n = String(Number(m[2]) + 1);
    while (n.length < m[2].length) n = "0" + n;
    return m[1] + n + m[3];
  }

  function smLsGet(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function smLsSet(key, v) {
    try { localStorage.setItem(key, v); } catch (e) {}
  }

  function smCancelAuto() {
    if (smAutoTimer) {
      clearTimeout(smAutoTimer);
      smAutoTimer = 0;
    }
  }

  function smRefreshCells() {
    var max = smFrameMax();
    if (smAct > max) smAct = max;
    if (smAct < 1) smAct = 1;
    var fps = smFps();
    var frameEl = smEl(".js-sm-frame");
    var timeEl = smEl(".js-sm-time");
    if (frameEl && document.activeElement !== frameEl) frameEl.value = String(smAct);
    if (timeEl && document.activeElement !== timeEl) timeEl.value = smSecFrame(smAct, fps);
    var fmax = smEl(".js-sm-frame-max .int");
    if (fmax) fmax.textContent = String(max);
    var tmax = smEl(".js-sm-time-max .int");
    if (tmax) tmax.textContent = smSecFrame(max, fps);
    smSyncBtns();
  }

  function smSyncBtns() {
    var max = smFrameMax();
    var prev = smEl(".js-sm-prev");
    var next = smEl(".js-sm-next");
    var trig = smEl(".js-sm-trig");
    var st = (lastStatus && lastStatus.state) || "?";
    var idle = st === "I";
    if (prev) prev.disabled = smAct <= 1 || !idle;
    if (next) next.disabled = smAct >= max || !idle;
    if (trig) {
      trig.disabled = !idle;
      trig.classList.toggle("sm-trig-on", st === "T");
    }
  }

  function smGotoFrame(n, seekMotors) {
    var max = smFrameMax();
    var fps = smFps();
    n = Math.round(Number(n));
    if (!isFinite(n)) n = smAct;
    if (n < 1) n = 1;
    if (n > max) n = max;
    smAct = n;
    smRefreshCells();
    if (!editor) return;
    var t = (n - 1) / fps;
    smSeeking = true;
    editor.playhead = t;
    editor.draw();
    if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
    syncCtrlReadouts();
    if (seekMotors !== false && ((lastStatus && lastStatus.state) || "?") === "I") {
      var pose = editor.poseAt(t);
      if (!poseNearAbc(pose)) onPlayhead(t, true, true);
    }
    smSeeking = false;
  }

  function smSyncFromPlayhead(t) {
    if (smSeeking || !smWinOpen()) return;
    var fps = smFps();
    var n = Math.round(Number(t) * fps) + 1;
    var max = smFrameMax();
    if (n < 1) n = 1;
    if (n > max) n = max;
    smAct = n;
    smRefreshCells();
  }

  function smOnOpen() {
    var fps = smFps();
    var t = editor ? editor.playhead : 0;
    smGotoFrame(Math.round(t * fps) + 1, true);
  }

  function smOnFpsChange() {
    if (smWinOpen()) smGotoFrame(smAct, true);
    else smRefreshCells();
  }

  function smOnMcState(prev, now) {
    if (prev === "T" && now !== "T") smOnShot();
    smSyncBtns();
  }

  function smOnShot() {
    var img = smEl(".js-sm-image");
    var log = smEl(".js-sm-log");
    var auto = smEl(".js-sm-auto");
    var name = img ? String(img.value || "") : "";
    if (log) {
      var line = smNowStamp() + " " + smAct + " " + name;
      log.value = log.value ? log.value + "\n" + line : line;
      log.scrollTop = log.scrollHeight;
      smLsSet(SM_LS_LOG, log.value);
    }
    if (img) {
      img.value = smIncImage(name);
      smLsSet(SM_LS_IMAGE, img.value);
    }
    smCancelAuto();
    if (auto && auto.checked) {
      smAutoTimer = setTimeout(function () {
        smAutoTimer = 0;
        smGotoFrame(smAct + 1, true);
      }, 333);
    }
  }

  function smCommitFrame() {
    var el = smEl(".js-sm-frame");
    if (!el) return;
    var n = parseInt(el.value, 10);
    if (!isFinite(n)) {
      smRefreshCells();
      return;
    }
    smCancelAuto();
    smGotoFrame(n, true);
  }

  function smCommitTime() {
    var el = smEl(".js-sm-time");
    if (!el) return;
    var n = smParseTime(el.value);
    if (!isFinite(n)) {
      smRefreshCells();
      return;
    }
    smCancelAuto();
    smGotoFrame(n, true);
  }

  function smBindField(el, commit) {
    if (!el || el._smBound) return;
    el._smBound = true;
    var backup = "";
    el.addEventListener("focus", function () { backup = el.value; });
    el.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        el.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        el.value = backup;
        el.blur();
      }
    });
    el.addEventListener("blur", function () {
      if (el.value === backup) {
        smRefreshCells();
        return;
      }
      commit();
    });
  }

  function bindSm() {
    var prev = smEl(".js-sm-prev");
    var next = smEl(".js-sm-next");
    var trig = smEl(".js-sm-trig");
    var auto = smEl(".js-sm-auto");
    var img = smEl(".js-sm-image");
    var log = smEl(".js-sm-log");
    smBindField(smEl(".js-sm-frame"), smCommitFrame);
    smBindField(smEl(".js-sm-time"), smCommitTime);
    if (prev && !prev._smBound) {
      prev._smBound = true;
      prev.onclick = function () {
        smCancelAuto();
        smGotoFrame(smAct - 1, true);
      };
    }
    if (next && !next._smBound) {
      next._smBound = true;
      next.onclick = function () {
        smCancelAuto();
        smGotoFrame(smAct + 1, true);
      };
    }
    if (trig && !trig._smBound) {
      trig._smBound = true;
      trig.onclick = function () {
        if ((lastStatus && lastStatus.state) !== "I") return;
        sendMc("CT");
      };
    }
    if (img && !img._smBound) {
      img._smBound = true;
      if (!img.value) img.value = smLsGet(SM_LS_IMAGE, "IMG_0001");
      img.addEventListener("change", function () { smLsSet(SM_LS_IMAGE, img.value); });
    }
    if (auto && !auto._smBound) {
      auto._smBound = true;
      auto.checked = smLsGet(SM_LS_AUTO, "") === "1";
      auto.onchange = function () {
        smLsSet(SM_LS_AUTO, auto.checked ? "1" : "0");
        if (!auto.checked) smCancelAuto();
      };
    }
    if (log && !log._smBound) {
      log._smBound = true;
      log.value = smLsGet(SM_LS_LOG, "");
      log.addEventListener("change", function () { smLsSet(SM_LS_LOG, log.value); });
      log.addEventListener("input", function () { smLsSet(SM_LS_LOG, log.value); });
    }
    smRefreshCells();
  }

  function smCsvCell(s) {
    s = String(s == null ? "" : s);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function smParseLogLine(line) {
    line = String(line || "");
    var m = line.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(\d+)\s*(.*)$/);
    if (!m) return { date: "", time: "", frame: "", image: "", comment: line };
    var rest = String(m[4] || "").trim();
    var sp = rest.match(/^(\S+)\s*(.*)$/);
    return {
      date: m[1],
      time: m[2],
      frame: m[3],
      image: sp ? sp[1] : "",
      comment: sp ? sp[2] : ""
    };
  }

  function smLogText() {
    var log = smEl(".js-sm-log");
    return log ? String(log.value || "") : "";
  }

  function exportSmCsv() {
    var rows = ["Date, Time, Frame, Image, Comment"];
    smLogText().split(/\r?\n/).forEach(function (line) {
      if (!String(line).trim()) return;
      var o = smParseLogLine(line);
      rows.push([o.date, o.time, o.frame, o.image, o.comment].map(smCsvCell).join(", "));
    });
    SHProject.downloadText(projName() + "_sm.csv", rows.join("\r\n") + "\r\n", "text/csv;charset=utf-8");
  }

  function exportSmTxt() {
    SHProject.downloadText(projName() + "_sm.txt", smLogText(), "text/plain;charset=utf-8");
  }

  var FLOAT_IDS = { ab: "winAb", tl: "winTl", sm: "winSm" };

  function closeFloatWins() {
    smCancelAuto();
    Array.prototype.forEach.call(document.querySelectorAll(".float-win"), function (win) {
      win.classList.remove("is-open");
    });
  }

  function openFloatWin(id) {
    var el = $(FLOAT_IDS[id] || id);
    if (!el) return;
    var was = el.classList.contains("is-open");
    closeFloatWins();
    if (was) return;
    el.classList.add("is-open");
    if (!el.style.left) el.style.left = "4.5rem";
    if (!el.style.top) el.style.top = "4.5rem";
    if (el.id === "winSm") smOnOpen();
  }

  function bindFloatWins() {
    Array.prototype.forEach.call(document.querySelectorAll(".float-win"), function (win) {
      if (win._floatBound) return;
      win._floatBound = true;
      var cap = win.querySelector(".float-cap");
      var close = win.querySelector(".float-close");
      if (close) {
        close.onclick = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          if (win.id === "winSm") smCancelAuto();
          win.classList.remove("is-open");
        };
      }
      if (!cap) return;
      var drag = null;
      cap.addEventListener("pointerdown", function (ev) {
        if (ev.target.closest(".float-close, .float-cap-btn")) return;
        var r = win.getBoundingClientRect();
        drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
        try { cap.setPointerCapture(ev.pointerId); } catch (e) {}
        ev.preventDefault();
      });
      cap.addEventListener("pointermove", function (ev) {
        if (!drag) return;
        var x = ev.clientX - drag.dx;
        var y = ev.clientY - drag.dy;
        var maxX = Math.max(0, window.innerWidth - 48);
        var maxY = Math.max(0, window.innerHeight - 32);
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (x > maxX) x = maxX;
        if (y > maxY) y = maxY;
        win.style.left = x + "px";
        win.style.top = y + "px";
      });
      function endDrag() { drag = null; }
      cap.addEventListener("pointerup", endDrag);
      cap.addEventListener("pointercancel", endDrag);
    });
  }

  window.__shCancelAbcLoop = cancelAbcLoop;
  window.__shOnMarksChanged = function () {
    syncAbcUseUi();
    updateAbcEtas();
  };
  window.__shUpdateAbcEtas = updateAbcEtas;

  function fillTlMarks() {
    var letters = markLetters();
    var n = letters.length;
    Array.prototype.forEach.call(document.querySelectorAll(".tl-marks"), function (box) {
      box.style.gridTemplateColumns = "repeat(" + n + ", minmax(0, 1fr))";
      var html = "";
      letters.forEach(function (k) {
        html += '<button type="button" class="btn ochre tl-go" data-mark="' + k + '">⏲' + k.toUpperCase() + "</button>";
      });
      letters.forEach(function (k) {
        html += '<button type="button" class="btn ochre tl-fast" data-mark="' + k + '">▶▶' + k.toUpperCase() + "</button>";
      });
      letters.forEach(function (k) {
        html += etaCellHtml(k, "tl-bar-eta", "s");
      });
      letters.forEach(function (k) {
        html += etaCellHtml(k, "tl-bar-eta-min", "m");
      });
      box.innerHTML = html;
    });
    bindTlPad();
    syncMarkBtns();
    updateAbcEtas();
  }

  function bindTlPad() {
    Array.prototype.forEach.call(document.querySelectorAll(".tl-panel"), function (panel) {
      Array.prototype.forEach.call(panel.querySelectorAll(".tl-go"), function (btn) {
        bindHoldSet(btn, function () {
          var k = btn.getAttribute("data-mark");
          if (window.SWUi && typeof SWUi.startTimelapse === "function") SWUi.startTimelapse(k);
        });
      });
      Array.prototype.forEach.call(panel.querySelectorAll(".tl-fast"), function (btn) {
        bindHoldSet(btn, function () {
          abcMove(btn.getAttribute("data-mark"), true);
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-start-timeline"), function (btn) {
      if (btn._tlStartBound) return;
      btn._tlStartBound = true;
      bindHoldSet(btn, function () {
        startTimelineTimelapse();
      });
    });
    if (window.SWUi && typeof SWUi.bindTlFields === "function") SWUi.bindTlFields();
  }

  function applyMarkCount() {
    cancelAbcLoop();
    fillAbcBlocks();
    fillTlMarks();
    fillAbDlg();
  }

  function bindButtons(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll("[data-btn]"), function (el) {
      if (el._bound) return;
      var ax = el.getAttribute("data-ax");
      var name = el.getAttribute("data-btn");
      if (name && name.indexOf("LIMIT_") === 0) {
        el._bound = true;
        bindLimitBtn(el);
        return;
      }
      if (ax == null && name !== "STOP" && name !== "HOME") return;
      el._bound = true;
      var key = name + ":" + (ax == null ? "" : ax);
      var t0 = 0;
      function down(ev) {
        t0 = Date.now();
        held[key] = true;
        onBtn(name, true, false, ax);
        ev.preventDefault();
      }
      function up(ev) {
        var dt = Date.now() - t0;
        held[key] = false;
        if (name.indexOf("MOVE") === 0 || name.indexOf("FAST") === 0) {
          if (dt >= TAP_MS) onBtn(name, false, true, ax);
        }
        ev.preventDefault();
      }
      el.addEventListener("mousedown", down);
      el.addEventListener("mouseup", up);
      el.addEventListener("mouseleave", function () { if (held[key]) up({ preventDefault: function () {} }); });
      el.addEventListener("touchstart", down, { passive: false });
      el.addEventListener("touchend", up);
    });
    Array.prototype.forEach.call((root || document).querySelectorAll(".js-enable"), function (el) {
      el.onchange = function () { sendMc(el.checked ? "SE 1" : "SE 0"); };
    });
    Array.prototype.forEach.call((root || document).querySelectorAll(".js-spd"), function (el) {
      el.oninput = function () { emitSs(false, el); };
      el.onchange = function () { emitSs(true, el); };
    });
    Array.prototype.forEach.call((root || document).querySelectorAll(".js-acc"), function (el) {
      el.oninput = function () { emitSa(el); };
    });
  }

  var JOY_K = 9;
  var joyLog = false;
  var joyU = {};
  var joyDrag = {};
  var joyMjTimer = 0;
  var joyLastMj = "";
  var kbEnabled = false;
  var kbAxis = null;
  var keyJog = null;

  function joyCurve(u) {
    u = Math.max(0, Math.min(1, u));
    if (joyLog) return (Math.pow(1 + JOY_K, u) - 1) / JOY_K;
    return u;
  }

  function joyInvCurve(p) {
    p = Math.max(0, Math.min(1, p));
    if (joyLog) return Math.log(1 + JOY_K * p) / Math.log(1 + JOY_K);
    return p;
  }

  function joyFmtPct(v) {
    var n = Math.round(v);
    if (n === 0) return "0";
    return (n > 0 ? "+" : "") + String(n);
  }

  function joyMapped(u) {
    if (!u) return 0;
    return (u < 0 ? -1 : 1) * 100 * joyCurve(Math.abs(u));
  }

  function joySwap(id) {
    if (Number(id) === 2) {
      if (window.SWUi && typeof SWUi.swapDir2 === "function") return !!SWUi.swapDir2();
      var d2 = document.getElementById("dir2");
      return !!(d2 && d2.checked);
    }
    if (window.SWUi && typeof SWUi.swapDir === "function") return !!SWUi.swapDir();
    var d1 = document.getElementById("dir");
    return !!(d1 && d1.checked);
  }

  function joyPct(id) {
    var u = Number(joyU[id]) || 0;
    var v = joyMapped(u);
    return joySwap(id) ? -v : v;
  }

  function joyFmtMj(v) {
    return Math.round(Number(v) * 10) / 10;
  }

  function joyDual() {
    return document.body.classList.contains("axes-2");
  }

  function joyStopLine() {
    var n = joyAxisIds().length || liveAxisCount();
    if (n <= 1) return "MJ 0";
    return "MJ " + Array(n + 1).join("0 ").trim();
  }

  function joyAxisIds() {
    var ids = [];
    var row = document.querySelector(".joy-rows .jc-row");
    if (!row) return ids;
    var host = row.parentNode;
    Array.prototype.forEach.call(host.querySelectorAll(".jc-row"), function (el) {
      ids.push(el.getAttribute("data-ax"));
    });
    return ids;
  }

  function emitMj(force) {
    var ids = joyAxisIds();
    var line;
    if (!ids.length) line = "MJ 0";
    else {
      line = "MJ " + ids.map(function (id) { return joyFmtMj(joyPct(id)); }).join(" ");
    }
    if (!force && line === joyLastMj) return;
    joyLastMj = line;
    sendMc(line);
  }

  function scheduleMj() {
    if (joyMjTimer) return;
    joyMjTimer = setTimeout(function () {
      joyMjTimer = 0;
      if (Object.keys(joyDrag).length) emitMj(false);
    }, 50);
  }

  function stopMj() {
    if (joyMjTimer) {
      clearTimeout(joyMjTimer);
      joyMjTimer = 0;
    }
    joyLastMj = "";
    sendMc(joyStopLine());
  }

  function joyTickHtml() {
    var marks = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
    return marks.map(function (p) {
      var mag = joyInvCurve(Math.abs(p));
      var u = p < 0 ? -mag : mag;
      if (!p) u = 0;
      var t = (u + 1) / 2;
      var extra = p === 0 ? " zero" : (Math.abs(p) === 1 ? " end" : "");
      return '<span class="jc-tick' + extra + '" style="--t:' + t + '"></span>';
    }).join("");
  }

  function applyJoyVisuals() {
    Array.prototype.forEach.call(document.querySelectorAll(".jc-row"), function (row) {
      var id = row.getAttribute("data-ax");
      var u = Number(joyU[id]) || 0;
      var track = row.querySelector(".jc-track");
      var val = row.querySelector(".jc-val");
      if (track) track.style.setProperty("--u", String(u));
      if (val) val.textContent = joyFmtPct(joyPct(id));
    });
  }

  function refreshJoyTicks() {
    var html = joyTickHtml();
    Array.prototype.forEach.call(document.querySelectorAll(".jc-ticks"), function (box) {
      box.innerHTML = html;
    });
  }

  function uFromPointer(track, clientX) {
    var r = track.getBoundingClientRect();
    var inset = r.height / 2;
    var usable = Math.max(1, r.width - 2 * inset);
    var x = clientX - r.left - inset;
    var u = (x / usable) * 2 - 1;
    if (u < -1) u = -1;
    if (u > 1) u = 1;
    return u;
  }

  function bindJoyTrack(track) {
    if (track._bound) return;
    track._bound = true;
    track.addEventListener("pointerdown", function (ev) {
      var row = track.closest(".jc-row");
      if (!row) return;
      ev.preventDefault();
      var id = row.getAttribute("data-ax");
      joyDrag[id] = ev.pointerId;
      var handle = track.querySelector(".jc-handle");
      if (handle) handle.classList.add("held");
      try { track.setPointerCapture(ev.pointerId); } catch (e) {}
      joyU[id] = uFromPointer(track, ev.clientX);
      applyJoyVisuals();
      sendMc("SS " + Number(cmdSpd).toFixed(3));
      emitMj(true);
    });
    track.addEventListener("pointermove", function (ev) {
      var row = track.closest(".jc-row");
      if (!row) return;
      var id = row.getAttribute("data-ax");
      if (joyDrag[id] !== ev.pointerId) return;
      joyU[id] = uFromPointer(track, ev.clientX);
      applyJoyVisuals();
      scheduleMj();
    });
    function endDrag(ev) {
      var row = track.closest(".jc-row");
      if (!row) return;
      var id = row.getAttribute("data-ax");
      if (joyDrag[id] !== ev.pointerId && ev.type !== "pointercancel") return;
      if (joyDrag[id] == null) return;
      delete joyDrag[id];
      var handle = track.querySelector(".jc-handle");
      if (handle) handle.classList.remove("held");
      try { track.releasePointerCapture(ev.pointerId); } catch (e) {}
      joyU[id] = 0;
      applyJoyVisuals();
      if (Object.keys(joyDrag).length) emitMj(true);
      else stopMj();
    }
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
  }

  function appendJoyRow(box, ax, ticks) {
    var id = ax.id;
    if (joyU[id] == null) joyU[id] = 0;
    var col = axisColor(id);
    var row = document.createElement("div");
    row.className = "jc-row";
    row.setAttribute("data-ax", String(id));
    row.style.setProperty("--axis", col);
    row.innerHTML =
      '<span class="jc-val">0</span>' +
      '<div class="jc-track" role="slider" aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0">' +
        '<div class="jc-ticks">' + ticks + "</div>" +
        '<div class="jc-handle" style="background:' + col + '"></div>' +
      "</div>";
    row.addEventListener("pointerdown", function (ev) {
      var idn = Number(row.getAttribute("data-ax"));
      if (ev.target && ev.target.closest && ev.target.closest(".jc-track")) {
        setKbAxis(idn);
        return;
      }
      setKbAxis(kbAxis === idn ? null : idn);
    });
    box.appendChild(row);
    bindJoyTrack(row.querySelector(".jc-track"));
  }

  function fillJoyRows(axes) {
    var list = (axes && axes.length) ? axes : liveAxes();
    if (!list.length) return;
    var ticks = joyTickHtml();
    Array.prototype.forEach.call(document.querySelectorAll(".joy-rows"), function (box) {
      box.innerHTML = "";
      list.forEach(function (ax) { appendJoyRow(box, ax, ticks); });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".ctrl-joy"), function (box) {
      var id = Number(box.getAttribute("data-ax"));
      box.innerHTML = "";
      list.forEach(function (ax) {
        if (Number(ax.id) === id) appendJoyRow(box, ax, ticks);
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-joy-log"), function (el) {
      el.checked = joyLog;
      el.onchange = function () {
        joyLog = !!el.checked;
        Array.prototype.forEach.call(document.querySelectorAll(".js-joy-log"), function (x) {
          x.checked = joyLog;
        });
        refreshJoyTicks();
        applyJoyVisuals();
        if (Object.keys(joyDrag).length) emitMj(true);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-joy-kb"), function (el) {
      el.checked = kbEnabled;
      el.onchange = function () {
        kbEnabled = !!el.checked;
        Array.prototype.forEach.call(document.querySelectorAll(".js-joy-kb"), function (x) {
          x.checked = kbEnabled;
        });
        if (!kbEnabled) stopKeyJog();
      };
    });
    if (kbAxis != null && !list.some(function (ax) { return Number(ax.id) === Number(kbAxis); })) {
      kbAxis = null;
    }
    syncKbAxisUi();
    applyJoyVisuals();
  }

  function bindJoy() {
    fillJoyRows(liveAxes());
  }

  function kbAxisList() {
    return liveAxes();
  }

  function kbAxisInfo(id) {
    id = Number(id);
    var axes = kbAxisList();
    var i;
    for (i = 0; i < axes.length; i++) {
      if (Number(axes[i].id) === id) return axes[i];
    }
    return null;
  }

  function setKbAxis(id) {
    if (id == null || id === 0 || isNaN(Number(id))) kbAxis = null;
    else if (!kbAxisInfo(id)) kbAxis = null;
    else kbAxis = Number(id);
    syncKbAxisUi();
    if (editor && kbAxis != null) {
      editor.activeId = kbAxis;
      editor._tracks();
      editor.draw();
    }
    syncCtrlReadouts();
  }

  function syncKbAxisUi() {
    var ax = kbAxis != null ? kbAxisInfo(kbAxis) : null;
    Array.prototype.forEach.call(document.querySelectorAll(".jc-row"), function (row) {
      row.classList.toggle("kb-sel", ax && Number(row.getAttribute("data-ax")) === Number(ax.id));
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-joy-axis"), function (el) {
      if (!ax) {
        el.textContent = "—";
        el.style.removeProperty("--axis");
        el.style.color = "";
        return;
      }
      el.textContent = ax.name || ("A" + ax.id);
      el.style.setProperty("--axis", axisColor(ax.id));
      el.style.color = axisColor(ax.id);
    });
  }

  function stopKeyJog() {
    if (!keyJog) return;
    var fast = keyJog.fast;
    keyJog = null;
    sendMc("MS");
    if (fast) sendMc("SS " + Number(sessionSpd()).toFixed(3), true);
  }

  function kbInField(ev) {
    var el = ev.target;
    if (!el) return false;
    var tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (tag === "INPUT") {
      var typ = (el.type || "text").toLowerCase();
      if (typ === "checkbox" || typ === "radio" || typ === "button" || typ === "submit" || typ === "hidden") {
        return false;
      }
      return true;
    }
    return false;
  }

  function kbDesktop() {
    return !document.body.classList.contains("phone-ui");
  }

  function sessionEnabled() {
    if (lastStatus.session && lastStatus.session.enabled != null) return !!lastStatus.session.enabled;
    var el = $("enable") || document.querySelector(".js-enable");
    return el ? !!el.checked : true;
  }

  function kbToggleEnable() {
    var on = sessionEnabled();
    sendMc(on ? "SE 0" : "SE 1");
    var next = !on;
    if ($("enable")) $("enable").checked = next;
    Array.prototype.forEach.call(document.querySelectorAll(".js-enable"), function (el) {
      el.checked = next;
    });
  }

  function kbSetPlayhead(t, seek) {
    if (!editor) return;
    t = editor.clampT(t);
    editor.playhead = t;
    editor.draw();
    if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
    if (seek) onPlayhead(t, true, true);
  }

  function kbNudgePlayhead(dir, ev) {
    if (!editor) return;
    var dt = ev.shiftKey ? 1 : 0.1;
    kbSetPlayhead(editor.playhead + dir * dt, !!ev.ctrlKey);
  }

  function kbJumpPlayhead(toEnd, seek) {
    if (!editor) return;
    kbSetPlayhead(toEnd ? editor.motionDuration() : 0, seek);
  }

  function kbLetter(ev) {
    var k = (ev.key || "").toLowerCase();
    if (k.length !== 1) return false;
    if (k >= "a" && k <= "h") {
      if (ev.altKey) abcSet(k);
      else abcMove(k, !!ev.shiftKey);
      return true;
    }
    if (k === "p") { if (mcIdle()) playGraph("fwd"); return true; }
    if (k === "r") { if (mcIdle()) playGraph("rev"); return true; }
    if (k === "e") { kbToggleEnable(); return true; }
    if (k === "k") {
      if (editor) editor.keyAtPlayhead(editor.live);
      return true;
    }
    return false;
  }

  function kbNumpad(ev) {
    var code = ev.code || "";
    var acc = !!ev.altKey;
    var cur = acc ? sessionAcc() : sessionSpd();
    var mx = acc ? accMax : spdMax;
    var set = acc ? setSessionAccel : setSessionSpeed;
    var pct = { Numpad1: 0.1, Numpad2: 0.2, Numpad3: 0.3, Numpad4: 0.4,
      Numpad5: 0.5, Numpad6: 0.6, Numpad7: 0.7, Numpad8: 0.8, Numpad9: 0.9, Numpad0: 1,
      NumpadDecimal: 0.05 };
    if (pct[code] != null) { set(mx * pct[code]); return true; }
    if (code === "NumpadAdd") { set(cur + 0.01 * mx); return true; }
    if (code === "NumpadSubtract") { set(cur - 0.01 * mx); return true; }
    var step = Math.sqrt(Math.sqrt(2));
    if (code === "NumpadMultiply") { set(cur * step); return true; }
    if (code === "NumpadDivide") { set(cur / step); return true; }
    return false;
  }

  function kbStartJog(dir, fast) {
    if (kbAxis == null) return;
    if (!kbAxisInfo(kbAxis)) return;
    if (keyJog && keyJog.dir === dir && keyJog.fast === fast) return;
    stopKeyJog();
    keyJog = { dir: dir, fast: fast };
    if (fast) sendMc("SS " + spdMax.toFixed(3), true);
    sendJog(dir, kbAxis, false);
  }

  function onKbDown(ev) {
    if (!kbDesktop() || kbInField(ev)) return;
    if (ev.key === " " || ev.key === "Escape") {
      ev.preventDefault();
      stopKeyJog();
      onBtn("STOP", true, false);
      return;
    }
    if (!kbEnabled) return;
    var code = ev.code || "";
    if (code === "ArrowLeft" || code === "ArrowRight") {
      if (ev.repeat) { ev.preventDefault(); return; }
      ev.preventDefault();
      kbStartJog(code === "ArrowLeft" ? -1 : 1, !!ev.shiftKey);
      return;
    }
    if (code === "ArrowUp" || code === "ArrowDown") {
      ev.preventDefault();
      kbNudgePlayhead(code === "ArrowUp" ? 1 : -1, ev);
      return;
    }
    if (code === "PageUp" || code === "PageDown") {
      ev.preventDefault();
      kbJumpPlayhead(code === "PageUp", !!ev.ctrlKey);
      return;
    }
    if (code.indexOf("Digit") === 0 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      var n = Number(code.slice(5));
      if (n >= 0 && n <= 6) {
        ev.preventDefault();
        setKbAxis(n === 0 ? null : n);
        return;
      }
    }
    if (kbNumpad(ev)) { ev.preventDefault(); return; }
    if (ev.ctrlKey && !ev.metaKey && kbLetter(ev)) { ev.preventDefault(); return; }
  }

  function onKbUp(ev) {
    if (!kbDesktop()) return;
    var code = ev.code || "";
    if (code === "ArrowLeft" || code === "ArrowRight") {
      if (keyJog) {
        ev.preventDefault();
        stopKeyJog();
      }
    }
  }

  function onKbBlur() {
    stopKeyJog();
  }

  function bindKbKeys() {
    if (bindKbKeys._on) return;
    bindKbKeys._on = true;
    window.addEventListener("keydown", onKbDown);
    window.addEventListener("keyup", onKbUp);
    window.addEventListener("blur", onKbBlur);
    document.addEventListener("pointerup", function (ev) {
      var el = ev.target;
      if (!el || (el.tagName || "").toUpperCase() !== "INPUT") return;
      var typ = (el.type || "").toLowerCase();
      if (typ === "checkbox" || typ === "radio") el.blur();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopKeyJog();
    });
  }

  function bindTl() {
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-start"), function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.onclick = function () {
        var root = btn.closest(".phone-panel, .panel-body") || document;
        function val(sel, fallback) {
          var el = root.querySelector(sel);
          return el && el.value !== "" ? el.value : fallback;
        }
        var d1 = val(".js-tl-dest1", "_");
        var d2 = val(".js-tl-dest2", "_");
        var s1 = val(".js-tl-step1", "5");
        var s2 = val(".js-tl-step2", "1");
        var iv = val(".js-tl-interval", "0.33");
        var ex = val(".js-tl-exposure", "0.1");
        var cont = root.querySelector(".js-tl-cont");
        if (cont && cont.checked) {
          send({ task: "TSK_TL_CONT " + d1 + " " + d2 + " 0.5 20 " + iv + " " + ex });
        } else {
          send({ task: "TSK_TL_STEP " + d1 + " " + d2 + " " + s1 + " " + s2 + " " + iv + " " + ex });
        }
      };
    });
  }

  function saveTimeline() {
    if (!editor) return;
    project.lanes = editor.lanes;
    project.markers = editor.markers;
    project.play_hz = editor.playHz;
    SHProject.saveProject(project);
    if (smWinOpen()) smRefreshCells();
  }

  function pushEditorLimits() {
    if (!editor) return;
    var lim = {};
    var axes = (lastHello && lastHello.config && lastHello.config.axes) ||
      (lastHello && lastHello.axes) || (rig && rig.axes) || [];
    axes.forEach(function (ax) {
      lim[ax.id] = {
        max_spd: ax.max_spd != null ? Number(ax.max_spd) : spdMax,
        max_acc: ax.max_acc != null ? Number(ax.max_acc) : accMax,
        min: cfgNum(ax.min),
        max: cfgNum(ax.max)
      };
    });
    (rig && rig.axes || []).forEach(function (ax) {
      if (!lim[ax.id]) {
        lim[ax.id] = {
          max_spd: Number(ax.max_spd) || spdMax,
          max_acc: Number(ax.max_acc) || accMax,
          min: cfgNum(ax.min),
          max: cfgNum(ax.max)
        };
      } else {
        if (ax.max_spd != null) lim[ax.id].max_spd = Number(ax.max_spd);
        if (ax.max_acc != null) lim[ax.id].max_acc = Number(ax.max_acc);
        if (lim[ax.id].min == null) {
          var nmin = cfgNum(ax.min);
          if (nmin != null) lim[ax.id].min = nmin;
        }
        if (lim[ax.id].max == null) {
          var nmax = cfgNum(ax.max);
          if (nmax != null) lim[ax.id].max = nmax;
        }
      }
    });
    editor.setLimits(lim);
    editor.setPathBuffer(pathBufferSize);
    updateMaxTLabel();
    updatePlayEnabled();
  }

  function updateMaxTLabel() {
    if (!editor) return;
    if ($("tlMaxT")) $("tlMaxT").textContent = "max " + Math.floor(editor.maxT) + " s";
    if ($("cfgHz") && document.activeElement !== $("cfgHz")) $("cfgHz").value = String(editor.playHz);
  }

  function updatePlayEnabled() {
    var bad = !editor || editor.hasLimitViolation();
    function setBad(el) {
      if (el) el.disabled = bad;
    }
    ["tlPlay", "tlPlayRev", "tlPlayFrom"].forEach(function (id) { setBad($(id)); });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ctrl-play, .js-ctrl-play-rev, .js-ctrl-play-from, .js-ctrl-play-from-rev"), setBad);
  }

  function syncKeyTV() {
    var tEl = $("tlKeyT");
    var vEl = $("tlKeyV");
    if (!tEl || !vEl || !editor) return;
    var k = editor.selectedKey();
    syncInterpButtons();
    if (!k) {
      tEl.value = "";
      vEl.value = "";
      tEl.disabled = true;
      vEl.disabled = true;
      return;
    }
    tEl.disabled = Number(k.t) <= 1e-6;
    vEl.disabled = false;
    if (document.activeElement !== tEl) tEl.value = Number(k.t).toFixed(3);
    if (document.activeElement !== vEl) vEl.value = String(k.value);
  }

  function syncInterpButtons() {
    var st = editor && editor.interpState ? editor.interpState() : { kind: "", easeIn: false, easeOut: false, easeInOut: false };
    Array.prototype.forEach.call(document.querySelectorAll("[data-interp]"), function (b) {
      var v = b.getAttribute("data-interp");
      var on = false;
      if (v === "ease_in") on = !!st.easeIn;
      else if (v === "ease_out") on = !!st.easeOut;
      else if (v === "ease_inout") on = !!st.easeInOut;
      else on = st.kind === v;
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function applyRigNames(lanes) {
    if (!rig || !rig.axes) return lanes;
    (lanes || []).forEach(function (ln) {
      rig.axes.forEach(function (ax) {
        if (ax.id === ln.id) { ln.name = ax.name; ln.unit = ax.unit; }
      });
    });
    return lanes;
  }

  function projName() {
    return project.name || "untitled";
  }

  function timelineCsv() {
    var lanes = editor.lanes.slice().sort(function (a, b) { return a.id - b.id; });
    var dt = 1 / (editor.playHz || 50);
    var n = Math.max(0, Math.ceil(editor.motionDuration() / dt));
    var head = ["Time"];
    lanes.forEach(function (ln) {
      head.push("Pos" + ln.id, "Spd" + ln.id, "Acc" + ln.id);
    });
    var rows = [head.join(",")];
    var prevV = lanes.map(function (ln) { return TimelineEditor.evalAxis(ln.keys, 0); });
    var prevS = lanes.map(function () { return 0; });
    for (var i = 0; i <= n; i++) {
      var t = i * dt;
      var row = [t.toFixed(3)];
      lanes.forEach(function (ln, j) {
        var v = TimelineEditor.evalAxis(ln.keys, t);
        var spd = i >= 1 ? (v - prevV[j]) / dt : 0;
        var acc = i >= 2 ? (spd - prevS[j]) / dt : 0;
        row.push(v.toFixed(3), spd.toFixed(3), acc.toFixed(3));
        prevV[j] = v;
        prevS[j] = spd;
      });
      rows.push(row.join(","));
    }
    return rows.join("\r\n") + "\r\n";
  }

  function timelineAxes() {
    var out = {};
    (rig && rig.axes || []).forEach(function (ax) {
      out[ax.id] = {
        id: ax.id, name: ax.name, unit: ax.unit,
        min: Number(ax.min) || 0, max: Number(ax.max) || 0,
        max_spd: Number(ax.max_spd) || spdMax, max_acc: Number(ax.max_acc) || accMax
      };
    });
    var hello = (lastHello && lastHello.config && lastHello.config.axes) ||
      (lastHello && lastHello.axes) || [];
    hello.forEach(function (ax) {
      var a = out[ax.id];
      if (!a) return;
      if (ax.max_spd != null) a.max_spd = Number(ax.max_spd);
      if (ax.max_acc != null) a.max_acc = Number(ax.max_acc);
    });
    return Object.keys(out).map(function (id) { return out[id]; })
      .sort(function (a, b) { return a.id - b.id; });
  }

  function timelineObj() {
    return {
      format: "slidermoco-timeline",
      version: 1,
      name: projName(),
      play_hz: editor.playHz,
      markers: editor.markers.map(function (mk) {
        mk = window.TimelineEditor && TimelineEditor.normalizeMarker
          ? TimelineEditor.normalizeMarker(mk) : mk;
        var o = {
          t: Number(mk.t) || 0,
          symbol: mk.symbol || "B",
          beep: !!mk.beep,
          bloop: !!mk.bloop,
          camera: !!mk.camera
        };
        var n, v;
        for (n = 1; n <= 4; n++) {
          v = mk["ext" + n];
          if (v != null) o["ext" + n] = v ? 1 : 0;
        }
        return o;
      }),
      lanes: editor.lanes.map(function (ln) {
        return {
          id: ln.id, name: ln.name, unit: ln.unit,
          keys: (ln.keys || []).map(function (k) {
            return {
              t: Number(k.t) || 0,
              value: Number(k.value) || 0,
              interp: k.interp || "auto",
              in: { dx: Number(k.in && k.in.dx) || 0, dy: Number(k.in && k.in.dy) || 0 },
              out: { dx: Number(k.out && k.out.dx) || 0, dy: Number(k.out && k.out.dy) || 0 }
            };
          })
        };
      }),
      axes: timelineAxes()
    };
  }

  var MAYA_CHANNELS = [
    { slot: "tx", curve: "translateX", attr: "tx", type: "animCurveTL", scale: 0.1, names: ["slide", "dolly", "track", "x"] },
    { slot: "ty", curve: "translateY", attr: "ty", type: "animCurveTL", scale: 0.1, names: ["height", "lift", "elev", "y"] },
    { slot: "tz", curve: "translateZ", attr: "tz", type: "animCurveTL", scale: 0.1, names: ["z"] },
    { slot: "rx", curve: "rotateX", attr: "rx", type: "animCurveTA", scale: 1, names: ["tilt", "rx"] },
    { slot: "ry", curve: "rotateY", attr: "ry", type: "animCurveTA", scale: 1, names: ["pan", "ry"] },
    { slot: "rz", curve: "rotateZ", attr: "rz", type: "animCurveTA", scale: 1, names: ["roll", "rz"] }
  ];

  function mayaNum(v) {
    if (!isFinite(v)) v = 0;
    var s = v.toFixed(6);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s === "-0" ? "0" : s;
  }

  function mayaCurve(name, type, samples) {
    var lines = [
      'createNode ' + type + ' -n "' + name + '";',
      '\tsetAttr ".tan" 9;',
      '\tsetAttr ".wgt" no;'
    ];
    var pairs = samples.map(function (s) { return s.frame + " " + mayaNum(s.value); });
    var body = [];
    for (var i = 0; i < pairs.length; i += 8) {
      body.push("\t\t" + pairs.slice(i, i + 8).join(" "));
    }
    lines.push('\tsetAttr -s ' + pairs.length + ' ".ktv[0:' + (pairs.length - 1) + ']"');
    lines.push(body.join("\n") + ";");
    return lines.join("\n");
  }

  function mayaCameraText() {
    var fps = Number(project.frame_rate) || 30;
    var dt = 1 / fps;
    var n = Math.max(0, Math.ceil(editor.motionDuration() / dt));
    var bySlot = {};
    editor.lanes.forEach(function (ln) {
      var nm = String(ln.name || "").toLowerCase();
      MAYA_CHANNELS.forEach(function (ch) {
        if (bySlot[ch.slot]) return;
        if (ch.names.indexOf(nm) >= 0) bySlot[ch.slot] = ln;
      });
    });
    var out = [
      "//Maya ASCII 5.0 scene",
      "//Name: " + projName() + ".ma",
      'requires maya "5.0";',
      "currentUnit -l centimeter -a degree -t ntsc;",
      'fileInfo "application" "slidermoco";',
      'createNode transform -n "sliderCam";',
      'createNode camera -n "sliderCamShape" -p "sliderCam";',
      '\tsetAttr -k off ".v";',
      '\tsetAttr ".fl" 35;',
      '\tsetAttr ".ncp" 0.01;',
      '\tsetAttr ".imn" -type "string" "sliderCam";',
      '\tsetAttr ".den" -type "string" "sliderCam_depth";',
      '\tsetAttr ".man" -type "string" "sliderCam_mask";'
    ];
    MAYA_CHANNELS.forEach(function (ch) {
      var ln = bySlot[ch.slot];
      var samples = [];
      for (var i = 0; i <= n; i++) {
        var t = i * dt;
        var v = ln ? TimelineEditor.evalAxis(ln.keys, t) * ch.scale : 0;
        samples.push({ frame: i + 1, value: v });
      }
      out.push(mayaCurve("sliderCam_" + ch.curve, ch.type, samples));
    });
    MAYA_CHANNELS.forEach(function (ch) {
      out.push('connectAttr "sliderCam_' + ch.curve + '.o" "sliderCam.' + ch.attr + '";');
    });
    return out.join("\n") + "\n";
  }

  function isTimelineFile(o) {
    var fmt = o && o.format;
    return fmt === "slidermoco-timeline" || fmt === "sliderhost-timeline";
  }

  function importTimeline(o) {
    if (!o || !isTimelineFile(o) || !Array.isArray(o.lanes)) {
      alert("Not a SliderMoCo timeline file.");
      return;
    }
    if (!window.confirm("Replace the current timeline with the imported one?")) return;
    var lanes = o.lanes.map(function (ln) {
      return {
        id: Number(ln.id),
        name: ln.name,
        unit: ln.unit,
        keys: (ln.keys || []).map(function (k) {
          return {
            t: Number(k.t) || 0,
            value: Number(k.value) || 0,
            interp: k.interp || "bezier",
            in: { dx: Number(k.in && k.in.dx) || 0, dy: Number(k.in && k.in.dy) || 0 },
            out: { dx: Number(k.out && k.out.dx) || 0, dy: Number(k.out && k.out.dy) || 0 }
          };
        })
      };
    });
    var hz = Number(o.play_hz);
    if (hz >= 10 && hz <= 200 && pathBufferSize / hz + 1e-9 >= TimelineEditor.duration(lanes)) {
      editor.setPlayHz(hz);
    }
    editor.setMarkers(Array.isArray(o.markers) ? o.markers : []);
    editor.setLanes(applyRigNames(lanes));
    editor.fit();
    saveTimeline();
    updateMaxTLabel();
    updatePlayEnabled();
    syncKeyTV();
  }

  function refreshTimeFields() {
    if (!editor) return;
    if ($("tsPct")) $("tsPct").value = "100";
    if ($("tsSec")) $("tsSec").value = editor.motionDuration().toFixed(2);
    if ($("tsMove")) $("tsMove").value = "0";
  }

  function tooLongAlert() {
    alert("Refused: the path would not fit in max " + Math.floor(editor.maxT) + " s.");
  }

  function bindTimelineMenu() {
    function pick(fn) {
      return function () {
        var wrap = this.closest ? this.closest("details") : null;
        if (wrap) wrap.open = false;
        if (editor) fn();
      };
    }
    function bindAll(sel, fn) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
        el.onclick = pick(fn);
      });
    }
    bindAll(".js-tl-csv", function () {
      SHProject.downloadText(projName() + "_timeline.csv", timelineCsv(), "text/csv;charset=utf-8");
    });
    bindAll(".js-tl-export", function () {
      SHProject.download(projName() + ".timeline.json", timelineObj());
    });
    bindAll(".js-tl-maya", function () {
      SHProject.downloadText(projName() + ".ma", mayaCameraText(), "text/plain;charset=utf-8");
    });
    function pickAlways(fn) {
      return function () {
        var wrap = this.closest ? this.closest("details") : null;
        if (wrap) wrap.open = false;
        fn();
      };
    }
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-export"), function (el) {
      el.onclick = pickAlways(exportAbPositions);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-sm-csv"), function (el) {
      el.onclick = pickAlways(exportSmCsv);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-sm-txt"), function (el) {
      el.onclick = pickAlways(exportSmTxt);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-ab-import"), function (el) {
      el.onclick = pickAlways(function () {
        if ($("abFile")) $("abFile").click();
      });
    });
    if ($("abFile")) {
      $("abFile").onchange = function () {
        SHProject.readFile($("abFile"), importAbPositions);
      };
    }
    bindAll(".js-tl-import", function () { $("tlFile").click(); });
    if ($("tlFile")) {
      $("tlFile").onchange = function () {
        SHProject.readFile($("tlFile"), function (o) { if (editor) importTimeline(o); });
      };
    }
    bindAll(".js-tl-time", function () {
      refreshTimeFields();
      $("timeDlg").showModal();
    });
    if ($("tsPctSet")) {
      $("tsPctSet").onclick = function () {
        if (!editor) return;
        var pct = Number($("tsPct").value);
        if (!isFinite(pct) || pct <= 0) return;
        pct = Math.max(1, Math.min(1000, pct));
        if (!editor.scaleTime(pct / 100)) tooLongAlert();
        refreshTimeFields();
        updateMaxTLabel();
      };
    }
    if ($("tsSecSet")) {
      $("tsSecSet").onclick = function () {
        if (!editor) return;
        var target = Number($("tsSec").value);
        var dur = editor.motionDuration();
        if (!isFinite(target) || target <= 0 || dur <= 0) return;
        if (!editor.scaleTime(target / dur)) tooLongAlert();
        refreshTimeFields();
        updateMaxTLabel();
      };
    }
    if ($("tsMoveSet")) {
      $("tsMoveSet").onclick = function () {
        if (!editor) return;
        var dt = Number($("tsMove").value);
        if (!isFinite(dt) || Math.abs(dt) < 1e-9) return;
        if (!editor.shiftTime(dt)) {
          alert("Refused: keys would fall outside 0 … " + Math.floor(editor.maxT) + " s.");
        }
        refreshTimeFields();
        updateMaxTLabel();
      };
    }
  }

  function extRowOn(n) {
    var row = document.querySelector(".mk-ext[data-ext='" + n + "']");
    if (row) row.classList.toggle("is-off", !$("mkExt" + n) || !$("mkExt" + n).checked);
  }

  function fillMarkerDlg(mk) {
    if (!mk) return;
    mkFilling = true;
    markerEdit = mk;
    if ($("mkTime")) $("mkTime").textContent = (Number(mk.t) || 0).toFixed(2) + " s";
    if ($("mkSymbol")) $("mkSymbol").value = mk.symbol || "";
    if ($("mkBeep")) $("mkBeep").checked = !!mk.beep;
    if ($("mkBloop")) $("mkBloop").checked = !!mk.bloop;
    if ($("mkCamera")) $("mkCamera").checked = !!mk.camera;
    var n, val;
    for (n = 1; n <= 4; n++) {
      val = mk["ext" + n];
      if ($("mkExt" + n)) $("mkExt" + n).checked = val != null;
      if ($("mkExt" + n + "Val")) $("mkExt" + n + "Val").checked = val === 1;
      extRowOn(n);
    }
    mkFilling = false;
  }

  function applyMarkerDlg() {
    if (mkFilling || !markerEdit) return;
    var mk = markerEdit;
    var raw = $("mkSymbol") ? $("mkSymbol").value : "";
    var sym = "";
    var i, c, n;
    for (i = 0; i < raw.length; i++) {
      c = raw.charAt(i);
      if ((c >= "0" && c <= "9") || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
        sym = c.toUpperCase();
      }
    }
    mk.symbol = sym || mk.symbol || "B";
    if ($("mkSymbol") && $("mkSymbol").value !== mk.symbol) {
      mkFilling = true;
      $("mkSymbol").value = mk.symbol;
      mkFilling = false;
    }
    mk.beep = !!( $("mkBeep") && $("mkBeep").checked );
    mk.bloop = !!( $("mkBloop") && $("mkBloop").checked );
    mk.camera = !!( $("mkCamera") && $("mkCamera").checked );
    for (n = 1; n <= 4; n++) {
      if ($("mkExt" + n) && $("mkExt" + n).checked) {
        mk["ext" + n] = ($("mkExt" + n + "Val") && $("mkExt" + n + "Val").checked) ? 1 : 0;
      } else {
        mk["ext" + n] = null;
      }
      extRowOn(n);
    }
    if (editor) {
      editor.draw();
      editor.onChange();
    }
  }

  function closeMarkerDlg() {
    markerEdit = null;
    var dlg = $("markerDlg");
    if (dlg && dlg.open) dlg.close();
  }

  function openMarkerDlg(mk) {
    if (!mk) return;
    fillMarkerDlg(mk);
    var dlg = $("markerDlg");
    if (dlg && typeof dlg.showModal === "function" && !dlg.open) dlg.showModal();
  }

  function syncMarkerDlg() {
    if (!markerEdit || !editor) return;
    if (editor.markers.indexOf(markerEdit) < 0) {
      closeMarkerDlg();
      return;
    }
    if ($("mkTime")) $("mkTime").textContent = (Number(markerEdit.t) || 0).toFixed(2) + " s";
  }

  var markerDlgBound = false;
  function bindMarkerDlg() {
    var dlg = $("markerDlg");
    if (!dlg) return;
    if (!markerDlgBound) {
      markerDlgBound = true;
      dlg.addEventListener("click", function (ev) {
        if (ev.target === dlg) dlg.close();
      });
      dlg.addEventListener("close", function () { markerEdit = null; });
    }
    ["mkBeep", "mkBloop", "mkCamera", "mkExt1", "mkExt2", "mkExt3", "mkExt4",
      "mkExt1Val", "mkExt2Val", "mkExt3Val", "mkExt4Val"].forEach(function (id) {
      var el = $(id);
      if (el) el.onchange = applyMarkerDlg;
    });
    if ($("mkSymbol")) $("mkSymbol").oninput = applyMarkerDlg;
    if ($("mkTest")) {
      $("mkTest").onclick = function () {
        applyMarkerDlg();
        fireMarker(markerEdit);
      };
    }
    if ($("mkDelete")) {
      $("mkDelete").onclick = function () {
        var mk = markerEdit;
        closeMarkerDlg();
        if (editor && mk) editor.removeMarker(mk);
      };
    }
  }

  function bindTimeline() {
    var canvas = $("tlCanvas");
    if (!canvas || !window.TimelineEditor) return;
    closeMarkerDlg();
    editor = new TimelineEditor({
      canvas: canvas,
      tracksEl: $("tlTracks"),
      editEl: $("tlKeyEdit"),
      onChange: function () {
        saveTimeline();
        updatePlayEnabled();
        syncKeyTV();
        updateAbcEtas();
        syncMarkerDlg();
      },
      onPlayhead: onPlayhead,
      onSelChange: function () { syncKeyTV(); },
      onLimitsChange: function () { updatePlayEnabled(); },
      onTracksChange: function () { syncCtrlReadouts(); },
      onMarkerEdit: function (mk) { openMarkerDlg(mk); }
    });
    window.timelineEditor = editor;
    applyRigNames(project.lanes);
    editor.setMarkers(project.markers || []);
    editor.setPlayHz(project.play_hz || 50);
    editor.setPathBuffer(pathBufferSize);
    editor.setLanes(project.lanes);
    editor.fit();
    pushEditorLimits();
    Array.prototype.forEach.call(document.querySelectorAll("[data-interp]"), function (b) {
      b.onclick = function () { editor.setInterp(b.getAttribute("data-interp")); };
    });
    if ($("showHandles")) {
      $("showHandles").onchange = function () {
        editor.showHandles = $("showHandles").checked;
        editor.draw();
      };
    }
    if ($("tlFit")) $("tlFit").onclick = function () { editor.fitY(); };
    if ($("tlFitX")) $("tlFitX").onclick = function () { editor.fitX(); };
    function jumpVisibleKey(dir, seek) {
      if (!editor.jumpVisibleKey(dir)) return;
      var t = editor.playhead;
      if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
      if (seek) onPlayhead(t, true, true);
    }
    function bindJumpKey(el, dir) {
      if (!el) return;
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        jumpVisibleKey(dir, false);
      });
      el.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        jumpVisibleKey(dir, true);
      });
    }
    bindJumpKey($("tlPrevKey"), -1);
    bindJumpKey($("tlNextKey"), 1);
    if ($("tlKey")) $("tlKey").onclick = function () { editor.keyAtPlayhead(editor.live); };
    bindMarkerDlg();
    if ($("tlMarker")) {
      $("tlMarker").onclick = function () {
        openMarkerDlg(editor.addMarkerAtPlayhead());
      };
    }
    if ($("tlPlay")) $("tlPlay").onclick = function () { if (mcIdle()) playGraph("fwd"); };
    if ($("tlPlayRev")) $("tlPlayRev").onclick = function () { if (mcIdle()) playGraph("rev"); };
    if ($("tlPlayFrom")) $("tlPlayFrom").onclick = function () { if (mcIdle()) playGraph("from"); };
    if ($("tlToStart")) {
      $("tlToStart").onclick = function () {
        editor.playhead = 0;
        editor.draw();
        if ($("tlTime")) $("tlTime").textContent = "0.00 s";
        seekAtMax(editor.poseAt(0));
      };
    }
    if ($("tlToEnd")) {
      $("tlToEnd").onclick = function () {
        var t = editor.motionDuration();
        editor.playhead = t;
        editor.draw();
        if ($("tlTime")) $("tlTime").textContent = t.toFixed(2) + " s";
        seekAtMax(editor.poseAt(t));
      };
    }
    bindTimelineMenu();
    function commitTV() {
      if (!editor) return;
      var t = Number($("tlKeyT").value);
      var v = Number($("tlKeyV").value);
      editor.setSelectedTV(isNaN(t) ? null : t, isNaN(v) ? null : v);
    }
    if ($("tlKeyT")) $("tlKeyT").onchange = commitTV;
    if ($("tlKeyV")) $("tlKeyV").onchange = commitTV;
    syncKeyTV();
    updateMaxTLabel();
    updatePlayEnabled();
  }

  function rebuild() {
    project.mark_count = clampMarkCount(project && project.mark_count);
    cancelTimelinePlay();
    cancelAbcLoop();
    var phone = SHLayout.phoneMode();
    SHLayout.applyPhoneChrome();
    if (phone) {
      $("workspace").innerHTML = "";
      editor = null;
      window.timelineEditor = null;
    } else {
      SHLayout.renderWorkspace($("workspace"), project.layout, project.panels);
    }
    bindButtons(document);
    bindFloatWins();
    bindSm();
    if (!phone) {
      fillAxisJog(liveAxes());
      bindTimeline();
      fillCtrlAxes(liveAxes());
      bindCtrlPanel();
      bindTimelineMenu();
    }
    bindJoy();
    fillAbcBlocks();
    fillTlMarks();
    fillAbDlg();
    if (window.SWUi) SWUi.init();
    fillPanelToggles();
    fillConfig();
    if (liveAxes().length) renderInfo(liveAxes());
  }

  function fillPanelToggles() {
    var box = $("topPanelToggles");
    if (!box) return;
    box.innerHTML = "";
    SHLayout.PANELS.forEach(function (p) {
      var on = !!(project.panels && project.panels[p.id]);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn sm " + (on ? "ochre" : "ghost");
      btn.setAttribute("data-panel", p.id);
      btn.textContent = p.title;
      btn.onclick = function () {
        if (!project.panels) project.panels = SHLayout.defaultVisible();
        project.panels[p.id] = !project.panels[p.id];
        SHProject.saveProject(project);
        rebuild();
      };
      box.appendChild(btn);
    });
  }

  function fillConfig() {
    if ($("cfgFps")) $("cfgFps").value = project.frame_rate || 30;
    if ($("cfgMarks")) $("cfgMarks").value = String(markCount());
    if ($("cfgHz")) $("cfgHz").value = String(editor ? editor.playHz : (project.play_hz || 50));
    if ($("cfgName")) $("cfgName").value = project.name || "untitled";
    var ra = $("rigAxes");
    if (ra) {
      ra.innerHTML = "";
      (rig.axes || []).forEach(function (ax) {
        var d = document.createElement("div");
        d.className = "hint";
        d.textContent = "#" + ax.id + " " + ax.name + "  " +
          (ax.min == null ? "none" : ax.min) + "–" + (ax.max == null ? "none" : ax.max) +
          " " + ax.unit +
          "  mc " + (ax.mc_id || 1) + " slot " + (ax.slot || ax.id);
        ra.appendChild(d);
      });
    }
  }

  function init() {
    $("btnConfig").onclick = function () { $("configDlg").showModal(); };
    $("cfgFps").onchange = function () {
      project.frame_rate = Number($("cfgFps").value) || 30;
      SHProject.saveProject(project);
      smOnFpsChange();
    };
    if ($("cfgMarks")) {
      $("cfgMarks").onchange = function () {
        var n = clampMarkCount($("cfgMarks").value);
        $("cfgMarks").value = String(n);
        project.mark_count = n;
        SHProject.saveProject(project);
        applyMarkCount();
      };
    }
    $("cfgHz").onchange = function () {
      var hz = Number($("cfgHz").value);
      if (isNaN(hz)) hz = editor ? editor.playHz : (project.play_hz || 50);
      hz = Math.max(10, Math.min(200, hz));
      if (!editor) {
        project.play_hz = hz;
        SHProject.saveProject(project);
        $("cfgHz").value = String(hz);
        return;
      }
      if (pathBufferSize / hz + 1e-9 < editor.motionDuration()) {
        $("cfgHz").value = String(editor.playHz);
        return;
      }
      editor.setPlayHz(hz);
      saveTimeline();
      updateMaxTLabel();
      updatePlayEnabled();
      $("cfgHz").value = String(hz);
    };
    $("cfgName").onchange = function () {
      project.name = $("cfgName").value;
      SHProject.saveProject(project);
    };
    $("projSave").onclick = function () {
      project.layout = project.layout;
      project.lanes = editor ? editor.lanes : project.lanes;
      project.markers = editor ? editor.markers : project.markers;
      project.play_hz = editor ? editor.playHz : project.play_hz;
      SHProject.saveProject(project);
      SHProject.download((project.name || "project") + ".json", project);
    };
    $("projLoad").onclick = function () { $("projFile").click(); };
    $("projFile").onchange = function () {
      SHProject.readFile($("projFile"), function (o) {
        project = o;
        SHProject.saveProject(project);
        rebuild();
      });
    };
    $("rigSave").onclick = function () {
      SHProject.saveRig(rig);
      SHProject.download((rig.name || "rig") + ".json", rig);
    };
    $("rigLoad").onclick = function () { $("rigFile").click(); };
    $("rigFile").onchange = function () {
      SHProject.readFile($("rigFile"), function (o) {
        rig = o;
        SHProject.saveRig(rig);
        rebuild();
      });
    };
    if ($("phoneOpenConfig")) {
      $("phoneOpenConfig").onclick = function () { $("configDlg").showModal(); };
    }
    lastPhone = SHLayout.phoneMode();
    rebuild();
    bindKbKeys();
    connect();
    setInterval(function () { send({ wdt: "alive" }); }, WDT_MS);
    window.addEventListener("resize", function () {
      var phone = SHLayout.phoneMode();
      if (lastPhone == null) {
        lastPhone = phone;
        return;
      }
      if (phone !== lastPhone) {
        lastPhone = phone;
        rebuild();
      } else if (editor) editor.draw();
    });
  }

  init();
})();
