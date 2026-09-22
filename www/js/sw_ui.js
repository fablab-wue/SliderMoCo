(function (global) {
  "use strict";

  var TAP_MS = 333;
  var MARK_MS = 1000;
  var HALT_MS = 1000;
  var DISABLE_MS = 2000;
  var GAMMA = 2.0;
  var SS_MS = 80;
  var WDT_MS = 1000;
  var MARKS_KEY = "sw_marks";
  var SWAP_DIR_KEY = "sw_swap_dir";
  var SWAP_DIR2_KEY = "sw_swap_dir2";
  var AXIS_MASK_KEY = "sw_axis_mask";
  var TL_MSM_KEY = "sw_tl_msm";
  var CLI_CMDS_KEY = "sw_cli_cmds";
  var PPM_NEAR_MM = 1.0;

  var ws = null;
  var pollTimer = null;
  var wdtTimer = null;
  var offlineSince = 0;
  var lastStatus = {};
  var lastHello = null;
  var draggingSpeed = false;
  var draggingAccel = false;
  var ssTimer = 0;
  var saTimer = 0;
  var axisMask = 1;
  var spdMin = 1;
  var spdMax = 100;
  var accMin = 1;
  var accMax = 500;
  var held = {};
  var cmdSpd = 40;
  var cmdAcc = null;
  var swapDir = false;
  var swapDir2 = false;
  var syncEnableSilent = false;
  var unitPos = "mm";
  var unitSpd = "mm/s";
  var unitAcc = "mm/s²";
  var unitPos2 = "mm";
  var unitSpd2 = "mm/s";
  var unitAcc2 = "mm/s²";
  var optionHeld = false;
  var cruise = { locked: false, dir: 0, axis: 1 };
  var marks = { a: null, b: null, c: null, d: null, e: null, f: null, g: null, h: null };
  var cfgCache = {};
  var softLimits = { min: null, max: null, min2: null, max2: null };
  var session = { enabled: false, ss: 40, sa: null };
  var activeTask = null;
  var abcChordLatch = false;
  var tlFactorVal = 10;
  var tlExposureVal = 0.1;
  var tlMsmOn = false;
  var tlMsmLoaded = false;
  var TL_FPS_FIXED = 30;

  function $(id) {
    return document.getElementById(id);
  }

  /** ETA seconds for distance at cruise speed. */
  function etaSeconds(distance, speed, accel) {
    var d = Math.abs(Number(distance));
    var s = Number(speed);
    if (!(d > 0) || !(s > 0) || isNaN(d) || isNaN(s)) return null;
    return d / s;
  }

  /**
   * Cruise speed for distance d in time T with accel a (trapezoid).
   * If T is shorter than a triangle profile, use v = sqrt(a d).
   */
  function speedFromTime(time, distance, accel) {
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

  function asPose(v) {
    if (v == null) return null;
    var out = {};
    var i;
    var pv;
    if (typeof v === "number") {
      if (isNaN(v)) return null;
      return { 1: v };
    }
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

  function markAxis1(m) {
    var pose = asPose(m);
    return pose ? pose[1] : null;
  }

  function deriveAxisState(global, spd, acc, tgt) {
    var st = global || "?";
    if (st === "E" || st === "L" || st === "D" || st === "H") return st;
    if (st === "?") return "?";
    var v = spd != null && !isNaN(spd) ? Math.abs(Number(spd)) : 0;
    if (v > 0.05) {
      if (st === "A" || st === "B") return st;
      return "M";
    }
    if (tgt != null && !isNaN(Number(tgt))) return "M";
    return "I";
  }

  function setStateLetter(el, letter, subtle) {
    if (!el) return;
    el.textContent = letter || "?";
    el.classList.toggle("dim", !!subtle);
  }

  function setNum(el, v, d) {
    if (!el) return;
    var intEl = el.querySelector(".int");
    var fracEl = el.querySelector(".frac");
    if (!intEl || !fracEl) return;
    d = d == null ? 1 : d;
    if (v === null || v === undefined || v === "") {
      intEl.textContent = "—";
      fracEl.textContent = "—";
      return;
    }
    var n = Number(v);
    if (isNaN(n)) {
      intEl.textContent = "—";
      fracEl.textContent = "—";
      return;
    }
    var s = n.toFixed(d);
    var i = s.indexOf(".");
    if (i < 0) {
      intEl.textContent = s;
      fracEl.textContent = "0";
      return;
    }
    intEl.textContent = s.slice(0, i);
    fracEl.textContent = s.slice(i + 1);
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

  function speedSliders() {
    var a = [
      $("spdSlider"),
      $("spdSliderHome"),
      $("spdSliderAbc"),
      $("spdSliderJoy"),
      $("spdSliderCli")
    ].filter(Boolean);
    Array.prototype.forEach.call(document.querySelectorAll(".js-spd"), function (el) {
      if (a.indexOf(el) < 0) a.push(el);
    });
    return a;
  }

  function speedLabels() {
    var a = [$("ssVal"), $("ssValHome"), $("ssValAbc"), $("ssValJoy"), $("ssValCli")].filter(Boolean);
    Array.prototype.forEach.call(document.querySelectorAll(".js-ss-val"), function (el) {
      if (a.indexOf(el) < 0) a.push(el);
    });
    return a;
  }

  function updateAccBounds() {
    if (cfgCache.min_speed != null) accMin = Number(cfgCache.min_speed);
    else if (cfgCache.spd_min != null) accMin = Number(cfgCache.spd_min);
    else accMin = 1;
    if (cfgCache.max_accel != null) accMax = Number(cfgCache.max_accel);
    else accMax = 500;
    if (isNaN(accMin) || accMin < 0.001) accMin = 1;
    if (isNaN(accMax) || accMax < accMin) accMax = Math.max(accMin, 500);
  }

  function sliderToAccel(t) {
    t = Math.max(0, Math.min(1, t));
    return accMin + (accMax - accMin) * t;
  }

  function accelToSlider(v) {
    var u = (Number(v) - accMin) / Math.max(1e-9, accMax - accMin);
    u = Math.max(0, Math.min(1, u));
    return Math.round(u * 1000);
  }

  function syncAccelUi(v, sliderEl) {
    cmdAcc = Number(v);
    if (isNaN(cmdAcc)) return;
    var sv = String(accelToSlider(cmdAcc));
    var el = sliderEl || $("accSliderHome");
    if (el) el.value = sv;
    setNum($("accValHome"), cmdAcc);
  }

  function emitSa(force) {
    var el = $("accSliderHome");
    if (!el) return;
    var t = Number(el.value) / 1000;
    var v = sliderToAccel(t);
    syncAccelUi(v, el);
    session.sa = v;
    cmdAcc = v;
    var now = Date.now();
    if (!force && now - saTimer < SS_MS) return;
    saTimer = now;
    sendMc("SA " + fmtSs(v));
  }

  function fmtCfg(v) {
    if (v == null || v === "" || isNaN(Number(v))) return "—";
    return Number(v).toFixed(1);
  }

  function motorCount(cfg) {
    cfg = cfg || {};
    if (cfg.motors != null && cfg.motors !== "") {
      var n = Number(cfg.motors);
      if (n >= 1) return n;
    }
    return Number(cfg.axis_count || 1);
  }

  function normalizeUnit(raw) {
    var u = String(raw != null ? raw : "mm").trim();
    if (!u) u = "mm";
    var low = u.toLowerCase();
    if (low === "deg" || low === "degree" || low === "degrees" || u === "°") return "°";
    return u;
  }

  function applyUnitsFromConfig(cfg) {
    cfg = cfg || cfgCache || {};
    var u1 = normalizeUnit(cfg.unit_name || cfg.unit || "mm");
    unitPos = u1;
    unitSpd = u1 + "/s";
    unitAcc = u1 + "/s²";
    var dual = motorCount(cfg) >= 2;
    var u2 = u1;
    if (dual) {
      if (cfg.unit_name_2 != null && String(cfg.unit_name_2).trim()) {
        u2 = normalizeUnit(cfg.unit_name_2);
      }
    }
    unitPos2 = u2;
    unitSpd2 = u2 + "/s";
    unitAcc2 = u2 + "/s²";
    updateUnitLabels();
  }

  function updateUnitLabels() {
    if ($("posUnit")) $("posUnit").textContent = unitPos;
    if ($("spdUnit")) $("spdUnit").textContent = unitSpd;
    if ($("accUnit")) $("accUnit").textContent = unitAcc;
    if ($("pos2Unit")) $("pos2Unit").textContent = unitPos2;
    if ($("spd2Unit")) $("spd2Unit").textContent = unitSpd2;
    if ($("acc2Unit")) $("acc2Unit").textContent = unitAcc2;
    document.querySelectorAll(".slider-meta .unit[data-unit]").forEach(function (el) {
      var kind = el.getAttribute("data-unit");
      var ax = Number(el.getAttribute("data-axis") || 1);
      if (kind === "spd") el.textContent = ax === 2 ? unitSpd2 : unitSpd;
      else if (kind === "acc") el.textContent = ax === 2 ? unitAcc2 : unitAcc;
      else if (kind === "pos") el.textContent = ax === 2 ? unitPos2 : unitPos;
    });
  }

  function buildInfoBox() {
    var body = document.querySelector("#infoBox .info-body");
    if (!body) return;
    var c = cfgCache;
    var name = c.name != null && String(c.name).trim() ? String(c.name).trim() : "Slider";
    if (lastHello && lastHello.mc_name) {
      name = String(lastHello.mc_name).trim() || name;
    }
    var dual = motorCount(c) >= 2;
    var sizeLine =
      "Slider size: " +
      fmtCfg(c.slider_min) +
      " - " +
      fmtCfg(c.slider_max) +
      " " +
      unitPos;
    if (dual && c.slider_min_2 != null && c.slider_max_2 != null) {
      sizeLine +=
        " / " +
        fmtCfg(c.slider_min_2) +
        " - " +
        fmtCfg(c.slider_max_2) +
        " " +
        unitPos2;
    }
    var spdLine = "Max speed: " + fmtCfg(c.max_speed) + " " + unitSpd;
    if (dual && c.max_speed_2 != null) {
      if (unitSpd2 === unitSpd) {
        spdLine += " / " + fmtCfg(c.max_speed_2);
      } else {
        spdLine += " / " + fmtCfg(c.max_speed_2) + " " + unitSpd2;
      }
    }
    var accLine = "Max accel: " + fmtCfg(c.max_accel) + " " + unitAcc;
    if (dual && c.max_accel_2 != null) {
      if (unitAcc2 === unitAcc) {
        accLine += " / " + fmtCfg(c.max_accel_2);
      } else {
        accLine += " / " + fmtCfg(c.max_accel_2) + " " + unitAcc2;
      }
    }
    var protoLine = "";
    if (lastHello && lastHello.sim) {
      protoLine = "\nMC: sim";
    } else if (lastHello && lastHello.linked && lastHello.proto) {
      protoLine = "\nMC V1 / VP " + String(lastHello.proto);
    } else if (lastHello && lastHello.linked === false) {
      protoLine = "\nnot an MC";
    }
    body.textContent =
      "Name: " + name + "\n" + sizeLine + "\n" + spdLine + "\n" + accLine + protoLine;
  }

  function isDrvError() {
    return lastStatus.state === "E";
  }

  function syncEnableUi(enabled) {
    var block = isDrvError();
    syncEnableSilent = true;
    function apply(inp) {
      if (!inp) return;
      inp.checked = !!enabled;
      inp.disabled = block;
      var wrap = inp.closest(".cell-switch");
      if (wrap) wrap.classList.toggle("disabled", block);
    }
    apply($("enable"));
    document.querySelectorAll(".js-enable").forEach(apply);
    syncEnableSilent = false;
  }

  function loadSwapDirs() {
    try {
      swapDir = localStorage.getItem(SWAP_DIR_KEY) === "1";
      swapDir2 = localStorage.getItem(SWAP_DIR2_KEY) === "1";
    } catch (e) {}
    var d1 = $("dir");
    var d2 = $("dir2");
    if (d1) d1.checked = swapDir;
    if (d2) d2.checked = swapDir2;
  }

  function saveSwapDirs() {
    try {
      localStorage.setItem(SWAP_DIR_KEY, swapDir ? "1" : "0");
      localStorage.setItem(SWAP_DIR2_KEY, swapDir2 ? "1" : "0");
    } catch (e) {}
  }

  function syncAxisMaskUi() {
    document.querySelectorAll(".chip").forEach(function (el) {
      el.classList.toggle("active", Number(el.getAttribute("data-ax")) === axisMask);
    });
  }

  function loadAxisMask() {
    try {
      var v = parseInt(localStorage.getItem(AXIS_MASK_KEY), 10);
      if (v === 0 || v === 1 || v === 2) axisMask = v;
    } catch (e) {}
    syncAxisMaskUi();
  }

  function saveAxisMask() {
    try {
      localStorage.setItem(AXIS_MASK_KEY, String(axisMask));
    } catch (e) {}
  }

  function sendAx(mask) {
    send({ ax: mask });
  }

  function uiAxisDir(sign, axis) {
    axis = Number(axis);
    var swap = axis === 2 ? swapDir2 : swapDir;
    return sign * (swap ? -1 : 1);
  }

  function softSideFromBtn(isLeft, axis) {
    return uiAxisDir(isLeft ? -1 : 1, axis) < 0 ? "min" : "max";
  }

  function syncSpeedUi(v, sliderEl) {
    cmdSpd = Number(v);
    if (isNaN(cmdSpd)) return;
    var sv = String(Math.round(speedToSlider(cmdSpd)));
    speedSliders().forEach(function (el) {
      if (el !== sliderEl) el.value = sv;
    });
    if (sliderEl) sliderEl.value = sv;
    speedLabels().forEach(function (el) {
      if (el.querySelector && el.querySelector("input.ctrl-num")) return;
      if (el.querySelector && el.querySelector(".int")) setNum(el, cmdSpd);
      else el.textContent = Number(cmdSpd).toFixed(1);
    });
    updateEtas();
  }

  function loadMarks() {
    marks = { a: null, b: null, c: null, d: null, e: null, f: null, g: null, h: null };
    try {
      var raw = localStorage.getItem(MARKS_KEY);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return;
      "abcdefgh".split("").forEach(function (k) {
        if (o[k] != null) marks[k] = asPose(o[k]);
      });
    } catch (e) {}
  }

  function saveMarks() {
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    } catch (e) {}
  }

  function send(obj) {
    if (typeof global.__shSend === "function") return global.__shSend(obj);
    var s = JSON.stringify(obj);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(s);
        return true;
      } catch (e) {}
    }
    return false;
  }

  function sendMc(line) {
    return send({ mc: String(line) });
  }

  function sendTask(line) {
    return send({ task: String(line) });
  }

  function sendWdt() {
    return send({ wdt: "alive" });
  }

  function flattenHost(d) {
    if (!d || typeof d !== "object") return d;
    var axes = d.axes;
    if (axes && axes.length) {
      var a1 = axes[0] || {};
      var a2 = axes[1] || {};
      if (d.pos == null) d.pos = a1.pos;
      if (d.spd == null) d.spd = a1.spd;
      if (d.acc == null) d.acc = a1.acc;
      if (d.tgt == null) d.tgt = a1.tgt;
      if (d.state1 == null) d.state1 = a1.state;
      if (d.pos2 == null) d.pos2 = a2.pos;
      if (d.spd2 == null) d.spd2 = a2.spd;
      if (d.acc2 == null) d.acc2 = a2.acc;
      if (d.tgt2 == null) d.tgt2 = a2.tgt;
      if (d.state2 == null) d.state2 = a2.state;
      if (!d.config) d.config = {};
      var c = d.config;
      if (c.slider_min == null) c.slider_min = a1.min;
      if (c.slider_max == null) c.slider_max = a1.max;
      if (c.max_speed == null) c.max_speed = a1.max_spd;
      if (c.max_accel == null) c.max_accel = a1.max_acc;
      if (c.unit_name == null) c.unit_name = a1.unit;
      if (a2.id) {
        c.motors = axes.length;
        c.axis_count = axes.length;
        if (c.slider_min_2 == null) c.slider_min_2 = a2.min;
        if (c.slider_max_2 == null) c.slider_max_2 = a2.max;
        if (c.max_speed_2 == null) c.max_speed_2 = a2.max_spd;
        if (c.max_accel_2 == null) c.max_accel_2 = a2.max_acc;
        if (c.unit_name_2 == null) c.unit_name_2 = a2.unit;
      }
      if (!d.soft) d.soft = {};
      if (d.soft.min == null && a1.soft_min != null) d.soft.min = a1.soft_min;
      if (d.soft.max == null && a1.soft_max != null) d.soft.max = a1.soft_max;
      if (d.soft.min2 == null && a2.soft_min != null) d.soft.min2 = a2.soft_min;
      if (d.soft.max2 == null && a2.soft_max != null) d.soft.max2 = a2.soft_max;
    }
    return d;
  }

  function applyHello(d) {
    d = flattenHost(d);
    if (!d || typeof d !== "object") return;
    lastHello = d;
    if (d.config && typeof d.config === "object") {
      cfgCache = d.config;
      if (cfgCache.max_speed != null) spdMax = Number(cfgCache.max_speed);
      if (cfgCache.spd_min != null) spdMin = Number(cfgCache.spd_min);
      else if (cfgCache.min_speed != null) spdMin = Number(cfgCache.min_speed);
      updateAccBounds();
      applyUnitsFromConfig(cfgCache);
      buildInfoBox();
    }
    if (d.soft && typeof d.soft === "object") {
      softLimits = {
        min: d.soft.min != null ? Number(d.soft.min) : null,
        max: d.soft.max != null ? Number(d.soft.max) : null,
        min2: d.soft.min2 != null ? Number(d.soft.min2) : null,
        max2: d.soft.max2 != null ? Number(d.soft.max2) : null,
      };
    }
    if (d.session && typeof d.session === "object") {
      session.enabled = !!d.session.enabled;
      syncEnableUi(session.enabled);
      if (d.session.ss != null) {
        session.ss = Number(d.session.ss);
        cmdSpd = session.ss;
        if (!draggingSpeed) syncSpeedUi(session.ss, null);
      }
      if (d.session.sa != null) {
        session.sa = Number(d.session.sa);
        cmdAcc = session.sa;
        if (!draggingAccel) syncAccelUi(session.sa, null);
      }
    }
    activeTask = d.task || null;
    buildInfoBox();
    updateEtas();
  }

  function applyStatus(d) {
    if (!d || typeof d !== "object") return;
    d = flattenHost(d);
    if (d.t === "hello") {
      applyHello(d);
      return;
    }
    lastStatus = d;
    if (d.soft && typeof d.soft === "object") {
      softLimits.min = d.soft.min != null ? Number(d.soft.min) : softLimits.min;
      softLimits.max = d.soft.max != null ? Number(d.soft.max) : softLimits.max;
      softLimits.min2 = d.soft.min2 != null ? Number(d.soft.min2) : softLimits.min2;
      softLimits.max2 = d.soft.max2 != null ? Number(d.soft.max2) : softLimits.max2;
    } else {
      if (d.soft_min != null) softLimits.min = Number(d.soft_min);
      if (d.soft_max != null) softLimits.max = Number(d.soft_max);
      if (d.soft_min_2 != null) softLimits.min2 = Number(d.soft_min_2);
      if (d.soft_max_2 != null) softLimits.max2 = Number(d.soft_max_2);
    }
    if (d.session && typeof d.session === "object") {
      session.enabled = !!d.session.enabled;
      syncEnableUi(session.enabled);
      if (d.session.ss != null) session.ss = Number(d.session.ss);
      if (d.session.sa != null) {
        session.sa = Number(d.session.sa);
        cmdAcc = session.sa;
        if (!draggingAccel) syncAccelUi(session.sa, null);
      }
    }
    if (d.task !== undefined) activeTask = d.task;
    setNum($("pos"), d.pos);
    setNum($("spd"), d.spd);
    setNum($("acc"), d.acc);
    var gst = d.state || "?";
    if ($("line1")) $("line1").innerHTML = d.line1 ? d.line1 : "&nbsp;";
    if ($("line2")) $("line2").innerHTML = d.line2 ? d.line2 : "&nbsp;";
    if ($("oled")) $("oled").classList.toggle("warn", !!d.warn);
    syncEnableUi(session.enabled);
    var nax = 1;
    if (Object.prototype.toString.call(d.axes) === "[object Array]") nax = d.axes.length;
    else if (d.axes) nax = Number(d.axes) || 1;
    if (cfgCache.motors != null) {
      var cachedM = Number(cfgCache.motors) || 0;
      if (cachedM > nax) nax = cachedM;
    } else if (cfgCache.axis_count != null) {
      var cached = Number(cfgCache.axis_count) || 0;
      if (cached > nax) nax = cached;
    }
    var dual = nax >= 2;
    document.body.classList.toggle("axes-2", dual);
    if ($("tele2")) $("tele2").classList.toggle("hidden", !dual);
    document.querySelectorAll(".axis2-only").forEach(function (el) {
      el.classList.toggle("hidden", !dual);
    });
    if (dual) {
      setNum($("pos2"), d.pos2);
      setNum($("spd2"), d.spd2);
      setNum($("acc2"), d.acc2);
      var s1 =
        d.state1 != null ? String(d.state1) : deriveAxisState(gst, d.spd, d.acc, d.tgt);
      var s2 =
        d.state2 != null
          ? String(d.state2)
          : deriveAxisState(gst, d.spd2, d.acc2, d.tgt2);
      setStateLetter($("state"), s1, s1 === "I");
      setStateLetter($("state2"), s2, s2 === "I");
    } else {
      setStateLetter($("state"), gst, false);
    }
    if (d.spd_min != null) spdMin = Number(d.spd_min);
    if (d.max_speed != null) spdMax = Number(d.max_speed);
    else if (cfgCache.max_speed != null) spdMax = Number(cfgCache.max_speed);
    if (
      !draggingSpeed &&
      d.ss != null &&
      !optionHeld &&
      !held.FAST_L &&
      !held.FAST_R
    ) {
      syncSpeedUi(d.ss, null);
      session.ss = Number(d.ss);
      cmdSpd = session.ss;
    }
    if (d.ax != null) {
      axisMask = Number(d.ax);
      if (axisMask !== 0 && axisMask !== 1 && axisMask !== 2) axisMask = 1;
      syncAxisMaskUi();
    }
    if (d.wifi && $("wifiHint")) {
      var w = d.wifi;
      $("wifiHint").textContent =
        (w.mode || "") +
        "  " +
        (w.ip || "") +
        (w.ap_ssid ? "  AP " + w.ap_ssid : "");
    }
    updateEtas();
  }

  function softMin() {
    var v = softLimits.min;
    if (v === null || v === undefined || isNaN(v)) return null;
    return Number(v);
  }

  function softMax() {
    var v = softLimits.max;
    if (v === null || v === undefined || isNaN(v)) return null;
    return Number(v);
  }

  function fmtSs(v) {
    return Math.round(Number(v) * 100) / 100;
  }

  function fmtTlSpeed(v) {
    var n = Number(v);
    if (isNaN(n)) return "0.000000";
    return n.toFixed(6);
  }

  function activeTabId() {
    var t = document.querySelector("#phoneNav .tab.active") || document.querySelector(".tab.active");
    return t ? t.getAttribute("data-tab") : "home";
  }

  function isTlContext(el) {
    if (el && el.closest) {
      if (el.closest('[data-show="tl"], [data-panel="timelapse"]')) return true;
      if (el.closest('[data-show="abc"], [data-panel="abc"]')) return false;
    }
    return activeTabId() === "tl";
  }

  function effectiveSpeed() {
    return optionHeld ? spdMax : cmdSpd;
  }

  function jogCmd(dir, axis, pinAxis) {
    axis = Number(axis);
    if (axis !== 0 && axis !== 1 && axis !== 2 && axis !== 3) axis = 1;
    dir = uiAxisDir(dir, axis === 2 ? 2 : 1);
    var pct = dir < 0 ? -100 : 100;
    if (axis === 3) return "MJ 0 0 " + pct;
    if (axis === 2) return "MJ 0 " + pct;
    if (axis === 0) return "MJ " + pct + " " + pct;
    if (pinAxis) {
      if (document.body.classList.contains("axes-2")) return "MJ " + pct + " 0";
      return "MJ " + pct;
    }
    if (document.body.classList.contains("axes-2")) {
      if (axisMask === 2) return "MJ 0 " + pct;
      if (axisMask === 0) return "MJ " + pct + " " + pct;
      return "MJ " + pct + " 0";
    }
    return "MJ " + pct;
  }

  function clearCruise() {
    cruise.locked = false;
    cruise.dir = 0;
    cruise.axis = 1;
  }

  function stopMotion() {
    if (typeof window.__shCancelTimelinePlay === "function") {
      window.__shCancelTimelinePlay();
    }
    if (typeof window.__shCancelAbcLoop === "function") {
      window.__shCancelAbcLoop();
    }
    sendMc("MS");
    clearCruise();
  }

  function startJog(dir, axis, pinAxis) {
    axis = Number(axis);
    if (axis !== 0 && axis !== 1 && axis !== 2) axis = 1;
    var spd = effectiveSpeed();
    sendMc("SS " + fmtSs(spd));
    sendMc(jogCmd(dir, axis, pinAxis));
    cruise.dir = dir;
    cruise.axis = axis === 0 ? 0 : axis;
    cruise.locked = false;
  }

  function curPos() {
    var axes = lastStatus.axes;
    if (axes && axes[0] && axes[0].pos != null) return Number(axes[0].pos);
    var v = lastStatus.pos;
    return v === null || v === undefined ? null : Number(v);
  }

  function curPos2() {
    var axes = lastStatus.axes;
    if (axes && axes[1] && axes[1].pos != null) return Number(axes[1].pos);
    var v = lastStatus.pos2;
    return v === null || v === undefined ? null : Number(v);
  }

  function fmtPosMc(v) {
    if (v == null || isNaN(v)) return null;
    return fmtSs(v);
  }

  function setSoftLimit(side, axis, pos) {
    var p = fmtPosMc(pos);
    if (side === "min") {
      if (axis === 2) sendMc(p != null ? "SL _ " + p : "SL _ none");
      else sendMc(p != null ? "SL " + p : "SL none");
    } else {
      if (axis === 2) sendMc(p != null ? "SR _ " + p : "SR _ none");
      else sendMc(p != null ? "SR " + p : "SR none");
    }
  }

  function resetSoftBoth(side) {
    if (side === "min") {
      sendMc("SL none");
      sendMc("SL _ none");
    } else {
      sendMc("SR none");
      sendMc("SR _ none");
    }
  }

  function handleSetWin(isLeft, axis) {
    var side = softSideFromBtn(isLeft, axis);
    var pos = axis === 2 ? curPos2() : curPos();
    if (pos == null || isNaN(pos)) return;
    setSoftLimit(side, axis, pos);
  }

  function handleResetWin(isLeft) {
    var side = softSideFromBtn(isLeft, 1);
    resetSoftBoth(side);
  }

  function updateEtas() {
    var pos = curPos();
    var mn = softMin();
    var mx = softMax();
    var spd = cmdSpd;

    if (pos != null && !isNaN(pos) && mn != null && !isNaN(mn) && pos > mn) {
      setNum($("etaMoveL"), etaSeconds(pos - mn, spd, null));
    } else {
      setNum($("etaMoveL"), null);
    }
    if (pos != null && !isNaN(pos) && mx != null && !isNaN(mx) && mx > pos) {
      setNum($("etaMoveR"), etaSeconds(mx - pos, spd, null));
    } else {
      setNum($("etaMoveR"), null);
    }

    if (mn != null && !isNaN(mn) && mx != null && !isNaN(mx) && mx > mn) {
      setNum($("etaWin"), etaSeconds(mx - mn, spd, null));
    } else {
      setNum($("etaWin"), null);
    }
  }

  function emitSs(force, fromEl) {
    var el = fromEl || $("spdSlider");
    var t = Number(el.value) / 1000;
    var v = sliderToSpeed(t);
    syncSpeedUi(v, el);
    session.ss = v;
    cmdSpd = v;
    var now = Date.now();
    if (!force && now - ssTimer < SS_MS) return;
    ssTimer = now;
    sendMc("SS " + fmtSs(v));
  }

  function bindSpeedSlider(el) {
    if (!el) return;
    el.addEventListener("pointerdown", function () {
      draggingSpeed = true;
    });
    el.addEventListener("pointerup", function () {
      draggingSpeed = false;
      emitSs(true, el);
    });
    el.addEventListener("input", function () {
      emitSs(false, el);
    });
  }

  function setMark(letter, posOrPose) {
    var pose = asPose(posOrPose);
    if (!pose) {
      if (posOrPose == null || isNaN(Number(posOrPose))) return;
      pose = { 1: Number(posOrPose), 2: null };
    }
    if (pose[2] == null) {
      var p2 = curPos2();
      pose[2] = p2 == null || isNaN(p2) ? null : p2;
    }
    marks[letter] = pose;
    saveMarks();
    updateEtas();
    if (typeof global.__shOnMarksChanged === "function") global.__shOnMarksChanged();
  }

  function clearMark(letter) {
    marks[letter] = null;
    saveMarks();
    updateEtas();
    if (typeof global.__shOnMarksChanged === "function") global.__shOnMarksChanged();
  }

  function gotoMark(letter) {
    var pose = asPose(marks[letter]);
    var p1 = pose ? pose[1] : null;
    if (p1 == null) return;
    var spd = optionHeld ? spdMax : cmdSpd;
    sendMc("SS " + fmtSs(spd));
    if (pose[2] != null) sendMc("MT " + fmtSs(p1) + " " + fmtSs(pose[2]));
    else sendMc("MT " + fmtSs(p1));
    clearCruise();
  }

  function showUiError(msg) {
    var l1 = $("line1");
    var oled = $("oled");
    if (l1) l1.textContent = msg;
    if (oled) oled.classList.add("warn");
    setTimeout(function () {
      if (oled) oled.classList.remove("warn");
    }, 1600);
  }

  function loopWaitSec() {
    var inp = $("loopWaitAbc");
    var t = Number(inp && inp.value);
    if (isNaN(t) || t < 0) t = 0;
    if (t > 100) t = 100;
    if (inp) inp.value = String(t);
    return t;
  }

  /** Start ping-pong between two marks (letters 'a'|'b'|'c'). */
  function startPpmPair(let1, let2) {
    var p1 = markAxis1(marks[let1]);
    var p2 = markAxis1(marks[let2]);
    if (p1 == null || p2 == null) {
      showUiError("Set marks first");
      return false;
    }
    if (Math.abs(p1 - p2) < PPM_NEAR_MM) {
      showUiError("Ends too close");
      return false;
    }
    var pos = curPos();
    var first;
    var second;
    // If already at first mark, go to the other end first.
    if (pos != null && !isNaN(pos) && Math.abs(pos - p1) <= PPM_NEAR_MM) {
      first = p2;
      second = p1;
    } else {
      first = p1;
      second = p2;
    }
    var delay = loopWaitSec();
    sendTask(
      "TSK_PPM " +
        fmtSs(first) +
        " _ " +
        fmtSs(second) +
        " _ " +
        fmtSs(delay)
    );
    return true;
  }

  function chordPair() {
    var a = !!held.A;
    var b = !!held.B;
    var c = !!held.C;
    if (a && b && !c) return ["a", "b"];
    if (b && c && !a) return ["b", "c"];
    if (c && a && !b) return ["c", "a"];
    return null;
  }

  function tlTriggerTime() {
    var factor = tlFactorVal;
    var fps = TL_FPS_FIXED;
    if (isNaN(factor) || factor < 3) factor = 3;
    if (isNaN(fps) || fps < 1) fps = 1;
    var t = factor / fps;
    if (t < 0.2) t = 0.2;
    return t;
  }

  function tlExposureSec() {
    var t = Number(tlExposureVal);
    if (isNaN(t) || t < 0.1) t = 0.1;
    if (t > 30) t = 30;
    tlExposureVal = t;
    return t;
  }

  function calcMsmFrames(delta) {
    var factor = tlFactorVal;
    var fps = TL_FPS_FIXED;
    if (isNaN(factor) || factor < 3) factor = 3;
    if (isNaN(fps) || fps < 1) fps = 1;
    if (!(cmdSpd > 0) || !(delta >= PPM_NEAR_MM)) return 0;
    var tlSpeed = cmdSpd / factor;
    return Math.max(1, Math.ceil((delta / tlSpeed) * fps));
  }

  function startTimelapse(letter) {
    var dest = markAxis1(marks[letter]);
    if (dest == null) {
      showUiError("Set marks first");
      return false;
    }
    var pos = curPos();
    if (pos == null || isNaN(pos)) {
      showUiError("No position");
      return false;
    }
    var delta = Math.abs(dest - pos);
    if (delta < PPM_NEAR_MM) {
      showUiError("Already there");
      return false;
    }
    var factor = tlFactorVal;
    if (isNaN(factor) || factor < 3) factor = 3;
    if (!(cmdSpd > 0)) {
      showUiError("Set SPEED");
      return false;
    }
    var trigTime = tlTriggerTime();
    var trigLen = tlExposureSec();
    var msm = !!tlMsmOn;
    if (msm) {
      var frames = calcMsmFrames(delta);
      if (frames < 1) {
        showUiError("TL too close");
        return false;
      }
      sendTask(
        "TSK_TL_MSM " +
          fmtSs(dest) +
          " _ " +
          frames +
          " " +
          fmtTlSpeed(trigTime) +
          " " +
          fmtTlSpeed(trigLen)
      );
    } else {
      var spd = cmdSpd / factor;
      var acc =
        cmdAcc != null && !isNaN(cmdAcc) ? cmdAcc / factor : 100 / factor;
      sendTask(
        "TSK_TL_CONT " +
          fmtSs(dest) +
          " _ " +
          fmtTlSpeed(spd) +
          " " +
          fmtTlSpeed(acc) +
          " " +
          fmtTlSpeed(trigTime) +
          " " +
          fmtTlSpeed(trigLen)
      );
    }
    return true;
  }

  function bindTlFields() {
    if (!tlMsmLoaded) {
      try {
        var saved = localStorage.getItem(TL_MSM_KEY);
        if (saved === "1") tlMsmOn = true;
        else if (saved === "0") tlMsmOn = false;
      } catch (e) {}
      tlMsmLoaded = true;
    }
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-factor"), function (inp) {
      inp.value = String(tlFactorVal);
      if (inp._tlBound) return;
      inp._tlBound = true;
      function clamp() {
        var t = Number(inp.value);
        if (isNaN(t) || t < 3) t = 3;
        if (t > 1000) t = 1000;
        tlFactorVal = t;
        Array.prototype.forEach.call(document.querySelectorAll(".js-tl-factor"), function (el) {
          el.value = String(t);
        });
        if (typeof window.__shUpdateAbcEtas === "function") window.__shUpdateAbcEtas();
      }
      inp.addEventListener("change", clamp);
      inp.addEventListener("blur", clamp);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-exposure"), function (inp) {
      inp.value = String(tlExposureVal);
      if (inp._tlBound) return;
      inp._tlBound = true;
      function clamp() {
        var t = Number(inp.value);
        if (isNaN(t) || t < 0.1) t = 0.1;
        if (t > 30) t = 30;
        tlExposureVal = t;
        Array.prototype.forEach.call(document.querySelectorAll(".js-tl-exposure"), function (el) {
          el.value = String(t);
        });
      }
      inp.addEventListener("change", clamp);
      inp.addEventListener("blur", clamp);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-tl-msm"), function (inp) {
      inp.checked = !!tlMsmOn;
      if (inp._tlBound) return;
      inp._tlBound = true;
      inp.addEventListener("change", function () {
        tlMsmOn = !!inp.checked;
        Array.prototype.forEach.call(document.querySelectorAll(".js-tl-msm"), function (el) {
          el.checked = tlMsmOn;
        });
        try {
          localStorage.setItem(TL_MSM_KEY, tlMsmOn ? "1" : "0");
        } catch (e) {}
      });
    });
  }

  function bindHold(el) {
    if (el._swHold) return;
    var name = el.getAttribute("data-btn");
    if (!name) return;
    if (name.indexOf("LIMIT_") === 0) return;
    if (el.getAttribute("data-ax") && (name.indexOf("MOVE") === 0 || name.indexOf("FAST") === 0)) return;
    if (el.closest && (el.closest(".abc-panel") || el.closest(".tl-panel")) && name !== "STOP") return;
    var axisAttr = el.getAttribute("data-ax");
    var btnAxis = axisAttr != null && axisAttr !== "" ? Number(axisAttr) : null;
    if (btnAxis != null && btnAxis !== 0 && btnAxis !== 1 && btnAxis !== 2) btnAxis = 1;
    var pinAxis = btnAxis != null;
    var jogAxis = pinAxis ? btnAxis : 1;
    var holdKey = name + (pinAxis ? ":" + btnAxis : "");
    el._swHold = true;
    var downAt = 0;
    var haltTimer = 0;
    var disTimer = 0;
    var markTimer = 0;
    var markSaved = false;

    function clearT() {
      if (haltTimer) clearTimeout(haltTimer);
      if (disTimer) clearTimeout(disTimer);
      if (markTimer) clearTimeout(markTimer);
      haltTimer = disTimer = markTimer = 0;
    }

    function up(ev) {
      if (!held[holdKey]) return;
      held[holdKey] = false;
      el.classList.remove("held");
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch (e) {}
      var dt = Date.now() - downAt;
      clearT();

      if (name === "OPTION") {
        optionHeld = !!document.querySelector('[data-btn="OPTION"].held');
        if (cruise.locked && cruise.dir) {
          sendMc("SS " + fmtSs(effectiveSpeed()));
        }
        return;
      }

      if (name === "MOVE_L" || name === "MOVE_R") {
        var dir = name === "MOVE_L" ? -1 : 1;
        if (cruise.dir === dir && cruise.axis === jogAxis) {
          if (dt <= TAP_MS) {
            cruise.locked = true;
          } else if (!cruise.locked) {
            stopMotion();
          }
        }
        return;
      }

      if (name === "MOVE_L2" || name === "MOVE_R2") {
        var dir2 = name === "MOVE_L2" ? -1 : 1;
        if (cruise.dir === dir2 && cruise.axis === 2) {
          if (dt <= TAP_MS) {
            cruise.locked = true;
          } else if (!cruise.locked) {
            stopMotion();
          }
        }
        return;
      }

      if (name === "FAST_L" || name === "FAST_R" || name === "FAST_L2" || name === "FAST_R2") {
        stopMotion();
        sendMc("SS " + fmtSs(cmdSpd));
        return;
      }
    }

    el.addEventListener("pointerdown", function (ev) {
      ev.preventDefault();
      held[holdKey] = true;
      downAt = Date.now();
      markSaved = false;
      el.classList.add("held");
      try {
        el.setPointerCapture(ev.pointerId);
      } catch (e) {}
      clearT();

      if (name === "OPTION") {
        optionHeld = true;
        if (cruise.locked && cruise.dir) {
          sendMc("SS " + fmtSs(spdMax));
        }
        return;
      }

      if (name === "STOP") {
        stopMotion();
        haltTimer = setTimeout(function () {
          if (held[holdKey]) sendMc("ME");
        }, HALT_MS);
        disTimer = setTimeout(function () {
          if (held[holdKey]) sendMc("SE 0");
        }, DISABLE_MS);
        return;
      }

      if (name === "HOME") {
        sendMc("MH");
        clearCruise();
        return;
      }

      if (name === "MOVE_L" || name === "MOVE_R") {
        var dir = name === "MOVE_L" ? -1 : 1;
        if (cruise.locked && cruise.dir === dir && cruise.axis === jogAxis) {
          stopMotion();
          return;
        }
        startJog(dir, jogAxis, pinAxis);
        return;
      }

      if (name === "MOVE_L2" || name === "MOVE_R2") {
        var dir2 = name === "MOVE_L2" ? -1 : 1;
        if (cruise.locked && cruise.dir === dir2 && cruise.axis === 2) {
          stopMotion();
          return;
        }
        startJog(dir2, 2);
        return;
      }

      if (name === "FAST_L") {
        clearCruise();
        sendMc("SS " + fmtSs(spdMax));
        sendMc(jogCmd(-1, jogAxis, pinAxis));
        cruise.dir = -1;
        cruise.axis = jogAxis;
        cruise.locked = false;
        return;
      }
      if (name === "FAST_R") {
        clearCruise();
        sendMc("SS " + fmtSs(spdMax));
        sendMc(jogCmd(1, jogAxis, pinAxis));
        cruise.dir = 1;
        cruise.axis = jogAxis;
        cruise.locked = false;
        return;
      }
      if (name === "FAST_L2") {
        clearCruise();
        sendMc("SS " + fmtSs(spdMax));
        sendMc(jogCmd(-1, 2, true));
        cruise.dir = -1;
        cruise.axis = 2;
        cruise.locked = false;
        return;
      }
      if (name === "FAST_R2") {
        clearCruise();
        sendMc("SS " + fmtSs(spdMax));
        sendMc(jogCmd(1, 2, true));
        cruise.dir = 1;
        cruise.axis = 2;
        cruise.locked = false;
        return;
      }

      if (name === "SET_W_L") {
        handleSetWin(true, 1);
        return;
      }
      if (name === "SET_W_R") {
        handleSetWin(false, 1);
        return;
      }
      if (name === "SET_W_L2") {
        handleSetWin(true, 2);
        return;
      }
      if (name === "SET_W_R2") {
        handleSetWin(false, 2);
        return;
      }
      if (name === "RESET_W_L") {
        handleResetWin(true);
        return;
      }
      if (name === "RESET_W_R") {
        handleResetWin(false);
        return;
      }
    });
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", function (ev) {
      if (held[holdKey]) up(ev);
    });
  }

  function connectWs() {}

  function startPoll() {}

  function stopPoll() {}

  function rebind() {
    document.querySelectorAll("[data-btn]").forEach(bindHold);
    speedSliders().forEach(function (el) {
      if (el._swSpd) return;
      el._swSpd = true;
      bindSpeedSlider(el);
    });
  }

  loadSwapDirs();
  loadAxisMask();
  document.querySelectorAll("[data-btn]").forEach(bindHold);
  speedSliders().forEach(bindSpeedSlider);

  (function bindHome() {
    var en = $("enable");
    if (en) {
      en.addEventListener("change", function () {
        if (syncEnableSilent) return;
        if (en.checked && isDrvError()) {
          syncEnableUi(false);
          return;
        }
        sendMc(en.checked ? "SE 1" : "SE 0");
      });
    }

    var d1 = $("dir");
    if (d1) {
      d1.addEventListener("change", function () {
        swapDir = !!d1.checked;
        saveSwapDirs();
      });
    }
    var d2 = $("dir2");
    if (d2) {
      d2.addEventListener("change", function () {
        swapDir2 = !!d2.checked;
        saveSwapDirs();
      });
    }

    var accEl = $("accSliderHome");
    if (accEl) {
      accEl.addEventListener("pointerdown", function () {
        draggingAccel = true;
      });
      accEl.addEventListener("pointerup", function () {
        draggingAccel = false;
        emitSa(true);
      });
      accEl.addEventListener("input", function () {
        emitSa(false);
      });
    }
  })();

  document.querySelectorAll(".chip").forEach(function (el) {
    el.addEventListener("click", function () {
      axisMask = Number(el.getAttribute("data-ax"));
      if (axisMask !== 0 && axisMask !== 1 && axisMask !== 2) axisMask = 1;
      syncAxisMaskUi();
      saveAxisMask();
      sendAx(axisMask);
    });
  });

  (function bindCli() {
    function loadCliCmds() {
      var cmds = ["", "", "", "", ""];
      try {
        var raw = localStorage.getItem(CLI_CMDS_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.length) {
            for (var i = 0; i < 5; i++) {
              cmds[i] = parsed[i] != null ? String(parsed[i]) : "";
            }
          }
        }
      } catch (e) {}
      for (var n = 1; n <= 5; n++) {
        var el = $("cmd" + n);
        if (el) el.value = cmds[n - 1];
      }
    }

    function saveCliCmds() {
      var arr = [];
      for (var n = 1; n <= 5; n++) {
        var el = $("cmd" + n);
        arr.push(el ? el.value : "");
      }
      try {
        localStorage.setItem(CLI_CMDS_KEY, JSON.stringify(arr));
      } catch (e) {}
    }

    function sendCmd(n) {
      var inp = $("cmd" + n);
      if (!inp) return;
      sendMc(inp.value);
    }

    for (var i = 1; i <= 5; i++) {
      (function (n) {
        var inp = $("cmd" + n);
        var btn = $("send" + n);
        if (inp) {
          inp.addEventListener("change", saveCliCmds);
          inp.addEventListener("blur", saveCliCmds);
          inp.addEventListener("keydown", function (ev) {
            if (ev.key === "Enter") {
              ev.preventDefault();
              sendCmd(n);
            }
          });
        }
        if (btn) {
          btn.addEventListener("click", function () {
            sendCmd(n);
          });
        }
      })(i);
    }

    loadCliCmds();
  })();

  loadMarks();

  global.SWUi = {
    init: function () {
      sendAx(axisMask);
      rebind();
      bindTlFields();
    },
    rebind: rebind,
    applyHello: applyHello,
    applyStatus: applyStatus,
    swapDir: function () { return swapDir; },
    swapDir2: function () { return swapDir2; },
    getMark: function (letter) { return marks[letter] || null; },
    setMarkPose: setMark,
    clearMark: clearMark,
    markAxis1: markAxis1,
    asPose: asPose,
    speedFromTime: speedFromTime,
    syncSpeedUi: function (v) { syncSpeedUi(v, null); },
    syncAccelUi: function (v) { syncAccelUi(v, null); },
    sessionSpeed: function () { return cmdSpd; },
    sessionAccel: function () { return cmdAcc; },
    spdMin: function () { return spdMin; },
    spdMax: function () { return spdMax; },
    accMax: function () { return accMax; },
    startTimelapse: startTimelapse,
    bindTlFields: bindTlFields,
    tlFactor: function () { return tlFactorVal; },
    tlExposure: function () { return tlExposureSec(); },
    tlMsm: function () { return !!tlMsmOn; },
    showUiError: showUiError
  };
})(window);
