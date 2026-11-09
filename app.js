/* LogicGate browser workbench. No network access, no dependencies. */
(function () {
  'use strict';
  var LG = window.LogicGate;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7', '--series-8'];
  var MAX_GROUPS = 8;

  var state = {
    numVars: 4,
    vars: ['A', 'B', 'C', 'D'],
    minterms: [0, 2, 3, 5, 6, 7, 8, 9],
    dontCares: [10, 11, 12, 13, 14, 15],
    form: 'SOP',
    moduleName: 'logicgate_module',
    preset: '',
    showGroups: true,
    showTexture: false,
    highlight: true,
    result: null,
    verilog: null,
    netlistResult: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['themeToggle', 'helpToggle', 'helpPanel', 'varCount', 'presetSelect', 'varNames', 'exprInput',
    'exprApply', 'exprStatus', 'clearAll', 'mintermInput', 'dontCareInput', 'formSelect',
    'moduleNameInput', 'presetNetlist', 'presetNetlistDescription', 'runNetlist', 'netlistStatus',
    'statRow', 'kmapWrap', 'showGroups', 'showTexture', 'kmapLegend', 'solutionBlock',
    'primeList', 'groupLegend', 'groupSvg', 'groupTable', 'truthTable', 'ttToggle',
    'schematicSvg', 'waveformSvg', 'copyModule', 'copyTb', 'downloadModule', 'downloadTb',
    'moduleFilename', 'tbFilename', 'moduleCode', 'tbCode', 'exportStatus', 'toast', 'varCountLabel'
  ].forEach(function (id) { el[id] = $(id); });

  function esc(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#0b4f8a';
  }

  function groupColor(i) { return cssVar(SERIES[i % SERIES.length]); }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function svg(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
    if (text != null) node.textContent = text;
    return node;
  }

  function svgTitle(node, text) {
    node.appendChild(svg('title', {}, text));
    return node;
  }

  function makeSvg(width, height, label) {
    var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' });
    root.setAttribute('height', height);
    return root;
  }

  function replace(host, node) { host.replaceChildren(node); }

  /* ---------------- State and input parsing ---------------- */

  function parseList(text, limit) {
    var out = [];
    String(text || '').split(/[\s,;]+/).forEach(function (piece) {
      if (!piece || /^[-xX]$/i.test(piece)) return;
      var n = Number(piece);
      if (Number.isInteger(n) && n >= 0 && n < limit && out.indexOf(n) < 0) out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function readVars() {
    var raw = el.varNames.value.split(/[\s,;]+/).filter(Boolean);
    var cleaned = [];
    raw.forEach(function (v) {
      var name = v.replace(/[^A-Za-z0-9_]/g, '_');
      if (/^[A-Za-z_]/.test(name) && cleaned.indexOf(name) < 0) cleaned.push(name);
    });
    for (var i = 0; cleaned.length < state.numVars; i += 1) {
      var candidate = String.fromCharCode(65 + i);
      if (cleaned.indexOf(candidate) < 0) cleaned.push(candidate);
    }
    return cleaned.slice(0, state.numVars);
  }

  function syncInputs() {
    el.varCount.value = String(state.numVars);
    el.varCountLabel.textContent = state.numVars + ' variables';
    el.varNames.value = state.vars.join(', ');
    el.mintermInput.value = state.minterms.join(', ');
    el.dontCareInput.value = state.dontCares.join(', ');
    el.formSelect.value = state.form;
    el.moduleNameInput.value = state.moduleName;
    el.presetSelect.value = state.preset;
    var p = state.preset ? LG.getPreset(state.preset) : null;
    el.presetNetlist.hidden = !(p && p.netlist);
    if (p && p.netlist) el.presetNetlistDescription.textContent = p.description;
  }

  function setStatus(node, text, kind) {
    node.textContent = text;
    node.className = 'field-note' + (kind ? ' is-' + kind : '');
  }

  function recompute() {
    try {
      state.result = LG.minimizeBoolean(state.numVars, state.minterms, state.dontCares, { vars: state.vars });
      var preset = state.preset ? LG.getPreset(state.preset) : null;
      state.verilog = LG.exportVerilog({
        numVars: state.numVars, vars: state.vars, minterms: state.minterms,
        dontCares: state.dontCares, form: state.form, moduleName: state.moduleName,
        outputName: preset ? preset.outputName : 'y'
      });
      renderAll();
    } catch (err) {
      setStatus(el.exprStatus, err.message, 'error');
    }
  }

  function renderAll() {
    var r = state.result;
    if (!r) return;
    renderStats(r);
    renderKmap(r);
    renderSolution(r);
    renderPrimes(r);
    renderGroups(r);
    renderTruthTable(r);
    renderSchematic(r);
    renderWaveform(r);
    renderExport(state.verilog);
  }

  /* ---------------- Stat tiles ---------------- */

  function renderStats(r) {
    var sol = state.form === 'POS' ? r.pos : r.sop;
    var tiles = [
      { label: 'Prime Implicants', value: r.primeImplicants.length, detail: r.essentialPrimeImplicants.length + ' essential' },
      { label: 'SOP Cost', value: r.sop.termCount + ' terms', detail: r.sop.literalCount + ' literals' },
      { label: 'POS Cost', value: r.pos.termCount + ' sums', detail: r.pos.literalCount + ' literals' },
      { label: 'Gate Count', value: sol.gateCount.total, detail: sol.gateCount.not + ' INV, ' + (sol.gateCount.and + sol.gateCount.or) + ' logic' },
      { label: 'Critical Path Delay', value: sol.propagationDelay.estimate + ' ns', detail: sol.propagationDelay.levels + ' levels @ 2.0 ns' },
      { label: 'On / Don\'t-Care', value: r.minterms.length + ' / ' + (1 << r.numVars), detail: r.dontCares.length + ' X states' }
    ];
    el.statRow.innerHTML = tiles.map(function (t) {
      return '<div class="stat-tile"><div class="label">' + esc(t.label) + '</div>' +
        '<div class="value">' + esc(t.value) + '</div><div class="detail">' + esc(t.detail) + '</div></div>';
    }).join('');
  }

  /* ---------------- Karnaugh map ---------------- */

  function rowLabel(kmap, g) {
    return kmap.grayOrder.rows[g].toString(2).padStart(kmap.rowVars, '0');
  }
  function colLabel(kmap, g) {
    return kmap.grayOrder.cols[g].toString(2).padStart(kmap.colVars, '0');
  }

  function axisVarText(kmap) {
    var rowNames = state.vars.slice(0, kmap.rowVars).join('');
    var colNames = state.vars.slice(kmap.rowVars).join('');
    return rowNames + ' \\ ' + colNames;
  }

  function chosenCubes(r) {
    var sol = state.form === 'POS' ? r.pos : r.sop;
    return sol.implicants.slice(0, MAX_GROUPS);
  }

  function renderKmap(r) {
    var kmap = LG.karnaughMap(state.numVars, state.minterms, state.dontCares);
    var cubes = chosenCubes(r);
    var table = document.createElement('table');
    table.className = 'kmap';
    table.setAttribute('aria-label', 'Karnaugh map with ' + state.numVars + ' variables');
    var head = document.createElement('thead');
    var hr = document.createElement('tr');
    hr.appendChild(svgHtml('th', 'corner', axisVarText(kmap)));
    for (var c = 0; c < kmap.cols; c += 1) {
      hr.appendChild(svgHtml('th', '', colLabel(kmap, c)));
    }
    head.appendChild(hr);
    table.appendChild(head);
    var body = document.createElement('tbody');
    for (var rr = 0; rr < kmap.rows; rr += 1) {
      var tr = document.createElement('tr');
      tr.appendChild(svgHtml('th', '', rowLabel(kmap, rr)));
      for (var cc = 0; cc < kmap.cols; cc += 1) {
        var cell = kmap.cells[rr][cc];
        var td = document.createElement('td');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kmap-cell' + (cell.value === 1 ? ' is-one' : cell.value === 'X' ? ' is-dc' : '');
        btn.dataset.minterm = String(cell.minterm);
        btn.setAttribute('aria-label', 'minterm ' + cell.minterm + ', value ' + cell.value + '. Click to cycle.');
        btn.title = 'm' + cell.minterm + ': ' + state.vars.map(function (v, i) {
          return ((cell.minterm >> (state.numVars - 1 - i)) & 1 ? '' : '~') + v;
        }).join(' ') + ' | F = ' + cell.value + ' | click to cycle 0, 1, X';
        btn.innerHTML = '<span>' + esc(cell.value === 'X' ? 'X' : cell.value) + '</span>' +
          '<span class="minterm">m' + cell.minterm + '</span>';
        if (state.showGroups) {
          var dots = document.createElement('span');
          dots.className = 'group-dots';
          cubes.forEach(function (cube, gi) {
            if (cube.minterms.indexOf(cell.minterm) >= 0) {
              var d = document.createElement('i');
              d.style.background = groupColor(gi);
              d.title = 'Group ' + (gi + 1);
              dots.appendChild(d);
            }
          });
          btn.appendChild(dots);
        }
        td.appendChild(btn);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    table.appendChild(body);
    replace(el.kmapWrap, table);
  }

  function svgHtml(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    n.textContent = text;
    return n;
  }

  /* ---------------- Solutions and prime list ---------------- */

  function renderSolution(r) {
    var rec = r.metrics.sopVsPos.recommended;
    function card(kicker, sol, name, badge) {
      return '<div class="expr-card"><div class="kicker"><span>' + esc(kicker) + ' (' + name + ')</span>' +
        (badge ? '<span class="badge ' + (name === rec ? 'recommended' : '') + '">' + esc(badge) + '</span>' : '') + '</div>' +
        '<div class="formula">' + esc(sol.expression) + '</div>' +
        '<div class="meta">' + sol.termCount + ' terms, ' + sol.literalCount + ' literals, ' +
        sol.gateCount.total + ' gates, ' + sol.propagationDelay.estimate + ' ns critical path</div></div>';
    }
    el.solutionBlock.innerHTML = card('Minimal Sum of Products', r.sop, 'SOP', 'Active: ' + state.form) +
      card('Minimal Product of Sums', r.pos, 'POS', '') +
      '<div class="expr-card"><div class="kicker"><span>Gate Cost Comparison</span></div>' +
      '<div class="formula">Preferred Two-Level Form: ' + esc(rec) + '</div><div class="meta">' +
      r.metrics.sopVsPos.sopGates + ' gates (SOP) vs. ' + r.metrics.sopVsPos.posGates +
      ' gates (POS). Don\'t-care cells are assigned only when they enlarge prime cubes.</div></div>';
  }

  function renderPrimes(r) {
    var isPOS = state.form === 'POS';
    var allPrimes = isPOS ? r.posPrimeImplicants : r.primeImplicants;
    var essentialKeys = new Set(isPOS ? r.posEssentialPrimeImplicants.map(function (p) { return p.mask + ':' + p.value; })
      : r.essentialPrimeImplicants.map(function (p) { return p.mask + ':' + p.value; }));
    var cubes = chosenCubes(r);
    var rows = allPrimes.map(function (p) {
      var key = p.mask + ':' + p.value;
      var essential = essentialKeys.has(key);
      var idx = cubes.findIndex(function (c) { return c.mask === p.mask && c.value === p.value; });
      var chosen = idx >= 0;
      var color = chosen ? groupColor(idx) : 'transparent';
      return '<div class="prime-row' + (essential ? ' is-essential' : '') + '">' +
        '<span class="dot" style="background:' + esc(color) + ';border:1px solid var(--border)"></span>' +
        '<span class="term" title="' + esc(p.text) + '">' + esc(p.text) + (essential ? ' <span class="tag">[essential]</span>' : '') + '</span>' +
        '<span class="mins">' + p.minterms.map(function (m) { return 'm' + m; }).join(' ') + '</span></div>';
    });
    if (!rows.length) rows = ['<div class="prime-row"><span></span><span class="term">No prime implicants (constant function)</span><span></span></div>'];
    el.primeList.innerHTML = rows.join('');
  }

  /* ---------------- Prime implicant grouping SVG (with toroidal wrap splitting) ---------------- */

  function contiguousRuns(sortedIndices, maxCount) {
    if (!sortedIndices.length) return [];
    var runs = [];
    var start = sortedIndices[0];
    var prev = sortedIndices[0];
    for (var k = 1; k < sortedIndices.length; k++) {
      var v = sortedIndices[k];
      if (v !== prev + 1) {
        runs.push([start, prev]);
        start = v;
      }
      prev = v;
    }
    runs.push([start, prev]);
    if (maxCount === 4 && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][1] === 3) {
      var head = runs[0];
      var tail = runs[runs.length - 1];
      runs = [[tail[0], 3], [0, head[1]]].concat(runs.slice(1, -1));
    }
    return runs;
  }

  function uniqueSorted(arr) {
    var out = [];
    arr.forEach(function (v) { if (out.indexOf(v) < 0) out.push(v); });
    return out.sort(function (a, b) { return a - b; });
  }

  function renderGroups(r) {
    var kmap = LG.karnaughMap(state.numVars, state.minterms, state.dontCares);
    var cubes = chosenCubes(r);
    var cell = 58, gap = 2, padL = 58, padT = 38;
    var w = padL + kmap.cols * (cell + gap) + 20;
    var h = padT + kmap.rows * (cell + gap) + 22;
    var root = makeSvg(w, h, 'Prime implicant grouping diagram');
    var defs = svg('defs');
    if (state.showTexture) {
      var pat = svg('pattern', { id: 'lgHatch', width: 7, height: 7, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
      pat.appendChild(svg('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: cssVar('--surface-1'), 'stroke-width': 2.2, opacity: 0.55 }));
      defs.appendChild(pat);
      root.appendChild(defs);
    }
    root.appendChild(svg('text', { x: padL - 10, y: padT - 12, 'text-anchor': 'end', class: 'mono-label muted', 'font-size': 10 }, axisVarText(kmap)));
    for (var rr = 0; rr < kmap.rows; rr += 1) {
      root.appendChild(svg('text', { x: padL - 10, y: padT + rr * (cell + gap) + cell / 2 + 4, 'text-anchor': 'end', class: 'mono-label muted', 'font-size': 11 }, rowLabel(kmap, rr)));
    }
    for (var cc = 0; cc < kmap.cols; cc += 1) {
      root.appendChild(svg('text', { x: padL + cc * (cell + gap) + cell / 2, y: padT - 10, 'text-anchor': 'middle', class: 'mono-label muted', 'font-size': 11 }, colLabel(kmap, cc)));
    }
    for (var r2 = 0; r2 < kmap.rows; r2 += 1) {
      for (var c2 = 0; c2 < kmap.cols; c2 += 1) {
        var cellData = kmap.cells[r2][c2];
        var x = padL + c2 * (cell + gap), y = padT + r2 * (cell + gap);
        var bg = cellData.value === 1 ? cssVar('--one') : cellData.value === 'X' ? cssVar('--dc') : cssVar('--zero');
        root.appendChild(svg('rect', { x: x, y: y, width: cell, height: cell, fill: bg, stroke: cssVar('--border'), 'stroke-width': 1 }));
        var ink = cellData.value === 1 ? cssVar('--one-ink') : cellData.value === 'X' ? cssVar('--dc-ink') : cssVar('--text-primary');
        root.appendChild(svg('text', { x: x + cell / 2, y: y + cell / 2 + 6, 'text-anchor': 'middle', 'font-size': 17, 'font-weight': 700, fill: ink, class: 'mono-label' }, String(cellData.value)));
        root.appendChild(svg('text', { x: x + 5, y: y + cell - 5, 'font-size': 9, fill: ink, opacity: 0.78, class: 'mono-label' }, 'm' + cellData.minterm));
      }
    }
    cubes.forEach(function (cube, gi) {
      var color = groupColor(gi);
      var coords = [];
      cube.minterms.forEach(function (m) {
        for (var a = 0; a < kmap.rows; a += 1) for (var b = 0; b < kmap.cols; b += 1) {
          if (kmap.cells[a][b].minterm === m) coords.push({ r: a, c: b });
        }
      });
      if (!coords.length) return;
      var rRuns = contiguousRuns(uniqueSorted(coords.map(function (p) { return p.r; })), kmap.rows);
      var cRuns = contiguousRuns(uniqueSorted(coords.map(function (p) { return p.c; })), kmap.cols);
      var off = (gi % 3) * 2;
      var firstBox = null;
      rRuns.forEach(function (rSeg) {
        cRuns.forEach(function (cSeg) {
          var minR = rSeg[0], maxR = rSeg[1];
          var minC = cSeg[0], maxC = cSeg[1];
          var x0 = padL + minC * (cell + gap) + 3 + off;
          var y0 = padT + minR * (cell + gap) + 3 + off;
          var ww = (maxC - minC + 1) * (cell + gap) - gap - 6 - off * 2;
          var hh = (maxR - minR + 1) * (cell + gap) - gap - 6 - off * 2;
          if (!firstBox) firstBox = { x: x0, y: y0 };
          var rect = svg('rect', {
            x: x0, y: y0, width: ww, height: hh, rx: 3, fill: 'none',
            stroke: color, 'stroke-width': 2.4, 'stroke-dasharray': gi % 2 ? '6 3' : 'none'
          });
          svgTitle(rect, 'Group ' + (gi + 1) + ': ' + (state.form === 'POS' ? r.pos : r.sop).terms[gi] +
            ' | minterms ' + cube.minterms.map(function (m) { return 'm' + m; }).join(', '));
          root.appendChild(rect);
          if (state.showTexture) {
            root.appendChild(svg('rect', { x: x0, y: y0, width: ww, height: hh, rx: 3, fill: 'url(#lgHatch)', stroke: color, 'stroke-width': 1, opacity: 0.45 }));
          }
        });
      });
      if (firstBox) {
        var label = svg('g');
        label.appendChild(svg('rect', { x: firstBox.x + 2, y: firstBox.y + 2, width: 16, height: 15, fill: color, stroke: cssVar('--surface-1'), 'stroke-width': 1 }));
        label.appendChild(svg('text', { x: firstBox.x + 10, y: firstBox.y + 13, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: '#ffffff' }, String(gi + 1)));
        svgTitle(label, 'Group ' + (gi + 1) + ': ' + (state.form === 'POS' ? r.pos : r.sop).terms[gi]);
        root.appendChild(label);
      }
    });
    if (!cubes.length) {
      root.appendChild(svg('text', { x: w / 2, y: h - 6, 'text-anchor': 'middle', class: 'muted', 'font-size': 11 }, 'constant function, no implicant groups'));
    }
    replace(el.groupSvg, root);
    renderGroupLegend(cubes, r);
    renderGroupTable(cubes, r);
  }

  function renderGroupLegend(cubes, r) {
    var sol = state.form === 'POS' ? r.pos : r.sop;
    el.groupLegend.innerHTML = cubes.map(function (cube, i) {
      return '<span><i class="dot" style="background:' + esc(groupColor(i)) + '"></i> ' +
        esc(i + 1) + ': ' + esc(sol.terms[i] || 'cube') + '</span>';
    }).join('');
  }

  function renderGroupTable(cubes, r) {
    var sol = state.form === 'POS' ? r.pos : r.sop;
    var rows = cubes.map(function (cube, i) {
      return '<tr><td><span class="group-cell"><i class="dot" style="width:9px;height:9px;background:' +
        esc(groupColor(i)) + '"></i>G' + (i + 1) + '</span></td><td>' + esc(sol.terms[i] || '') +
        '</td><td>' + cube.literals + '</td><td>' + cube.minterms.map(function (m) { return 'm' + m; }).join(' ') + '</td></tr>';
    }).join('');
    el.groupTable.innerHTML = '<table class="data"><thead><tr><th>Group</th><th>Implicant</th><th>Literals</th><th>Covered Minterms</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="4">No groups (constant function)</td></tr>') + '</tbody></table>';
  }

  /* ---------------- Truth table ---------------- */

  function renderTruthTable(r) {
    var size = 1 << state.numVars;
    var dcSet = new Set(state.dontCares);
    var head = '<thead><tr><th>Dec</th>' + state.vars.map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('') +
      '<th>F</th><th>SOP</th><th>POS</th></tr></thead>';
    var rows = [];
    for (var m = 0; m < size; m += 1) {
      var bits = state.vars.map(function (_, i) { return (m >> (state.numVars - 1 - i)) & 1; });
      var isDC = dcSet.has(m);
      var cls = isDC ? 'is-dc' : (r.truthTable[m] ? 'is-on' : '');
      var fCls = isDC ? 'out-dc' : (r.truthTable[m] ? 'out-on' : '');
      rows.push('<tr class="' + cls + '"><td>m' + m + '</td>' + bits.map(function (b) { return '<td>' + b + '</td>'; }).join('') +
        '<td class="' + fCls + '">' + (isDC ? 'X' : r.truthTable[m]) + '</td>' +
        '<td>' + r.verification.sopOutputs[m] + '</td><td>' + r.verification.posOutputs[m] + '</td></tr>');
    }
    el.truthTable.innerHTML = '<table class="data">' + head + '<tbody>' + rows.join('') + '</tbody></table>';
    el.ttToggle.textContent = state.highlight ? 'Highlight active rows' : 'Plain table rows';
    el.ttToggle.setAttribute('aria-pressed', String(state.highlight));
    el.truthTable.querySelector('table').classList.toggle('no-highlight', !state.highlight);
  }

  /* ---------------- Gate level schematic SVG ---------------- */

  function renderSchematic(r) {
    var sol = state.form === 'POS' ? r.pos : r.sop;
    var isPOS = state.form === 'POS';
    var cubes = sol.implicants;
    var inputs = state.vars;
    var inv = new Set();
    cubes.forEach(function (cube) {
      inputs.forEach(function (_, i) {
        var bit = 1 << (state.numVars - 1 - i);
        if (!(cube.mask & bit)) return;
        var positive = (cube.value & bit) !== 0;
        if ((isPOS && positive) || (!isPOS && !positive)) inv.add(i);
      });
    });
    var invList = Array.from(inv).sort(function (a, b) { return a - b; });
    var lanes = inputs.length + invList.length;
    var top = 42, laneH = 24, gateY = top + lanes * laneH + 10;
    var railX = 34, gateX = 186, outerX = 420, outX = 548;
    var h = gateY + Math.max(cubes.length, 2) * 44 + 48;
    var w = outX + 76;
    var root = makeSvg(w, h, 'Gate level schematic of ' + state.form + ' implementation');

    root.appendChild(svg('text', { x: 12, y: 18, 'font-size': 11, class: 'secondary', 'font-weight': 700 },
      (isPOS ? 'Two-Level OR-AND Network' : 'Two-Level AND-OR Network') + ' (' + cubeDescription(cubes.length) + ')' +
      (cubes.length > MAX_GROUPS ? ' [first ' + MAX_GROUPS + ' shown]' : '')));
    cubes = cubes.slice(0, MAX_GROUPS);

    var laneIndex = 0;
    var laneY = {};
    inputs.forEach(function (name, i) {
      var y = top + laneIndex * laneH;
      laneY['p' + i] = y;
      root.appendChild(svg('text', { x: 8, y: y + 4, 'font-size': 11, class: 'mono-label', 'font-weight': 700 }, name));
      root.appendChild(svg('line', { x1: railX, y1: y, x2: gateX + 24, y2: y, stroke: cssVar('--border'), 'stroke-width': 1.4 }));
      root.appendChild(svg('rect', { x: railX - 2, y: y - 2, width: 4, height: 4, fill: cssVar('--accent') }));
      laneIndex += 1;
    });
    invList.forEach(function (i) {
      var y = top + laneIndex * laneH;
      laneY['n' + i] = y;
      root.appendChild(svg('rect', { x: railX + 80, y: y - 8, width: 34, height: 16, fill: cssVar('--surface-1'), stroke: cssVar('--border-strong'), 'stroke-width': 1.2 }));
      root.appendChild(svg('text', { x: railX + 97, y: y + 3.5, 'font-size': 9.5, 'text-anchor': 'middle', class: 'mono-label secondary' }, 'INV'));
      root.appendChild(svg('circle', { cx: railX + 118, cy: y, r: 2.6, fill: cssVar('--surface-1'), stroke: cssVar('--border-strong') }));
      root.appendChild(svg('line', { x1: railX + 121, y1: y, x2: gateX + 24, y2: y, stroke: cssVar('--border'), 'stroke-width': 1.4 }));
      var fromY = laneY['p' + i];
      root.appendChild(svg('path', { d: 'M ' + (railX + 54) + ' ' + fromY + ' V ' + (y - 8) + ' H ' + (railX + 80), fill: 'none', stroke: cssVar('--border'), 'stroke-width': 1.2 }));
      root.appendChild(svg('text', { x: 8, y: y + 4, 'font-size': 10.5, class: 'mono-label muted' }, '~' + state.vars[i]));
      laneIndex += 1;
    });
    var gateH = 30, gateGap = 13;
    var gateBlockH = Math.max(cubes.length, 1) * (gateH + gateGap);
    var firstGateY = gateY;
    cubes.forEach(function (cube, gi) {
      var color = groupColor(gi);
      var gy = firstGateY + gi * (gateH + gateGap);
      var lits = [];
      inputs.forEach(function (_, i) {
        var bit = 1 << (state.numVars - 1 - i);
        if (!(cube.mask & bit)) return;
        var positive = (cube.value & bit) !== 0;
        lits.push({ i: i, neg: (isPOS ? positive : !positive) });
      });
      var gx = gateX;
      var gw = 92;
      root.appendChild(svg('rect', { x: gx, y: gy, width: gw, height: gateH, fill: cssVar('--surface-1'), stroke: color, 'stroke-width': 1.8 }));
      root.appendChild(svg('text', { x: gx + gw / 2, y: gy + gateH / 2 + 4, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, class: 'mono-label' },
        (isPOS ? 'OR_' : 'AND_') + (gi + 1)));
      lits.forEach(function (lit, li) {
        var key = (lit.neg ? 'n' : 'p') + lit.i;
        var sy = laneY[key];
        if (sy == null) sy = laneY['p' + lit.i];
        var ex = gx + 16 + li * Math.min(16, (gw - 32) / Math.max(lits.length, 1));
        root.appendChild(svg('path', { d: 'M ' + ex + ' ' + sy + ' V ' + gy, fill: 'none', stroke: color, 'stroke-width': 1.3 }));
        root.appendChild(svg('circle', { cx: ex, cy: sy, r: 2.2, fill: color }));
      });
      root.appendChild(svg('path', { d: 'M ' + (gx + gw) + ' ' + (gy + gateH / 2) + ' H ' + (outerX - 22) + ' V ' + (firstGateY + gateBlockH / 2), fill: 'none', stroke: cssVar('--border-strong'), 'stroke-width': 1.4 }));
      root.appendChild(svg('text', { x: gateX - 10, y: gy + gateH / 2 + 4, 'text-anchor': 'end', 'font-size': 10, class: 'mono-label muted' }, sol.terms[gi] || ''));
    });
    if (!cubes.length) {
      root.appendChild(svg('text', { x: gateX, y: gateY + 20, 'font-size': 11.5, class: 'muted' }, 'Constant ' + sol.expression + ' (0 logic gates)'));
    } else {
      var oy = firstGateY + gateBlockH / 2 - 20;
      root.appendChild(svg('rect', { x: outerX - 22, y: oy, width: 94, height: 40, fill: cssVar('--surface-1'), stroke: cssVar('--accent'), 'stroke-width': 2 }));
      root.appendChild(svg('text', { x: outerX + 25, y: oy + 24, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 700, class: 'mono-label' }, isPOS ? 'AND_OUT' : 'OR_OUT'));
      root.appendChild(svg('path', { d: 'M ' + (outerX + 72) + ' ' + (oy + 20) + ' H ' + outX, fill: 'none', stroke: cssVar('--accent'), 'stroke-width': 2 }));
      root.appendChild(svg('text', { x: outX + 6, y: oy + 24, 'font-size': 11.5, 'font-weight': 700, class: 'mono-label' }, 'F'));
    }
    root.appendChild(svg('text', { x: 12, y: h - 10, 'font-size': 10, class: 'muted' },
      'Propagation path: ' + sol.propagationDelay.levels + ' gate levels (' + sol.propagationDelay.estimate + ' ns nominal).'));
    replace(el.schematicSvg, root);
  }

  function cubeDescription(n) { return n + (n === 1 ? ' prime cube' : ' prime cubes'); }

  /* ---------------- Timing waveform SVG ---------------- */

  function renderWaveform(r) {
    var size = 1 << state.numVars;
    var signals = [];
    state.vars.forEach(function (name, i) {
      signals.push({ name: name, color: cssVar('--accent'), values: Array.from({ length: size }, function (_, m) { return (m >> (state.numVars - 1 - i)) & 1; }) });
    });
    var wave = state.netlistResult && state.netlistResult.waveform;
    var outValues = Array.from({ length: size }, function (_, m) {
      return state.dontCares.indexOf(m) >= 0 ? 'X' : r.truthTable[m];
    });
    signals.push({ name: 'F (' + state.form + ')', color: cssVar('--series-2'), values: outValues });
    signals.push({ name: 'F (SOP)', color: cssVar('--series-3'), values: r.verification.sopOutputs.slice() });
    signals.push({ name: 'F (POS)', color: cssVar('--series-4'), values: r.verification.posOutputs.slice() });
    if (wave && wave.signals.length) {
      wave.signals.forEach(function (s, i) {
        var padded = s.values.slice(0, size);
        while (padded.length < size) padded.push(0);
        signals.push({ name: 'net:' + s.name, color: groupColor(i), values: padded });
      });
    }
    var maxSignals = 12;
    var shown = signals.slice(0, maxSignals);
    var cols = Math.min(size, 32);
    var stride = Math.max(1, Math.ceil(size / cols));
    var indices = [];
    for (var m = 0; m < size; m += stride) indices.push(m);
    var step = Math.max(12, Math.min(26, 480 / indices.length));
    var labelW = 90, x0 = labelW + 10, rowH = 30, top = 32;
    var h = top + shown.length * rowH + 26;
    var w = x0 + indices.length * step + 26;
    var root = makeSvg(w, h, 'Timing waveform for all input combinations');
    root.appendChild(svg('text', { x: 10, y: 17, 'font-size': 11, class: 'secondary', 'font-weight': 700 },
      'HP Logic State Analyzer Trace (' + indices.length + ' of ' + size + ' vectors)'));
    indices.forEach(function (idx, ci) {
      var vx = x0 + ci * step;
      root.appendChild(svg('line', { x1: vx, y1: top - 4, x2: vx, y2: h - 18, stroke: cssVar('--border-soft'), 'stroke-width': 1 }));
      root.appendChild(svg('text', { x: vx + step / 2, y: top - 7, 'text-anchor': 'middle', 'font-size': 9, class: 'mono-label muted' }, String(idx)));
    });
    shown.forEach(function (sig, si) {
      var baseY = top + si * rowH + rowH - 7;
      var highY = baseY - 14;
      root.appendChild(svg('text', { x: 8, y: baseY - 3, 'font-size': 10.5, class: 'mono-label secondary' }, sig.name));
      root.appendChild(svg('line', { x1: x0, y1: baseY, x2: w - 16, y2: baseY, stroke: cssVar('--border-soft'), 'stroke-width': 1, 'stroke-dasharray': '2 3' }));
      var prev = sig.values[indices[0]];
      var path = [];
      function yFor(v) { return v === 'X' ? (baseY + highY) / 2 : (v ? highY : baseY); }
      path.push('M ' + x0 + ' ' + yFor(prev));
      for (var ci = 1; ci < indices.length; ci += 1) {
        var v = sig.values[indices[ci]];
        var x = x0 + ci * step;
        if (v !== prev) {
          path.push('H ' + x);
          path.push('V ' + yFor(v));
          drawMarker(root, x, yFor(prev), prev, sig.color);
          prev = v;
        }
      }
      path.push('H ' + (x0 + indices.length * step));
      root.appendChild(svg('path', { d: path.join(' '), fill: 'none', stroke: sig.color, 'stroke-width': 1.9, 'stroke-linejoin': 'round' }));
      var lastV = sig.values[indices[indices.length - 1]];
      drawMarker(root, x0 + (indices.length - 1) * step, yFor(lastV), lastV, sig.color);
    });
    replace(el.waveformSvg, root);
  }

  function drawMarker(root, x, y, value, color) {
    if (value === 'X') {
      root.appendChild(svg('rect', { x: x - 3.5, y: y - 3.5, width: 7, height: 7, fill: cssVar('--dc'), stroke: cssVar('--surface-1'), 'stroke-width': 1 }));
    } else {
      root.appendChild(svg('circle', { cx: x, cy: y, r: 2.3, fill: color, stroke: cssVar('--surface-1'), 'stroke-width': 1 }));
    }
  }

  /* ---------------- Verilog export ---------------- */

  function renderExport(v) {
    el.moduleFilename.textContent = v.filename;
    el.tbFilename.textContent = v.testbenchFilename;
    el.moduleCode.textContent = v.module;
    el.tbCode.textContent = v.testbench;
    setStatus(el.exportStatus, v.vectorCount + ' testbench vectors generated. Verify with: iverilog -g2001 -o sim.vvp ' +
      v.filename + ' ' + v.testbenchFilename + ' && vvp sim.vvp', '');
  }

  function download(text, filename) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Downloaded ' + filename);
  }

  function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(label + ' copied'); }, function () { fallbackCopy(text, label); });
    } else fallbackCopy(text, label);
  }

  function fallbackCopy(text, label) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(label + ' copied'); }
    catch (err) { toast('Copy unavailable, select the code manually'); }
    ta.remove();
  }

  /* ---------------- Events ---------------- */

  function onKmapClick(ev) {
    var btn = ev.target.closest ? ev.target.closest('.kmap-cell') : null;
    if (!btn) return;
    var m = Number(btn.dataset.minterm);
    var on = state.minterms.indexOf(m);
    var dc = state.dontCares.indexOf(m);
    if (on >= 0) { state.minterms.splice(on, 1); state.dontCares.push(m); }
    else if (dc >= 0) { state.dontCares.splice(dc, 1); }
    else { state.minterms.push(m); }
    state.minterms.sort(function (a, b) { return a - b; });
    state.dontCares.sort(function (a, b) { return a - b; });
    state.preset = '';
    syncInputs();
    recompute();
  }

  function applyExpression() {
    var src = el.exprInput.value.trim();
    if (!src) { setStatus(el.exprStatus, 'Enter an expression first.', 'error'); return; }
    try {
      var tt = LG.evalTruthTable(src, state.vars);
      state.minterms = tt.minterms.slice();
      state.dontCares = [];
      state.preset = '';
      syncInputs();
      recompute();
      setStatus(el.exprStatus, 'Evaluated ' + tt.minterms.length + ' on-set minterms from: ' + src, 'ok');
    } catch (err) {
      setStatus(el.exprStatus, err.message, 'error');
    }
  }

  function loadPreset(id) {
    if (!id) { state.preset = ''; syncInputs(); recompute(); return; }
    var p = LG.getPreset(id);
    var supported = p.numVars >= 2 && p.numVars <= 4;
    state.preset = id;
    if (supported) {
      state.numVars = p.numVars;
      state.vars = p.vars.slice();
    }
    var minterms = p.minterms.slice();
    var note = 'Loaded ' + p.label + '.';
    if (p.numVars > 4) {
      state.numVars = 4;
      state.vars = ['A3', 'B3', 'A2', 'B2'];
      var table = LG.presetTruthTable(id);
      for (var m = 0; m < 16; m += 1) {
        var vector = (1 << 7) | (1 << 6) | (1 << 5) | (1 << 4) |
          (((m >> 3) & 1) << 1) | (((m >> 2) & 1) << 0) |
          (((m >> 1) & 1) << 3) | ((m & 1) << 2);
        if (table[vector]) minterms.push(m);
      }
      note = 'Loaded ' + p.label + '. Karnaugh map shows four upper bits with low carry chain high; run netlist sweep for 512 vectors.';
    }
    if (!minterms.length && p.expr) {
      minterms = LG.evalTruthTable(p.expr, state.vars).minterms;
    }
    state.minterms = minterms;
    state.dontCares = p.dontCares.slice();
    state.moduleName = p.moduleName || 'logicgate_module';
    state.netlistResult = null;
    syncInputs();
    recompute();
    setStatus(el.exprStatus, note, 'ok');
    setStatus(el.netlistStatus, '', '');
  }

  function runNetlist() {
    var p = state.preset ? LG.getPreset(state.preset) : null;
    if (!p || !p.netlist) return;
    var vectors = [];
    var numInputs = p.netlist.inputs.length;
    var count = Math.min(1 << numInputs, 256);
    for (var m = 0; m < count; m += 1) vectors.push(m);
    try {
      state.netlistResult = LG.simulateNetlist(p.netlist, vectors);
      var outputs = state.netlistResult.outputs.join(', ');
      setStatus(el.netlistStatus, 'Simulated ' + count + ' vectors. Outputs: ' + outputs + '. Hazards: ' +
        state.netlistResult.hazards.length + '.', 'ok');
      renderWaveform(state.result);
      toast('Netlist sweep completed');
    } catch (err) {
      setStatus(el.netlistStatus, err.message, 'error');
    }
  }

  function changeVarCount() {
    var n = Number(el.varCount.value);
    var limit = 1 << n;
    state.numVars = n;
    var defaults = ['A', 'B', 'C', 'D'].slice(0, n);
    var old = state.vars.slice(0, n);
    while (old.length < n) old.push(defaults[old.length]);
    state.vars = old;
    state.minterms = state.minterms.filter(function (m) { return m < limit; });
    state.dontCares = state.dontCares.filter(function (m) { return m < limit && state.minterms.indexOf(m) < 0; });
    state.preset = '';
    state.netlistResult = null;
    syncInputs();
    recompute();
  }

  function bind() {
    el.kmapWrap.addEventListener('click', onKmapClick);
    el.exprApply.addEventListener('click', applyExpression);
    el.exprInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') applyExpression(); });
    el.clearAll.addEventListener('click', function () {
      state.minterms = []; state.dontCares = []; state.preset = ''; state.netlistResult = null;
      el.exprInput.value = ''; syncInputs(); recompute();
      setStatus(el.exprStatus, 'Cleared. Click Karnaugh map cells to specify a function.', '');
    });
    el.varCount.addEventListener('change', changeVarCount);
    el.varNames.addEventListener('change', function () {
      state.vars = readVars(); syncInputs(); recompute();
    });
    el.mintermInput.addEventListener('change', function () {
      var limit = 1 << state.numVars;
      state.minterms = parseList(el.mintermInput.value, limit);
      state.dontCares = state.dontCares.filter(function (m) { return state.minterms.indexOf(m) < 0; });
      state.preset = ''; syncInputs(); recompute();
    });
    el.dontCareInput.addEventListener('change', function () {
      var limit = 1 << state.numVars;
      state.dontCares = parseList(el.dontCareInput.value, limit).filter(function (m) { return state.minterms.indexOf(m) < 0; });
      state.preset = ''; syncInputs(); recompute();
    });
    el.formSelect.addEventListener('change', function () { state.form = el.formSelect.value; recompute(); });
    el.moduleNameInput.addEventListener('change', function () {
      state.moduleName = el.moduleNameInput.value.trim() || 'logicgate_module';
      recompute();
    });
    el.presetSelect.addEventListener('change', function () { loadPreset(el.presetSelect.value); });
    el.runNetlist.addEventListener('click', runNetlist);
    el.showGroups.addEventListener('change', function () { state.showGroups = el.showGroups.checked; renderKmap(state.result); });
    el.showTexture.addEventListener('change', function () { state.showTexture = el.showTexture.checked; renderGroups(state.result); });
    el.ttToggle.addEventListener('click', function () { state.highlight = !state.highlight; renderTruthTable(state.result); });
    el.themeToggle.addEventListener('click', function () {
      var dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
      el.themeToggle.textContent = dark ? 'HP Analyzer CRT' : 'IEEE Paper Datasheet';
      el.themeToggle.setAttribute('aria-pressed', String(!dark));
      renderAll();
    });
    el.helpToggle.addEventListener('click', function () {
      var open = el.helpPanel.hidden;
      el.helpPanel.hidden = !open;
      el.helpToggle.setAttribute('aria-expanded', String(open));
    });
    el.copyModule.addEventListener('click', function () { copyText(state.verilog.module, 'Module'); });
    el.copyTb.addEventListener('click', function () { copyText(state.verilog.testbench, 'Testbench'); });
    el.downloadModule.addEventListener('click', function () { download(state.verilog.module, state.verilog.filename); });
    el.downloadTb.addEventListener('click', function () { download(state.verilog.testbench, state.verilog.testbenchFilename); });
  }

  function init() {
    if (!LG) { document.body.innerHTML = '<p style="padding:30px">logic.js failed to load.</p>'; return; }
    LG.listPresets().forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.label;
      el.presetSelect.appendChild(opt);
    });
    bind();
    syncInputs();
    recompute();
    setStatus(el.exprStatus, 'Ready. Click Karnaugh map cells or enter a Boolean equation.', 'ok');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
