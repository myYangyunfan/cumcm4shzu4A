(function () {
  'use strict';
  var META = window.MHA_META, FR = window.MHA_FRAMES, CMAP = window.MHA_CMAP;

  var INK = '#1b3350', PRIMARY = '#33568c', CORAL = '#fd8c5b', RED = '#d93124';
  var SAND = '#ffdf92', SKY = '#90bee0', BLUE = '#4a75b2';
  var R_GAP = 0.05, TH = META.threshold;
  var L_CM = META.geometry.L_cm, R0_CM = META.geometry.R0_cm;

  var FIELD = {
    T: { name: '温度', unit: '℃', nd: 2, cmap: 'thermal' },
    C: { name: '水分浓度', unit: 'kg/kg', nd: 4, cmap: 'moist' }
  };
  var CMAP_LIST = ['thermal', 'moist', 'inferno', 'viridis', 'turbo'];
  var CMAP_LABEL = { thermal: '温度色标', moist: '水分色标' };

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  var S = {
    q: 'q1', field: 'C', view: 'cyl', t: 0, playing: false, speed: 1,
    range: 'default', cmap: null, amp: 2.5, ampOn: true, thOn: true, spin: false
  };
  function prob() { return META.problems[S.q]; }
  function frames() { var p = prob(); return FR[p.frames || S.q]; }
  function cmapName() { return S.cmap || FIELD[S.field].cmap; }
  function range() {
    var f = S.field;
    if (S.range === 'zoom') {
      if (f === 'C') return (S.q === 'q1') ? [1.5, 2.6] : [0, 0.30];
      return (S.q === 'q1') ? [28, 32] : [40, 50];
    }
    return prob().range[f];
  }
  function norm(v, rng) { return clamp((v - rng[0]) / (rng[1] - rng[0]), 0, 1); }

  function kmaxOf(rows, i) {
    var r = rows[i];
    for (var j = r.length - 1; j >= 0; j--) if (r[j] !== null) return j;
    return 0;
  }
  function rowAt(rows, i, w, k, n) {
    var A = rows[i], B = rows[Math.min(i + 1, n - 1)], out = new Float64Array(A.length);
    for (var j = 0; j < A.length; j++) out[j] = (j <= k) ? lerp(A[j], B[j], w) : NaN;
    return out;
  }
  function sample(t, field) {
    var fr = frames(), ts = fr.t, n = ts.length, i = 0;
    if (t <= ts[0]) i = 0;
    else if (t >= ts[n - 1]) i = n - 2;
    else { var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (ts[m] <= t) lo = m; else hi = m; } i = lo; }
    var w = n < 2 ? 0 : clamp((t - ts[i]) / (ts[i + 1] - ts[i]), 0, 1);
    var rows = fr[field];
    var k = Math.min(kmaxOf(rows, i), kmaxOf(rows, i + 1));
    var S1 = fr[field + 's'];
    var vs = S1 ? lerp(S1[i], S1[Math.min(i + 1, n - 1)], w) : NaN;
    return { v: rowAt(rows, i, w, k, n), k: k, vs: vs, R: fr.R ? lerp(fr.R[i], fr.R[Math.min(i + 1, n - 1)], w) : R0_CM, r: fr.r };
  }
  function interpAt(v, r) {
    var x = clamp(r / R_GAP, 0, v.length - 1), i = Math.floor(x), f = x - i;
    if (i >= v.length - 1) return v[v.length - 1];
    var a = v[i], b = v[i + 1];
    if (!isFinite(a)) return b;
    if (!isFinite(b)) return a;
    return lerp(a, b, f);
  }
  function validMax(v, k) {
    var m = -Infinity;
    for (var j = 0; j <= k; j++) if (isFinite(v[j]) && v[j] > m) m = v[j];
    return m;
  }

  var canvas = document.getElementById('gl');
  var renderer, scene, root, cam;
  var CAM = { az: 0.62, el: 1.02, dist: 46 }, camTarget = new THREE.Vector3();

  function initGL() {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearAlpha(0);
    scene = new THREE.Scene();
    cam = new THREE.PerspectiveCamera(34, 1, 0.5, 4000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfe0e8, 0.78));
    scene.add(amb(0.28, 30, 46, 26));
    scene.add(amb(0.14, -34, -20, -22));
    root = new THREE.Group(); scene.add(root);
    bindControls();
    bindHover();
    initHover();
    resize();
    window.addEventListener('resize', resize);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
  }
  function amb(i, x, y, z) { var d = new THREE.DirectionalLight(0xffffff, i); d.position.set(x, y, z); return d; }
  function resize() {
    var w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    cam.aspect = w / h; cam.updateProjectionMatrix();
    slideAll();
  }
  var LABEL_AZ = 0;
  function makeLabel(text, worldH, color, weight, align) {
    if (color && color.isColor) color = '#' + color.getHexString();
    var fs = 52, pad = 10, font = (weight || 600) + ' ' + fs + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    var c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = font;
    var w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + pad * 2;
    c.width = w; c.height = h; g = c.getContext('2d');
    g.font = font; g.textBaseline = 'middle'; g.fillStyle = color || INK;
    g.fillText(text, pad, h / 2);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    sp.scale.set(worldH * w / h, worldH, 1);
    sp.userData.w = worldH * w / h;
    sp.userData.align = align || 'center';
    sp.renderOrder = 10;
    return sp;
  }
  function alignLabels() {
    var rx = Math.sin(LABEL_AZ), rz = -Math.cos(LABEL_AZ);
    root.traverse(function (o) {
      if (!o.isSprite || !o.userData.align || o.userData.align === 'center') return;
      var off = (o.userData.align === 'right' ? -0.5 : 0.5) * o.userData.w;
      o.position.x += rx * off;
      o.position.z += rz * off;
    });
  }
  function lineFrom(pts, color, dashed) {
    var g = new THREE.BufferGeometry().setFromPoints(pts);
    var l = new THREE.Line(g, dashed
      ? new THREE.LineDashedMaterial({ color: color, dashSize: 1.2, gapSize: 0.8 })
      : new THREE.LineBasicMaterial({ color: color }));
    if (dashed) l.computeLineDistances();
    return l;
  }
  function circleLine(r, y, n, color, opacity) {
    var p = [];
    for (var i = 0; i <= n; i++) { var t = i / n * Math.PI * 2; p.push(r * Math.cos(t), y, r * Math.sin(t)); }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: color, transparent: !!opacity, opacity: opacity || 1 }));
  }
  function softShadow(w, d, opacity) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(64, 64, 2, 64, 64, 62);
    rg.addColorStop(0, 'rgba(23,48,79,.85)');
    rg.addColorStop(0.55, 'rgba(23,48,79,.28)');
    rg.addColorStop(1, 'rgba(23,48,79,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
    var tex = new THREE.CanvasTexture(c);
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: opacity || 0.2, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  function woodTexture() {
    var SZ = 1024, c = document.createElement('canvas'); c.width = c.height = SZ;
    var g = c.getContext('2d'), seed = 20260913;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var planks = 6, pw = SZ / planks, p, i, x, y;
    g.fillStyle = '#9c7a52';
    g.fillRect(0, 0, SZ, SZ);
    for (p = 0; p < planks; p++) {
      var L = 44 + Math.round(rnd() * 8 - 4);
      g.fillStyle = 'hsl(31,30%,' + L + '%)';
      g.fillRect(p * pw, 0, pw, SZ);
      for (i = 0; i < 210; i++) {
        var y0 = rnd() * SZ, ph = rnd() * 6.28, amp = 4 + rnd() * 8;
        g.strokeStyle = 'hsla(28,32%,' + (26 + Math.round(rnd() * 24)) + '%,' + (0.05 + rnd() * 0.12).toFixed(3) + ')';
        g.lineWidth = 0.5 + rnd() * 1.6;
        g.beginPath();
        for (x = p * pw; x <= (p + 1) * pw; x += 10) {
          y = y0 + Math.sin(x * 0.011 + ph) * amp + Math.sin(x * 0.043 + p) * 2.5;
          if (x === p * pw) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = 'rgba(58,38,22,.5)';
      g.fillRect(p * pw - 2, 0, 4, SZ);
    }
    for (i = 0; i < 2600; i++) {
      g.fillStyle = 'rgba(60,40,24,' + (rnd() * 0.05).toFixed(3) + ')';
      g.fillRect(rnd() * SZ, rnd() * SZ, 1.6, 1.6);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
    return tex;
  }

  function fadeTexture(color) {
    var SZ = 512, c = document.createElement('canvas'); c.width = c.height = SZ;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(SZ / 2, SZ / 2, SZ * 0.1, SZ / 2, SZ / 2, SZ * 0.5);
    rg.addColorStop(0, color + ',0)');
    rg.addColorStop(0.55, color + ',.35)');
    rg.addColorStop(0.82, color + ',.86)');
    rg.addColorStop(1, color + ',1)');
    g.fillStyle = rg; g.fillRect(0, 0, SZ, SZ);
    return new THREE.CanvasTexture(c);
  }

  var SLIDE_IDS = ['qtabs', 'viewseg', 'fieldseg', 'rangeseq', 'cmapseg', 'speedseg'];
  function slideInit(el) {
    if (!el || el.querySelector('.ind')) return;
    var ind = document.createElement('span');
    ind.className = 'ind';
    ind.style.transition = 'none';
    el.insertBefore(ind, el.firstChild);
    slideSync(el);
    requestAnimationFrame(function () { ind.style.transition = ''; });
  }
  function slideSync(el) {
    var b = el.querySelector('button.on'), ind = el.querySelector('.ind');
    if (!b || !ind) return;
    var pad = el.classList.contains('tabs') ? 0 : 3;
    ind.style.left = (b.offsetLeft + pad) + 'px';
    ind.style.width = Math.max(0, b.offsetWidth - pad * 2) + 'px';
  }
  function slideAll() {
    for (var i = 0; i < SLIDE_IDS.length; i++) slideInit(document.getElementById(SLIDE_IDS[i]));
    for (i = 0; i < SLIDE_IDS.length; i++) slideSync(document.getElementById(SLIDE_IDS[i]));
  }

  var HOVER = null;
  var hoverDot = null, ray = new THREE.Raycaster(), dragging = false;

  function initHover() {
    hoverDot = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false }));
    hoverDot.visible = false; hoverDot.renderOrder = 20;
    scene.add(hoverDot);
  }
  function tipHTML(r) {
    return '<div class="tip-t">' + r.title + '</div>' + r.rows.map(function (x) {
      return '<div class="tip-r"><span>' + x[0] + '</span><b>' + x[1] + '</b></div>';
    }).join('');
  }
  function hideTip() {
    var el = document.getElementById('tip');
    if (el) el.hidden = true;
    if (hoverDot) hoverDot.visible = false;
  }
  function readRod(p) {
    var amp = S.ampOn ? S.amp : 1;
    var rDisp = Math.sqrt(p.x * p.x + p.z * p.z);
    var sT = sample(S.t, 'T'), sC = sample(S.t, 'C');
    var r = clamp(rDisp / amp, 0, sC.R);
    return {
      title: '到中心距离 r = ' + r.toFixed(3) + ' cm',
      rows: [
        ['温度', interpAt(sT.v, r).toFixed(2) + ' ℃'],
        ['水分浓度', interpAt(sC.v, r).toFixed(4) + ' kg/kg'],
        ['含水率（湿基）', (interpAt(sC.v, r) / (1 + interpAt(sC.v, r)) * 100).toFixed(2) + ' %']
      ]
    };
  }
  function readSurf(p) {
    var t = clamp((p.x + SURF.XL / 2) / SURF.XL, 0, 1) * SURF.T_END;
    var sT = sample(t, 'T'), sC = sample(t, 'C');
    var r = clamp(p.z / SURF.ZS + 1, 0, sC.R);
    return {
      title: 't = ' + (t / 3600).toFixed(2) + ' h · r = ' + r.toFixed(3) + ' cm',
      rows: [
        ['温度', interpAt(sT.v, r).toFixed(2) + ' ℃'],
        ['水分浓度', interpAt(sC.v, r).toFixed(4) + ' kg/kg']
      ]
    };
  }
  function bindHover() {
    canvas.addEventListener('pointermove', function (e) {
      var box = canvas.getBoundingClientRect();
      hoverAt = { x: e.clientX - box.left, y: e.clientY - box.top };
      updateHover();
    });
    canvas.addEventListener('pointerleave', function () { hoverAt = null; hideTip(); });
  }
  var hoverAt = null, hoverKey = '';
  function updateHover() {
    if (!hoverAt || !HOVER || dragging) { hoverDot.visible = false; hoverKey = ''; return; }
    var key = hoverAt.x + ',' + hoverAt.y + ',' + S.t + ',' + S.view;
    if (key === hoverKey) return;
    hoverKey = key;
    var box = canvas.getBoundingClientRect();
    ray.setFromCamera({
      x: (hoverAt.x / box.width) * 2 - 1,
      y: -(hoverAt.y / box.height) * 2 + 1
    }, cam);
    var hit = ray.intersectObjects(HOVER.objs, false)[0];
    if (!hit) { hideTip(); return; }
    hoverDot.position.copy(hit.point); hoverDot.visible = true;
    var el = document.getElementById('tip');
    el.innerHTML = tipHTML(HOVER.read(hit.point));
    el.hidden = false;
    var w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(hoverAt.x + 14, box.width - w - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(hoverAt.y + 14, box.height - h - 8)) + 'px';
  }

  function bindControls() {
    var drag = null;
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
      dragging = true; hideTip();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      var k = CAM.dist * 0.0016;
      if (drag.pan) {
        var ce = Math.cos(CAM.el), se = Math.sin(CAM.el);
        var sa = Math.sin(CAM.az), ca = Math.cos(CAM.az);
        var rx = sa, rz = -ca;
        var ux = -ca * se, uy = ce, uz = -sa * se;
        camTarget.x -= dx * k * rx; camTarget.z -= dx * k * rz;
        camTarget.x += dy * k * ux; camTarget.y += dy * k * uy; camTarget.z += dy * k * uz;
      } else {
        CAM.az += dx * 0.006;
        CAM.el = clamp(CAM.el - dy * 0.005, 0.12, Math.PI - 0.12);
      }
    });
    canvas.addEventListener('pointerup', function () { drag = null; dragging = false; });
    canvas.addEventListener('pointercancel', function () { drag = null; dragging = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      CAM.dist = clamp(CAM.dist * Math.pow(1.0016, e.deltaY), 5, 700);
    }, { passive: false });
    var pinch = null;
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinch) {
        e.preventDefault();
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        CAM.dist = clamp(CAM.dist * pinch / d, 5, 700); pinch = d;
      }
    }, { passive: false });
  }
  function applyCam() {
    var ce = Math.cos(CAM.el), se = Math.sin(CAM.el);
    cam.position.set(
      camTarget.x + CAM.dist * se * Math.cos(CAM.az),
      camTarget.y + CAM.dist * ce,
      camTarget.z + CAM.dist * se * Math.sin(CAM.az));
    cam.lookAt(camTarget);
  }

  var ROD = null;
  var ROD_AZ = 1.15;
  var SURF_AZ = 1.02, ENV_AZ = 0.82;
  function buildRod() {
    var NU = 40, NTH = 72, WEDGE = Math.PI * 2 / 3, ARC = Math.PI * 2 - WEDGE, THETA_C = 0.62;
    var start = THETA_C + WEDGE / 2;
    var y0 = -L_CM / 2, y1 = L_CM / 2;
    var P = [], N = [], UR = [], IDX = [];
    function push(x, y, z, nx, ny, nz, r) { P.push(x, y, z); N.push(nx, ny, nz); UR.push(r); }

    var base = 0, i, j;
    for (i = 0; i <= NTH; i++) {
      var th = start + ARC * i / NTH, cx = Math.cos(th), sz = Math.sin(th);
      push(R0_CM * cx, y0, R0_CM * sz, cx, 0, sz, R0_CM);
      push(R0_CM * cx, y1, R0_CM * sz, cx, 0, sz, R0_CM);
    }
    for (i = 0; i < NTH; i++) { var a = base + i * 2; IDX.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    [0, 1].forEach(function (si) {
      var thq = si === 0 ? start : start + ARC;
      var cxq = Math.cos(thq), szq = Math.sin(thq);
      var nx = -szq * (si ? 1 : -1), nz = cxq * (si ? 1 : -1), b0 = P.length / 3;
      for (var k = 0; k <= NU; k++) {
        var rr = R0_CM * k / NU;
        push(rr * cxq, y0, rr * szq, nx, 0, nz, rr);
        push(rr * cxq, y1, rr * szq, nx, 0, nz, rr);
      }
      for (k = 0; k < NU; k++) {
        var a2 = b0 + k * 2;
        if (si) IDX.push(a2, a2 + 2, a2 + 1, a2 + 1, a2 + 2, a2 + 3);
        else IDX.push(a2, a2 + 1, a2 + 2, a2 + 1, a2 + 3, a2 + 2);
      }
    });
    [y1, y0].forEach(function (yy, si) {
      var ny = si === 0 ? 1 : -1, b0 = P.length / 3;
      for (var k = 0; k <= NU; k++) for (var jj = 0; jj <= NTH; jj++) {
        var th2 = start + ARC * jj / NTH, rr2 = R0_CM * k / NU;
        push(rr2 * Math.cos(th2), yy, rr2 * Math.sin(th2), 0, ny, 0, rr2);
      }
      for (k = 0; k < NU; k++) for (var j2 = 0; j2 < NTH; j2++) {
        var i0 = b0 + k * (NTH + 1) + j2, i1 = i0 + 1, i2 = i0 + NTH + 1, i3 = i2 + 1;
        if (si === 0) IDX.push(i0, i1, i2, i1, i3, i2); else IDX.push(i0, i2, i1, i1, i2, i3);
      }
    });

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(P.length), 3));
    geo.setAttribute('aU', new THREE.Float32BufferAttribute(UR, 1));
    geo.setIndex(IDX);

    var grp = new THREE.Group();
    var rodMesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      vertexColors: true, side: THREE.DoubleSide, shininess: 20, specular: 0x2b3f52
    }));
    grp.add(rodMesh);
    var gen = [];
    for (i = 0; i <= NTH; i += 9) {
      var t3 = start + ARC * i / NTH;
      gen.push(R0_CM * Math.cos(t3), y0, R0_CM * Math.sin(t3), R0_CM * Math.cos(t3), y1, R0_CM * Math.sin(t3));
    }
    var wgeo = new THREE.BufferGeometry();
    wgeo.setAttribute('position', new THREE.Float32BufferAttribute(gen, 3));
    grp.add(new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0x7096ab, transparent: true, opacity: 0.22 })));
    grp.add(circleLine(R0_CM, y1, 72, 0x7096ab, 0.55));
    grp.add(circleLine(R0_CM, y0, 72, 0x7096ab, 0.55));
    root.add(grp);

    var shell = new THREE.Mesh(new THREE.CylinderGeometry(R0_CM, R0_CM, L_CM * 0.996, 72, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(CORAL), transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    var shellRing = new THREE.Group();
    shellRing.add(circleLine(R0_CM, L_CM / 2 * 0.996, 72, new THREE.Color(CORAL), 0.95));
    shellRing.add(circleLine(R0_CM, -L_CM / 2 * 0.996, 72, new THREE.Color(CORAL), 0.95));
    var shellG = new THREE.Group(); shellG.add(shell); shellG.add(shellRing);
    root.add(shellG);

    var sx = Math.sin(ROD_AZ), sz = -Math.cos(ROD_AZ);
    var l1 = makeLabel('半径方向已放大 ' + S.amp + '× · 真实 φ4 cm', 1.35, INK, 600, 'center');
    l1.position.set(0, -L_CM / 2 - 0.5, 17.5); root.add(l1);
    var l2 = makeLabel('长 25 cm', 1.2, PRIMARY, 500, 'left');
    l2.position.set(sx * 7.4, 0, sz * 7.4); root.add(l2);

    var floorY = -L_CM / 2 - 0.16, FS = 200;
    var floor = new THREE.Mesh(new THREE.PlaneGeometry(FS, FS),
      new THREE.MeshLambertMaterial({ map: woodTexture() }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; root.add(floor);
    var fade = new THREE.Mesh(new THREE.PlaneGeometry(FS, FS),
      new THREE.MeshBasicMaterial({ map: fadeTexture('rgba(232,242,246'), transparent: true, depthWrite: false }));
    fade.rotation.x = -Math.PI / 2; fade.position.y = floorY + 0.02; root.add(fade);

    var sh = softShadow(16, 16, 0.32);
    sh.position.set(0, floorY + 0.05, 0); root.add(sh);

    var refG = new THREE.Group();
    var ring = circleLine(R0_CM, 0, 96, 0x33568c, 0.95);
    ring.material = new THREE.LineDashedMaterial({ color: 0x33568c, dashSize: 0.62, gapSize: 0.4, transparent: true, opacity: 0.95 });
    ring.computeLineDistances();
    refG.add(ring);
    refG.position.y = floorY + 0.1;
    refG.visible = S.q === 'q4';
    root.add(refG);
    var rl = makeLabel('虚线 = 初始半径 2 cm', 1.15, PRIMARY, 500, 'center');
    rl.position.set(0, floorY + 0.1, R0_CM + 5.2); root.add(rl);
    rl.visible = S.q === 'q4';

    LABEL_AZ = ROD_AZ; alignLabels();
    ROD = { grp: grp, mesh: rodMesh, geo: geo, col: geo.getAttribute('color'), aU: geo.getAttribute('aU'), shell: shellG, k: 1, rth: 0, sh: sh, ref: refG };
  }

  function updateRod(t) {
    if (!ROD) return;
    var s = sample(t, S.field), rng = range(), LUT = CMAP[cmapName()];
    var rv = 1 / (rng[1] - rng[0]);
    ROD.k = s.R / R0_CM;
    var col = ROD.col, aU = ROD.aU, n = col.count;
    for (var v = 0; v < n; v++) {
      var r = clamp(aU.getX(v) / R0_CM * s.R / R_GAP, 0, s.v.length - 1);
      var i = Math.floor(r), f = r - i;
      var a = s.v[i], b = s.v[Math.min(i + 1, s.v.length - 1)];
      if (!isFinite(a)) a = b; if (!isFinite(b)) b = a;
      var id = clamp(Math.round((a - rng[0]) * rv * 255), 0, 255) * 3;
      var id2 = clamp(Math.round((b - rng[0]) * rv * 255), 0, 255) * 3;
      col.setXYZ(v,
        lerp(LUT[id] / 255, LUT[id2] / 255, f),
        lerp(LUT[id + 1] / 255, LUT[id2 + 1] / 255, f),
        lerp(LUT[id + 2] / 255, LUT[id2 + 2] / 255, f));
    }
    col.needsUpdate = true;

    var rth = 0, front = false;
    if (S.field === 'C' && S.thOn && s.vs < TH) {
      front = true;
      for (var j = 0; j < s.v.length; j++) if (isFinite(s.v[j]) && s.v[j] >= TH) rth = s.r[j];
    }
    ROD.rth = rth;
    ROD.front = front;
    ROD.shell.visible = S.field === 'C' && S.thOn && front && rth > 1e-6;
  }
  function scaleRod() {
    if (!ROD) return;
    var amp = (S.ampOn && S.view === 'cyl') ? S.amp : 1;
    var k = amp * ROD.k;
    ROD.grp.scale.set(k, 1, k);
    var ks = amp * ROD.rth / R0_CM * 0.998;
    ROD.shell.scale.set(ks, 1, ks);
    ROD.sh.scale.set(k, k, 1);
    ROD.ref.scale.set(amp, 1, amp);
  }

  var SURF = null;
  function buildSurf() {
    var fr = frames(), ts = fr.t, r = fr.r, NT = ts.length, NR = r.length;
    var XL = 34, ZS = 7.5, YL = 15, YB = -6.5, T_END = prob().t_end_s, i, j;
    var P = new Float32Array(NT * NR * 3), C = new Float32Array(NT * NR * 3), IDX = [];
    for (i = 0; i < NT; i++) for (j = 0; j < NR; j++) {
      var o = (i * NR + j) * 3;
      P[o] = ts[i] / T_END * XL - XL / 2; P[o + 1] = YB; P[o + 2] = (r[j] - 1) * ZS;
    }
    for (i = 0; i < NT - 1; i++) for (j = 0; j < NR - 1; j++) {
      var a = i * NR + j, b = a + 1, c = a + NR, d = c + 1;
      IDX.push(a, c, b, b, c, d);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setIndex(IDX);
    var surfMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    root.add(surfMesh);

    var ribF = [];
    for (i = 0; i < NT; i += 4) ribF.push(i);
    if (ribF[ribF.length - 1] !== NT - 1) ribF.push(NT - 1);
    var ribSrc = [], r0, r1;
    for (r0 = 0; r0 < ribF.length; r0++) {
      for (r1 = 0; r1 < NR - 1; r1++) {
        ribSrc.push(ribF[r0] * NR + r1, ribF[r0] * NR + r1 + 1);
      }
    }
    var ribSrcA = new Int32Array(ribSrc);
    var ribPos = new Float32Array(ribSrcA.length * 3);
    var ribGeo = new THREE.BufferGeometry();
    ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3));
    root.add(new THREE.LineSegments(ribGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(INK), transparent: true, opacity: 0.13 })));

    var rng = range();
    var tp = new THREE.Mesh(new THREE.PlaneGeometry(XL, 2 * ZS),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(CORAL), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    tp.rotation.x = -Math.PI / 2;
    tp.position.set(0, YB + norm(TH, rng) * YL, 0);
    root.add(tp);
    var tlab = makeLabel('0.15 阈值面', 1.2, '#a3201a', 600, 'right');
    tlab.position.set(-XL / 2 - 0.8, tp.position.y + 0.4, 0); root.add(tlab);

    for (var k = 0; k <= 5; k++) {
      var xx = -XL / 2 + XL * k / 5;
      root.add(lineFrom([new THREE.Vector3(xx, YB - 0.02, -ZS), new THREE.Vector3(xx, YB - 0.02, ZS)], 0xc2dbe6));
      var hrs = T_END / 3600 * k / 5;
      var lb = makeLabel(hrs.toFixed(hrs >= 10 ? 0 : 2) + ' h', 1.2, PRIMARY, 400);
      lb.position.set(xx, YB - 1.6, ZS + 1.6); root.add(lb);
    }
    root.add(lineFrom([new THREE.Vector3(-XL / 2, YB - 0.02, -ZS), new THREE.Vector3(-XL / 2, YB - 0.02, ZS)], 0xc2dbe6));
    var xlab = makeLabel('时间 →', 1.3, PRIMARY, 600, 'center'); xlab.position.set(XL / 2 - 3.5, YB - 1.6, -ZS - 1.8); root.add(xlab);
    var rlab = makeLabel('半径 r / cm', 1.2, PRIMARY, 600, 'right'); rlab.position.set(-XL / 2 - 0.6, YB - 1.6, 0); root.add(rlab);

    var cur = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(NR * 3), 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(INK) }));
    var cur2 = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(NR * 3), 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(SAND) }));
    root.add(cur); root.add(cur2);
    var veil = new THREE.Mesh(new THREE.PlaneGeometry(2 * ZS + 1.4, YL + 7),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(SKY), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    veil.rotation.y = Math.PI / 2; root.add(veil);
    var dot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(RED) }));
    root.add(dot);

    var ev = META.events[S.q];
    if (ev) {
      var ex = ev.t / T_END * XL - XL / 2;
      root.add(lineFrom([new THREE.Vector3(ex, YB, -ZS), new THREE.Vector3(ex, YB + YL + 2.6, -ZS)], new THREE.Color(RED), true));
      var elab = makeLabel(ev.label, 1.3, '#a3201a', 600, 'right');
      elab.position.set(Math.min(ex + 1.6, XL / 2 - 0.8), YB + YL + 3.9, -ZS); root.add(elab);
    }
    LABEL_AZ = SURF_AZ; alignLabels();
    SURF = { mesh: surfMesh, geo: geo, rib: ribGeo, ribSrc: ribSrcA, ribPos: ribPos, cur: cur, cur2: cur2, veil: veil, dot: dot, tp: tp, tlab: tlab, XL: XL, ZS: ZS, YL: YL, YB: YB, T_END: T_END, NT: NT, NR: NR, r: r };
  }

  function updateSurf(t) {
    if (!SURF) return;
    var fr = frames(), s = sample(t, S.field), rng = range(), LUT = CMAP[cmapName()];
    var rv = 1 / (rng[1] - rng[0]) * 255;
    var P = SURF.geo.getAttribute('position'), C = SURF.geo.getAttribute('color');
    var NT = SURF.NT, NR = SURF.NR, T_END = SURF.T_END, YL = SURF.YL, YB = SURF.YB, ZS = SURF.ZS, r = SURF.r;
    var A0 = fr[S.field];
    for (var i = 0; i < NT; i++) {
      var A = A0[i];
      var kk = kmaxOf(A0, i);
      var Re = fr.R ? fr.R[i] : R0_CM;
      for (var j = 0; j < NR; j++) {
        var o = (i * NR + j) * 3;
        var rr, vv;
        if (j <= kk) { rr = r[j]; vv = A[j]; }
        else { rr = Re; vv = interpAt(A, Re); }
        P.array[o + 1] = YB + clamp((vv - rng[0]) / (rng[1] - rng[0]), 0, 1) * YL;
        P.array[o + 2] = (rr - 1) * ZS;
        var id = clamp(Math.round((vv - rng[0]) * rv), 0, 255) * 3;
        C.array[o] = LUT[id] / 255; C.array[o + 1] = LUT[id + 1] / 255; C.array[o + 2] = LUT[id + 2] / 255;
      }
    }
    P.needsUpdate = true; C.needsUpdate = true;
    var rs = SURF.ribSrc, rp = SURF.ribPos, PA = P.array;
    for (var t2 = 0; t2 < rs.length; t2++) {
      var s2 = rs[t2] * 3, d2 = t2 * 3;
      rp[d2] = PA[s2]; rp[d2 + 1] = PA[s2 + 1]; rp[d2 + 2] = PA[s2 + 2];
    }
    SURF.rib.getAttribute('position').needsUpdate = true;

    var x = t / T_END * SURF.XL - SURF.XL / 2;
    var cp = SURF.cur.geometry.getAttribute('position'), cp2 = SURF.cur2.geometry.getAttribute('position');
    for (var q = 0; q < NR; q++) {
      var rq = Math.min(r[q], s.R), vq = interpAt(s.v, rq);
      var yy = YB + clamp((vq - rng[0]) / (rng[1] - rng[0]), 0, 1) * YL + 0.14;
      cp.setXYZ(q, x, yy, (rq - 1) * ZS);
      cp2.setXYZ(q, x, yy - 0.36, (rq - 1) * ZS);
    }
    cp.needsUpdate = true; cp2.needsUpdate = true;
    SURF.veil.position.set(x, YB + (YL + 7) / 2 - 3.5, 0);
    SURF.dot.position.set(x, YB + norm(interpAt(s.v, 0), rng) * YL, -ZS);
    var showTh = S.field === 'C';
    SURF.tp.visible = showTh; SURF.tlab.visible = showTh;
    SURF.tp.position.y = YB + norm(TH, rng) * YL;
    SURF.tlab.position.y = SURF.tp.position.y + 0.5;
  }

  var ENVV = null;
  function buildEnv() {
    var env = META.env, p = prob(), T_END = p.t_end_s;
    var XL = 34, YL = 14, YB = -5, LANE = 2.9, HW = 0.9, TH = 0.5, N = 240, i, k;
    var ts = [], Tv = [], Cv = [];
    for (i = 0; i <= N; i++) {
      var tt = T_END * i / N, inH = tt <= env.horizon_s;
      ts.push(tt);
      Tv.push(inH ? interpArr(env.t, env.T, tt) : env.plateau_T);
      Cv.push(inH ? interpArr(env.t, env.C, tt) : env.plateau_C);
    }
    var t0 = minmax(Tv), c0 = minmax(Cv);
    var tR = [t0[0] - (t0[1] - t0[0]) * 0.5 - 1e-6, t0[1] + (t0[1] - t0[0]) * 0.14];
    var cR = [0, c0[1] * 1.5];
    var hasPlat = env.horizon_s <= T_END;

    function xAt(k) { return ts[k] / T_END * XL - XL / 2; }
    function yAt(k, vals, rng) { return YB + norm(vals[k], rng) * YL; }

    function tubeOf(a, b, vals, rng, z, color) {
      var P = [], IDX = [], n = b - a + 1, j;
      for (j = a; j <= b; j++) {
        var x = xAt(j), y = yAt(j, vals, rng);
        P.push(x, y + TH / 2, z - HW, x, y + TH / 2, z + HW, x, y - TH / 2, z + HW, x, y - TH / 2, z - HW);
      }
      for (j = 0; j < n - 1; j++) {
        var q0 = j * 4, q1 = q0 + 4;
        for (var f = 0; f < 4; f++) {
          var g = (f + 1) % 4;
          IDX.push(q0 + f, q1 + f, q0 + g, q0 + g, q1 + f, q1 + g);
        }
      }
      var g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g2.setIndex(IDX);
      g2.computeVertexNormals();
      return new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ color: color, side: THREE.DoubleSide }));
    }

    function lane(vals, rng, z, colMeas, colPlat, plateau, isT) {
      var cut = ts.length - 1;
      for (k = 0; k < ts.length; k++) if (ts[k] > env.horizon_s) { cut = Math.max(1, k); break; }
      root.add(tubeOf(0, cut, vals, rng, z, colMeas));
      if (cut < ts.length - 1) root.add(tubeOf(cut, ts.length - 1, vals, rng, z, colPlat));
      root.add(lineFrom([new THREE.Vector3(-XL / 2, YB, z), new THREE.Vector3(XL / 2, YB, z)], 0xc2dbe6));
      var yPlat = YB + norm(plateau, rng) * YL;
      if (hasPlat) {
        root.add(lineFrom([new THREE.Vector3(-XL / 2, yPlat, z), new THREE.Vector3(XL / 2, yPlat, z)], 0x8a5a11, true));
        var pl = makeLabel('平台 ' + plateau.toFixed(plateau >= 1 ? 2 : 4), 1.15, colMeas, 600, 'right');
        pl.position.set(XL / 2 - 0.6, yPlat + (isT ? 1.9 : -2.7), z); root.add(pl);
      }
    }
    lane(Tv, tR, LANE, new THREE.Color(RED), new THREE.Color(CORAL), env.plateau_T, true);
    lane(Cv, cR, -LANE, new THREE.Color(BLUE), new THREE.Color(SKY), env.plateau_C, false);

    for (k = 0; k <= 6; k++) {
      var xx = -XL / 2 + XL * k / 6;
      var lb2 = makeLabel((T_END / 3600 * k / 6).toFixed(T_END > 36000 ? 0 : 2) + ' h', 1.15, PRIMARY, 400, 'center');
      lb2.position.set(xx, YB - 1.9, LANE + HW + 0.4); root.add(lb2);
    }
    if (hasPlat) {
      var hxPos = env.horizon_s / T_END * XL - XL / 2;
      root.add(lineFrom([new THREE.Vector3(hxPos, YB - 0.8, -LANE - 2.4), new THREE.Vector3(hxPos, YB + YL + 2.2, LANE + 2.4)], new THREE.Color(PRIMARY), true));
      var hl = makeLabel('实测段末端 ' + (env.horizon_s / 3600).toFixed(1) + ' h', 1.25, '#a3201a', 600, 'left');
      hl.position.set(hxPos + 1.4, YB - 3.6, -LANE - HW); root.add(hl);
    }
    var cur = lineFrom([new THREE.Vector3(0, YB - 0.8, -LANE - HW), new THREE.Vector3(0, YB + YL + 1.8, LANE + HW)], new THREE.Color(INK));
    root.add(cur);
    var d1 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(RED) }));
    var d2 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(BLUE) }));
    root.add(d1); root.add(d2);
    LABEL_AZ = ENV_AZ; alignLabels();
    ENVV = { ts: ts, Tv: Tv, Cv: Cv, tR: tR, cR: cR, XL: XL, YL: YL, YB: YB, LANE: LANE, T_END: T_END, cur: cur, d1: d1, d2: d2 };
  }
  function interpArr(xs, ys, x) {
    var n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo]));
  }
  function minmax(a) { var m = Infinity, M = -Infinity; for (var i = 0; i < a.length; i++) { if (a[i] < m) m = a[i]; if (a[i] > M) M = a[i]; } return [m, M]; }
  function updateEnv(t) {
    if (!ENVV) return;
    var x = t / ENVV.T_END * ENVV.XL - ENVV.XL / 2;
    var cp = ENVV.cur.geometry.getAttribute('position');
    cp.setXYZ(0, x, ENVV.YB - 0.8, -ENVV.LANE - 0.9);
    cp.setXYZ(1, x, ENVV.YB + ENVV.YL + 1.8, ENVV.LANE + 0.9);
    cp.needsUpdate = true;
    ENVV.d1.position.set(x, ENVV.YB + norm(interpArr(ENVV.ts, ENVV.Tv, t), ENVV.tR) * ENVV.YL, ENVV.LANE);
    ENVV.d2.position.set(x, ENVV.YB + norm(interpArr(ENVV.ts, ENVV.Cv, t), ENVV.cR) * ENVV.YL, -ENVV.LANE);
  }

  function dispose(o) {
    if (!o || !o.traverse) return;
    o.traverse(function (x) {
      if (x.geometry) x.geometry.dispose();
      if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose(); }
    });
  }
  function clearRoot() {
    while (root.children.length) dispose(root.children.pop());
    ROD = SURF = ENVV = null;
  }
  function rebuild(reset) {
    clearRoot();
    if (S.view === 'cyl') { buildRod(); CAM.az = ROD_AZ; CAM.el = 1.02; CAM.dist = 58; }
    else if (S.view === 'surf') { buildSurf(); CAM.az = SURF_AZ; CAM.el = 0.74; CAM.dist = 64; }
    else { buildEnv(); CAM.az = ENV_AZ; CAM.el = 0.88; CAM.dist = 56; }
    if (reset) camTarget.set(0, 0, 0);
    refresh();
  }
  function refresh() {
    if (S.view === 'cyl') { updateRod(S.t); scaleRod(); }
    else if (S.view === 'surf') updateSurf(S.t);
    else updateEnv(S.t);
    HOVER = (S.view === 'cyl' && ROD) ? { objs: [ROD.mesh], read: readRod }
      : (S.view === 'surf' && SURF) ? { objs: [SURF.mesh], read: readSurf } : null;
    hud(); applyCam();
  }

  function hud() {
    var p = prob(), f = FIELD[S.field], rng = range(), out = [];
    if (S.view === 'cyl') {
      out.push('<b>剖切柱体</b>：保留 240°、剖开 120° 楔口以露出内部径向分布；颜色即该处的' + f.name + '。');
      out.push(S.ampOn ? '半径方向已放大 <b>' + S.amp + '×</b>（真实半径 2 cm、长 25 cm，长度不放大）。'
        : '按真实比例绘制（半径 2 cm、长 25 cm）。');
      if (S.q === 'q4') out.push('柱体半径随附件 2 收缩：R(t) 由 2.00 cm 降至 1.20 cm；地面虚线为初始半径 2 cm，柱体与它的间隙即收缩量。');
      if (S.field === 'C' && S.thOn) out.push(ROD && ROD.front
        ? '珊瑚色壳层 = 水分浓度 0.15 的等值面，即已干燥层的边界（表面降至 0.15 以下后才出现）。'
        : '水分浓度 0.15 的等值面尚未形成（全剖面都高于 0.15）。');
    } else if (S.view === 'surf') {
      out.push('<b>时空曲面</b>：横轴时间、纵深半径、高度为' + f.name + '；r=0 那条边就是 Cmax(t)，即判据所看的量。');
      if (S.field === 'C') out.push('珊瑚色半透明面为 0.15 阈值面，曲面穿到它下面即达标。');
      if (S.q === 'q4') out.push('曲面右端随半径收缩而收窄，收窄的边界即药材表面 r=R(t)。');
    } else {
      out.push('<b>烘房环境</b>：上带温度、下带水分浓度，均取自附件 1。');
      out.push(p.t_end_s > META.env.horizon_s
        ? '带体实色段 = 0–' + (META.env.horizon_s / 3600).toFixed(0) + ' h 实测，浅色段与其上方的虚线 = 之后按末段均值外推的平台。'
        : '本问时程 < 4 h，带体全部落在实测段内。');
    }
    document.getElementById('hud-note').innerHTML = out.join(' ');
    var lg;
    if (S.view === 'env' && ENVV) {
      lg = '<span class="sw" style="background:' + RED + '"></span>烘房温度　' +
        '<span class="sw" style="background:' + BLUE + '"></span>烘房水分浓度　' +
        '<span class="swd"></span>平台外推（附件 1）<br>' +
        '纵向量程　' + ENVV.tR[0].toFixed(1) + '–' + ENVV.tR[1].toFixed(1) + ' ℃　·　' +
        ENVV.cR[0].toFixed(4) + '–' + ENVV.cR[1].toFixed(4) + ' kg/kg';
    } else {
      lg = (CMAP_LABEL[cmapName()] || cmapName()) + ' · ' +
        rng[0].toFixed(FIELD[S.field].nd) + '–' + rng[1].toFixed(FIELD[S.field].nd) + ' ' + f.unit +
        (S.view === 'cyl' && S.ampOn ? ' · 径向 ' + S.amp + '×' : '');
      var sc = sample(S.t, S.field), mxNow = validMax(sc.v, sc.k);
      if (mxNow > rng[1] + 1e-9) lg += ' · ▲ 最大值 ' + mxNow.toFixed(FIELD[S.field].nd) + ' 超出量程';
    }
    document.getElementById('hud-legend').innerHTML = lg;
  }

  function fmtT(t) {
    var h = t / 3600;
    if (t <= 1800.5) return t.toFixed(0) + ' s';
    return h.toFixed(2) + ' h（' + Math.round(t) + ' s）';
  }
  function renderPanels() {
    var f = FIELD[S.field], nd = f.nd, s = sample(S.t, S.field);
    var c = s.v[0], sf = s.vs, mx = validMax(s.v, s.k);
    document.getElementById('ro-t').textContent = fmtT(S.t);
    document.getElementById('ro-c').innerHTML = c.toFixed(nd) + u(f.unit);
    document.getElementById('ro-s').innerHTML = sf.toFixed(nd) + u(f.unit);
    document.getElementById('ro-m').innerHTML = mx.toFixed(nd) + u(f.unit);
    document.getElementById('ro-rline').hidden = S.q !== 'q4';
    if (S.q === 'q4') document.getElementById('ro-r').innerHTML = s.R.toFixed(4) + u('cm');
    var chip = document.getElementById('ro-chip');
    if (S.field === 'C') {
      var ok = mx <= TH;
      chip.className = 'chip' + (ok ? ' pass' : '');
      chip.textContent = ok ? '✓ 各处水分 ' + mx.toFixed(nd) + ' < 0.15，已达标'
        : '最大水分 ' + mx.toFixed(nd) + '，距限度 0.15 尚差 ' + (mx - TH).toFixed(nd);
    } else {
      chip.className = 'chip pass';
      chip.textContent = '当前最高温度 ' + mx.toFixed(2) + ' ℃ · 热风 ' + interpArr(META.env.t, META.env.T, Math.min(S.t, META.env.horizon_s)).toFixed(2) + ' ℃';
    }
    document.getElementById('tnow').textContent = fmtT(S.t);
  }
  function u(x) { return ' <span style="font-size:.72rem;color:#4a75b2">' + x + '</span>'; }

  function renderStatic() {
    var p = prob();
    document.getElementById('p-head').textContent = p.label + ' · ' + p.name;
    document.getElementById('headline').innerHTML = p.headline.map(function (h) {
      return '<div class="hg"><div class="k">' + h.k + '</div><div class="v">' + h.v + (h.u ? '<span class="u">' + h.u + '</span>' : '') + '</div></div>';
    }).join('');
    document.getElementById('props').innerHTML =
      kv('物性口径', p.props) + kv('时程', (p.t_end_s / 3600).toFixed(4) + ' h') + kv('判据', '各处水分 < 0.15');
    document.getElementById('envnote').textContent = p.env_note;
    document.getElementById('checks').innerHTML = p.checks.map(function (c) { return kv(c.k, c.v); }).join('');
    document.getElementById('srcnote').textContent = META.source.note;
    document.getElementById('view-hint').textContent = {
      cyl: '拖动旋转、滚轮缩放、右键或 Shift 拖动平移。',
      surf: '游标线上的高度分布就是该时刻的径向剖面。',
      env: '烘房给定制约着药材内部的响应。'
    }[S.view];
    var ticks = document.getElementById('ticks');
    ticks.innerHTML = '';
    p.markers.forEach(function (m) {
      var sp = document.createElement('span');
      sp.style.left = clamp(m.t / p.t_end_s, 0, 1) * 100 + '%';
      sp.textContent = m.label;
      ticks.appendChild(sp);
    });
  }
  function kv(k, v) { return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }

  function drawCbar() {
    var rng = range(), LUT = CMAP[cmapName()], f = FIELD[S.field];
    var cv = document.getElementById('cbar'), g = cv.getContext('2d');
    var grad = g.createLinearGradient(0, 0, cv.width, 0);
    for (var i = 0; i <= 64; i++) {
      var id = Math.round(i / 64 * 255) * 3;
      grad.addColorStop(i / 64, 'rgb(' + LUT[id] + ',' + LUT[id + 1] + ',' + LUT[id + 2] + ')');
    }
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = grad; g.fillRect(0, 0, cv.width, cv.height);
    var showTh = S.field === 'C' && TH > rng[0] && TH < rng[1];
    if (showTh) {
      var x = (TH - rng[0]) / (rng[1] - rng[0]) * cv.width;
      g.strokeStyle = '#fff'; g.lineWidth = 4; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke();
      g.strokeStyle = '#12303c'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, cv.height); g.stroke();
    }
    document.getElementById('cb-min').textContent = rng[0].toFixed(f.nd);
    document.getElementById('cb-max').textContent = rng[1].toFixed(f.nd);
    document.getElementById('cb-mid').textContent = showTh ? '0.15' : '';
    document.getElementById('cb-unit').textContent = '（' + f.name + ' ' + f.unit + '）';
    var xg = document.getElementById('xg'); if (xg) xg.textContent = '×' + S.amp;
  }

  function setQ(q) {
    S.q = q; S.range = 'default'; S.t = 0; S.playing = false;
    document.getElementById('btn-play').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    [].forEach.call(document.querySelectorAll('#qtabs button'), function (b) { b.classList.toggle('on', b.dataset.q === q); });
    renderStatic(); renderRange(); rebuild(true); renderPanels(); slideAll();
  }
  function setField(f) {
    S.field = f; S.range = 'default'; S.cmap = null;
    [].forEach.call(document.querySelectorAll('#fieldseg button'), function (b) { b.classList.toggle('on', b.dataset.f === f); });
    renderRange(); renderCmapButtons(); refresh(); renderPanels(); slideAll();
  }
  function setView(v) {
    S.view = v;
    [].forEach.call(document.querySelectorAll('#viewseg button'), function (b) { b.classList.toggle('on', b.dataset.v === v); });
    renderStatic(); rebuild(true); renderPanels(); slideAll();
  }
  function renderRange() {
    [].forEach.call(document.querySelectorAll('#rangeseq button'), function (b) { b.classList.toggle('on', b.dataset.r === S.range); });
    document.querySelector('#rangeseq button[data-r="zoom"]').textContent = (S.field === 'C' && S.q !== 'q1') ? '阈值区 0–0.3' : '局部放大';
    drawCbar(); slideAll();
  }
  function renderCmapButtons() {
    var host = document.getElementById('cmapseg');
    host.innerHTML = '';
    CMAP_LIST.forEach(function (n) {
      var b = document.createElement('button');
      b.textContent = CMAP_LABEL[n] || n;
      if (n === cmapName()) b.className = 'on';
      b.onclick = function () { S.cmap = n; renderCmapButtons(); drawCbar(); refresh(); };
      host.appendChild(b);
    });
    slideAll();
  }
  function setTime(t) {
    S.t = clamp(t, 0, prob().t_end_s);
    document.getElementById('scrub').value = String(Math.round(S.t / prob().t_end_s * 10000));
    refresh(); renderPanels(); writeHash();
  }
  function bindUI() {
    var tabs = document.getElementById('qtabs');
    ['q1', 'q2', 'q3', 'q4'].forEach(function (q) {
      var b = document.createElement('button');
      b.dataset.q = q;
      b.innerHTML = META.problems[q].label + '<br><span style="font-size:.68rem;font-weight:400">' + META.problems[q].name + '</span>';
      b.onclick = function () { setQ(q); };
      tabs.appendChild(b);
    });
    document.getElementById('viewseg').onclick = function (e) { if (e.target.dataset.v) setView(e.target.dataset.v); };
    document.getElementById('fieldseg').onclick = function (e) { if (e.target.dataset.f) setField(e.target.dataset.f); };
    document.getElementById('rangeseq').onclick = function (e) { if (e.target.dataset.r) { S.range = e.target.dataset.r; renderRange(); refresh(); renderPanels(); } };
    document.getElementById('speedseg').onclick = function (e) {
      if (!e.target.dataset.s) return;
      S.speed = parseFloat(e.target.dataset.s);
      [].forEach.call(e.currentTarget.children, function (b) { b.classList.toggle('on', b === e.target); });
      slideAll();
    };
    document.getElementById('btn-play').onclick = function () {
      S.playing = !S.playing;
      this.innerHTML = S.playing ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
      if (S.playing && S.t >= prob().t_end_s - 1e-9) setTime(0);
    };
    document.getElementById('scrub').oninput = function () { setTime(parseFloat(this.value) / 10000 * prob().t_end_s); };
    document.getElementById('ck-x').onchange = function () {
      S.ampOn = this.checked;
      if (S.view === 'cyl') { rebuild(false); } else refresh();
    };
    document.getElementById('ck-th').onchange = function () { S.thOn = this.checked; refresh(); };
    document.getElementById('ck-spin').onchange = function () { S.spin = this.checked; };
    document.getElementById('btn-reset').onclick = function () { rebuild(true); renderPanels(); };
    document.addEventListener('keydown', function (e) {
      if (e.key === ' ' && e.target.tagName !== 'INPUT') { e.preventDefault(); document.getElementById('btn-play').click(); }
      if (e.key === 'ArrowRight') setTime(S.t + prob().t_end_s * 0.004);
      if (e.key === 'ArrowLeft') setTime(S.t - prob().t_end_s * 0.004);
    });
  }

  var last = 0, DUR = 26, errShown = false;
  function showErr(m) {
    if (errShown) return;
    errShown = true;
    var el = document.getElementById('hud-note');
    if (el) el.innerHTML = '<b>页面出错：</b>' + m;
  }
  function loop(ms) {
    var dt = Math.min((ms - last) / 1000, 0.06); last = ms;
    try {
      if (S.spin && !S.playing) CAM.az += dt * 0.16;
      if (S.playing) {
        var nt = S.t + dt / DUR * prob().t_end_s * S.speed;
        if (nt >= prob().t_end_s) { nt = prob().t_end_s; S.playing = false; document.getElementById('btn-play').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'; }
        setTime(nt);
      } else { scaleRod(); applyCam(); }
      updateHover();
      renderer.render(scene, cam);
    } catch (e) { showErr(String(e && e.message || e)); }
    requestAnimationFrame(loop);
  }

  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '').split('/');
    var st = {};
    if (META.problems[h[0]]) st.q = h[0];
    if (h[1] === 'T' || h[1] === 'C') st.field = h[1];
    if (['cyl', 'surf', 'env'].indexOf(h[2]) >= 0) st.view = h[2];
    if (h[3] && isFinite(parseFloat(h[3]))) st.t = parseFloat(h[3]);
    return st;
  }
  function writeHash() {
    try {
      history.replaceState(null, '', '#' + S.q + '/' + S.field + '/' + S.view + '/' + Math.round(S.t));
    } catch (e) {  }
  }
  window.addEventListener('hashchange', function () {
    var st = parseHash();
    if (st.q && st.q !== S.q) setQ(st.q);
    if (st.field && st.field !== S.field) setField(st.field);
    if (st.view && st.view !== S.view) setView(st.view);
    if (st.t !== undefined && Math.abs(st.t - S.t) > 1) setTime(st.t);
  });

  initGL();
  bindUI();
  var ST = parseHash();
  renderCmapButtons();
  setQ(ST.q || 'q1');
  if (ST.field) setField(ST.field);
  if (ST.view) setView(ST.view);
  if (ST.t !== undefined) setTime(ST.t);
  renderRange();
  slideAll();
  document.getElementById('sub').textContent = META.subtitle;
  resize();
  writeHash();
  requestAnimationFrame(function (m) { last = m; requestAnimationFrame(loop); });
})();
