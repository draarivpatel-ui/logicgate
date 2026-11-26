/* LogicGate timing and verification lab. Zero dependencies. UMD: CommonJS, AMD, and browser global.
   Extends logic.js with gate-level critical-path analysis, transport-delay hazard
   simulation, exhaustive circuit equivalence, structural Verilog export, FIPS 180-4
   SHA-256 report digests, CSV/Markdown report builders and strict URL bookmarks.
   Every delay number is an illustrative nominal model, never a device measurement. */
(function (root, factory) {
  'use strict';
  var LG;
  if (typeof module === 'object' && module.exports) {
    LG = require('./logic.js');
    module.exports = factory(LG);
  } else if (typeof define === 'function' && define.amd) {
    define(['./logic.js'], function (mod) { return factory(mod || root.LogicGate); });
    LG = root.LogicGate;
  } else {
    root.LogicLab = factory(root.LogicGate);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (LG) {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_EQ_VARS = 6;           /* Exhaustive equivalence is specified to 2^6 = 64 vectors. */
  var MAX_HAZARD_VARS = 12;      /* Hazard scans cost inputs * 2^inputs transition sims. */
  var MAX_BOOKMARK_LEN = 8192;
  var MAX_EVENTS = 20000;        /* Transition-sim event budget; far above any legal DAG need. */

  function LabError(message) {
    var err = new Error(message);
    err.name = 'LogicLabError';
    return err;
  }

  /* ------------------------------------------------------------------ *
   * 1. Gate semantics and nominal delays
   * ------------------------------------------------------------------ */

  /* Gate functions mirror logic.js GATE_DEFS exactly; they are re-declared
     here because the engine does not publish its gate table internals. */
  var GATE_FNS = {
    AND: { inputs: 2, outputs: ['y'], fn: function (a) { return a[0] & a[1]; } },
    OR: { inputs: 2, outputs: ['y'], fn: function (a) { return a[0] | a[1]; } },
    NOT: { inputs: 1, outputs: ['y'], fn: function (a) { return 1 - a[0]; } },
    XOR: { inputs: 2, outputs: ['y'], fn: function (a) { return a[0] ^ a[1]; } },
    NAND: { inputs: 2, outputs: ['y'], fn: function (a) { return 1 - (a[0] & a[1]); } },
    NOR: { inputs: 2, outputs: ['y'], fn: function (a) { return 1 - (a[0] | a[1]); } },
    XNOR: { inputs: 2, outputs: ['y'], fn: function (a) { return 1 - (a[0] ^ a[1]); } },
    BUF: { inputs: 1, outputs: ['y'], fn: function (a) { return a[0]; } },
    MUX2: { inputs: 3, outputs: ['y'], fn: function (a) { return a[2] ? a[1] : a[0]; } },
    HALF_ADDER: { inputs: 2, outputs: ['sum', 'carry'], fn: function (a) { return { sum: a[0] ^ a[1], carry: a[0] & a[1] }; } },
    FULL_ADDER: {
      inputs: 3, outputs: ['sum', 'carry'], fn: function (a) {
        var s = a[0] ^ a[1] ^ a[2];
        var c = (a[0] & a[1]) | (a[2] & (a[0] ^ a[1]));
        return { sum: s, carry: c };
      }
    },
    DFF: { inputs: 1, outputs: ['q'], sequential: true, fn: function (a) { return { q: a[0] }; } },
    CONST: { inputs: 0, outputs: ['y'], fn: function () { return 0; } }
  };

  /* Nominal per-gate delays in nanoseconds. Composite cells carry per-port
     delays. Illustrative only: not a measurement of any device family. */
  var DEFAULT_DELAYS = {
    NOT: 2, BUF: 2, AND: 3, OR: 3, NAND: 2, NOR: 2, XOR: 4, XNOR: 4,
    MUX2: 5, CONST: 0, DFF: 0,
    HALF_ADDER: { sum: 4, carry: 3 },
    FULL_ADDER: { sum: 8, carry: 6 }
  };

  function gateDelay(node, port, overrides) {
    if (node.params && node.params.delay != null) {
      var own = node.params.delay;
      if (typeof own === 'number') return own;
      if (own && typeof own === 'object' && own[port] != null) return own[port];
    }
    var table = (overrides && overrides[node.type] != null) ? overrides : DEFAULT_DELAYS;
    var d = table[node.type];
    if (d == null) d = DEFAULT_DELAYS[node.type];
    if (d == null) return 3;
    if (typeof d === 'number') return d;
    return d[port] != null ? d[port] : 3;
  }

  /* Build a resolved graph in the same netlist dialect as logic.js:
     inputs are virtual IN: sources, edges accept from/to plus
     source/target and output/input aliases. */
  function buildNetlist(netlist) {
    if (!netlist || typeof netlist !== 'object') throw LabError('netlist must be an object');
    var nodes = Array.isArray(netlist.nodes) ? netlist.nodes : [];
    var edges = Array.isArray(netlist.edges) ? netlist.edges : [];
    var inputs = Array.isArray(netlist.inputs) ? netlist.inputs : [];
    var byName = new Map();
    inputs.forEach(function (inp) {
      var name = typeof inp === 'string' ? inp : inp && inp.name;
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw LabError('input must have a valid identifier name');
      if (byName.has('IN:' + name)) throw LabError('duplicate input name: ' + name);
      byName.set('IN:' + name, {
        id: 'IN:' + name, type: 'INPUT', virtual: true,
        def: { inputs: 0, outputs: ['y'] }, inputs: [], outputs: ['y'],
        label: name, params: {}
      });
    });
    nodes.forEach(function (n) {
      if (!n || typeof n.id !== 'string' || !n.id || n.id.indexOf('IN:') === 0) throw LabError('each node needs a nonempty string id outside the IN: namespace');
      if (byName.has(n.id)) throw LabError('duplicate node id: ' + n.id);
      var type = String(n.type || '').toUpperCase();
      var def = GATE_FNS[type];
      if (!def) throw LabError('unknown node type "' + type + '" on ' + n.id);
      byName.set(n.id, {
        id: n.id, type: type, def: def,
        inputs: new Array(def.inputs).fill(null),
        outputs: def.outputs.slice(),
        label: n.label || n.id,
        init: n.init === 1 || n.init === true ? 1 : 0,
        params: n.params || (n.delay != null ? { delay: n.delay } : {})
      });
    });
    var consumers = new Map();
    function addConsumer(signal, node, portIndex) {
      if (!consumers.has(signal)) consumers.set(signal, []);
      consumers.get(signal).push({ node: node, portIndex: portIndex });
    }
    edges.forEach(function (e, i) {
      if (!e || typeof e !== 'object') throw LabError('invalid edge at index ' + i);
      var fromRaw = typeof e.from === 'string' ? e.from : e.source;
      var to = typeof e.to === 'string' ? e.to : e.target;
      var fromPort = e.fromPort != null ? e.fromPort : (e.output != null ? e.output : 'y');
      var toPort = e.toPort != null ? e.toPort : (e.input != null ? e.input : 0);
      var from = fromRaw;
      if (typeof fromRaw === 'string' && fromRaw.indexOf('IN:') === 0 && byName.has('IN:' + fromRaw.slice(3))) {
        from = 'IN:' + fromRaw.slice(3);
      } else if (typeof fromRaw === 'string' && !byName.has(fromRaw) && byName.has('IN:' + fromRaw)) {
        from = 'IN:' + fromRaw;
      }
      if (!byName.has(from)) throw LabError('edge ' + i + ' has unknown source "' + fromRaw + '"');
      if (!byName.has(to)) throw LabError('edge ' + i + ' has unknown target "' + to + '"');
      var src = byName.get(from);
      var dst = byName.get(to);
      if (src.outputs.indexOf(fromPort) < 0) throw LabError('edge ' + i + ' references missing output port ' + fromPort);
      var idx = typeof toPort === 'number' ? toPort : dst.inputs.indexOf(toPort);
      if (!Number.isInteger(idx) || idx < 0 || idx >= dst.inputs.length) throw LabError('edge ' + i + ' references invalid input port ' + toPort);
      if (dst.inputs[idx]) throw LabError('node ' + to + ' input ' + idx + ' is driven more than once');
      dst.inputs[idx] = { node: from, port: fromPort };
      addConsumer(from + ':' + fromPort, dst, idx);
    });
    var outputs = Array.isArray(netlist.outputs) ? netlist.outputs.map(function (o) {
      if (!o || typeof o !== 'object' || !byName.has(o.node)) throw LabError('output references missing node "' + (o && o.node) + '"');
      if (byName.get(o.node).outputs.indexOf(o.port) < 0) throw LabError('output references missing port "' + o.port + '"');
      var name = o.name || (o.node + '_' + o.port);
      return { node: o.node, port: o.port, name: name, signal: o.node + ':' + o.port };
    }) : [];
    return {
      byName: byName,
      nodes: Array.from(byName.values()),
      gates: Array.from(byName.values()).filter(function (n) { return !n.virtual; }),
      inputs: inputs.map(function (i) { return typeof i === 'string' ? i : i.name; }),
      outputs: outputs,
      consumers: consumers,
      edges: edges
    };
  }

  /* Topological order over the combinational cone; sequential nodes act as
     boundaries (their outputs are sources, their inputs are sinks). */
  function topoOrder(graph) {
    var state = new Map();
    var order = [];
    var frames = [];
    graph.gates.forEach(function (root) {
      if (state.get(root.id) === 2) return;
      state.set(root.id, 1);
      frames.push({ node: root, next: 0 });
      while (frames.length) {
        var frame = frames[frames.length - 1];
        var node = frame.node;
        var deps = node.def.sequential ? [] : node.inputs;
        var pushed = false;
        while (frame.next < deps.length) {
          var w = deps[frame.next];
          frame.next += 1;
          if (!w) continue;
          var s = state.get(w.node);
          if (s === 2) continue;
          if (s === 1) throw LabError('combinational cycle detected at ' + w.node);
          var dep = graph.byName.get(w.node);
          if (dep.virtual) continue;
          state.set(w.node, 1);
          frames.push({ node: dep, next: 0 });
          pushed = true;
          break;
        }
        if (!pushed) { frames.pop(); state.set(node.id, 2); order.push(node); }
      }
    });
    return order;
  }

  function requireCombinational(graph, feature) {
    graph.gates.forEach(function (n) {
      if (n.def.sequential) throw LabError(feature + ' analyzes combinational logic only; ' + n.id + ' is a register (reg-to-reg timing is outside this model)');
    });
  }

  /* One settled combinational evaluation for a single input vector. */
  function evalSteady(graph, vector) {
    var order = topoOrder(graph);
    var values = new Map();
    var nIn = graph.inputs.length;
    graph.inputs.forEach(function (name, idx) {
      var v = 0;
      if (typeof vector === 'number') v = (vector >> (nIn - 1 - idx)) & 1;
      else if (Array.isArray(vector)) v = vector[idx] ? 1 : 0;
      else if (vector && typeof vector === 'object') v = vector[name] ? 1 : 0;
      values.set('IN:' + name + ':y', v);
    });
    order.forEach(function (node) {
      var args = node.inputs.map(function (w) {
        if (!w) return 0;
        var key = w.node + ':' + w.port;
        return values.has(key) ? values.get(key) : 0;
      });
      var result = node.def.fn(args);
      if (node.type === 'CONST') result = Number(node.params.value) ? 1 : 0;
      if (typeof result === 'number') values.set(node.id + ':y', result & 1);
      else node.outputs.forEach(function (p) { values.set(node.id + ':' + p, result[p] & 1); });
    });
    return values;
  }

  function readOutputs(graph, values) {
    var out = Object.create(null);
    graph.outputs.forEach(function (o) { out[o.name] = values.has(o.signal) ? values.get(o.signal) : 0; });
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 2. Critical-path propagation delay and f_max
   * ------------------------------------------------------------------ */

  /* Longest-path arrival analysis over the gate DAG. Each gate output arrives
     one gate-delay after the latest of its inputs. The critical path is the
     longest input-to-output chain, reported with its per-node breakdown. */
  function criticalPath(netlist, options) {
    var opts = options || {};
    var graph = buildNetlist(netlist);
    requireCombinational(graph, 'Critical-path analysis');
    var order = topoOrder(graph);
    var arrival = new Map();
    var prev = new Map();
    graph.inputs.forEach(function (name) { arrival.set('IN:' + name + ':y', 0); });
    order.forEach(function (node) {
      node.outputs.forEach(function (port) {
        var d = gateDelay(node, port, opts.delays);
        var best = -1;
        var bestWire = null;
        node.inputs.forEach(function (w) {
          var a = w ? (arrival.get(w.node + ':' + w.port) || 0) : 0;
          if (a > best) { best = a; bestWire = w; }
        });
        if (node.inputs.length === 0) best = 0;
        var key = node.id + ':' + port;
        arrival.set(key, best + d);
        if (bestWire) prev.set(key, bestWire.node + ':' + bestWire.port);
        else prev.set(key, null);
      });
    });
    var endpoints = [];
    if (graph.outputs.length) {
      graph.outputs.forEach(function (o) { endpoints.push({ signal: o.signal, name: o.name, delayNs: arrival.get(o.signal) || 0 }); });
    } else {
      arrival.forEach(function (t, sig) { if (sig.indexOf('IN:') !== 0) endpoints.push({ signal: sig, name: sig, delayNs: t }); });
    }
    endpoints.sort(function (a, b) { return b.delayNs - a.delayNs; });
    var top = endpoints[0] || { signal: null, name: '(no outputs)', delayNs: 0 };
    var path = [];
    var cursor = top.signal;
    while (cursor) {
      path.unshift(cursor);
      var p = prev.get(cursor);
      cursor = p === undefined ? null : p;
    }
    var delayNs = top.delayNs;
    return {
      delayNs: delayNs,
      units: 'ns',
      fMaxMHz: delayNs > 0 ? 1000 / delayNs : null,
      fMaxNote: delayNs > 0
        ? 'f_max = 1 / t_pd treats the critical path as the register-to-register bound (illustrative nominal model)'
        : 'No gate delay on any path; the circuit is a wire or constant (f_max unbounded in this model)',
      longestOutput: top.name,
      path: path,
      levels: path.filter(function (s) { return s && s.indexOf('IN:') !== 0; }).length,
      arrivals: Object.fromEntries(arrival),
      endpoints: endpoints,
      model: 'Nominal per-gate delays (ns); longest single path to any output. Illustrative only, not a device measurement.'
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. Transport-delay transition simulation and hazard detection
   * ------------------------------------------------------------------ */

  /* Event-driven unit-delay simulation of a single-input transition.
     The toggled input commits at t = 0; every gate output commits one
     nominal delay after its input event (transport model: pulses propagate).
     The committed waveform per signal exposes glitches directly. */
  function transitionSim(netlist, fromVector, inputRef, options) {
    var opts = options || {};
    var graph = opts._graph || buildNetlist(netlist);
    requireCombinational(graph, 'Transition simulation');
    var nIn = graph.inputs.length;
    var idx = typeof inputRef === 'number' ? inputRef : graph.inputs.indexOf(inputRef);
    if (!Number.isInteger(idx) || idx < 0 || idx >= nIn) throw LabError('unknown toggled input "' + inputRef + '"');
    if (!Number.isInteger(fromVector) || fromVector < 0 || fromVector >= (1 << nIn)) {
      throw LabError('fromVector must be an integer in 0..' + ((1 << nIn) - 1) + ' for ' + nIn + ' inputs');
    }
    var bit = 1 << (nIn - 1 - idx);
    var toVector = fromVector ^ bit;
    var s0 = evalSteady(graph, fromVector);
    var s1 = evalSteady(graph, toVector);
    var current = new Map(s0);
    var lastScheduled = new Map(s0);
    var timeline = new Map();
    current.forEach(function (v, sig) { timeline.set(sig, [{ t: -1, v: v }]); });
    var inputSignal = 'IN:' + graph.inputs[idx] + ':y';
    var events = [{ t: 0, signal: inputSignal, v: s1.get(inputSignal) }];
    var eventCount = 0;
    var tMax = 0;
    while (events.length) {
      if (++eventCount > MAX_EVENTS) throw LabError('transition event budget exceeded; check for a combinational cycle');
      var mi = 0;
      for (var e = 1; e < events.length; e += 1) if (events[e].t < events[mi].t) mi = e;
      var ev = events.splice(mi, 1)[0];
      if (current.get(ev.signal) === ev.v) continue;
      current.set(ev.signal, ev.v);
      timeline.get(ev.signal).push({ t: ev.t, v: ev.v });
      if (ev.t > tMax) tMax = ev.t;
      var list = graph.consumers.get(ev.signal) || [];
      list.forEach(function (c) {
        var node = c.node;
        var args = node.inputs.map(function (w) {
          if (!w) return 0;
          var key = w.node + ':' + w.port;
          return current.has(key) ? current.get(key) : 0;
        });
        var result = node.def.fn(args);
        if (node.type === 'CONST') result = Number(node.params.value) ? 1 : 0;
        node.outputs.forEach(function (port) {
          var newV = (typeof result === 'number' ? result : result[port]) & 1;
          var key = node.id + ':' + port;
          if (lastScheduled.get(key) === newV) return;
          lastScheduled.set(key, newV);
          events.push({ t: ev.t + gateDelay(node, port, opts.delays), signal: key, v: newV });
        });
      });
    }
    /* Classify each output's committed waveform. */
    var outputReport = graph.outputs.map(function (o) {
      var v0 = s0.get(o.signal), v1 = s1.get(o.signal);
      var line = timeline.get(o.signal);
      var glitch = null;
      var dynamic = false;
      var visits = [];
      line.forEach(function (pt) { if (pt.t >= 0) visits.push(pt); });
      if (v0 === v1) {
        var start = -1, end = -1;
        visits.forEach(function (pt) {
          if (pt.v !== v0 && start < 0) start = pt.t;
          if (pt.v === v0 && start >= 0 && end < 0) end = pt.t;
        });
        if (start >= 0) glitch = { startNs: start, endNs: end >= 0 ? end : null, widthNs: end >= 0 ? end - start : null, type: v0 === 1 ? 'static-1' : 'static-0' };
      } else {
        /* A proper transition is monotone; extra excursions flag a dynamic hazard. */
        var others = 0;
        visits.forEach(function (pt) {
          if (pt.v !== v0 && pt.v !== v1) others += 1;
        });
        var crossings = 0;
        for (var i2 = 0; i2 < visits.length; i2 += 1) {
          var prv = i2 === 0 ? v0 : visits[i2 - 1].v;
          if (visits[i2].v !== prv) crossings += 1;
        }
        if (others > 0 || crossings > 1) dynamic = true;
      }
      return { output: o.name, signal: o.signal, from: v0, to: v1, hazard: glitch ? glitch.type : (dynamic ? 'dynamic' : null), glitch: glitch, dynamic: dynamic };
    });
    return {
      input: graph.inputs[idx],
      inputIndex: idx,
      fromVector: fromVector,
      toVector: toVector,
      steady: { from: Object.fromEntries(s0), to: Object.fromEntries(s1) },
      timelines: timeline,
      signals: Array.from(timeline.keys()),
      outputs: outputReport,
      eventCount: eventCount,
      tMaxNs: tMax,
      units: 'ns',
      model: 'Transport-delay event simulation under nominal per-gate delays; pulses propagate in full. Illustrative only.'
    };
  }

  /* Scan every single-input transition in both directions. A glitch means the
     steady states agree but a committed excursion disagrees (static), or the
     transition is non-monotone (dynamic). */
  function detectHazards(netlist, options) {
    var opts = options || {};
    var graph = buildNetlist(netlist);
    requireCombinational(graph, 'Hazard detection');
    var nIn = graph.inputs.length;
    if (nIn > (opts.maxInputBits || MAX_HAZARD_VARS)) throw LabError('hazard scan supports at most ' + (opts.maxInputBits || MAX_HAZARD_VARS) + ' inputs');
    var hazards = [];
    var checked = 0;
    var shared = Object.assign({}, opts, { _graph: graph });
    for (var idx = 0; idx < nIn; idx += 1) {
      for (var v = 0; v < (1 << nIn); v += 1) {
        var sim = transitionSim(netlist, v, idx, shared);
        checked += 1;
        sim.outputs.forEach(function (r) {
          if (!r.hazard) return;
          hazards.push({
            input: sim.input,
            fromVector: v,
            toVector: sim.toVector,
            output: r.output,
            type: r.hazard,
            glitchStartNs: r.glitch ? r.glitch.startNs : null,
            glitchEndNs: r.glitch ? r.glitch.endNs : null,
            pulseWidthNs: r.glitch ? r.glitch.widthNs : null,
            note: r.hazard === 'dynamic'
              ? 'Non-monotone transition: the output can pulse through an intermediate value'
              : 'Unbalanced path delays can produce a ' + r.hazard + ' glitch pulse'
          });
        });
      }
    }
    return {
      hazards: hazards,
      checkedTransitions: checked,
      inputs: graph.inputs.length,
      outputs: graph.outputs.map(function (o) { return o.name; }),
      units: 'ns',
      model: 'Transport-delay event simulation under nominal per-gate delays; flags possible pulses, not measured device behavior.'
    };
  }

  /* ------------------------------------------------------------------ *
   * 4. Exhaustive truth-table equivalence (n <= 6 inputs)
   * ------------------------------------------------------------------ */

  function descriptorOutputs(desc) {
    if (!desc || typeof desc !== 'object') throw LabError('circuit descriptor must be an object');
    if (typeof desc.expr === 'string') {
      var tt = LG.evalTruthTable(desc.expr, desc.vars);
      var name = desc.outputName || 'F';
      return { inputs: tt.vars, outputs: [{ name: name, values: tt.outputs.slice() }] };
    }
    if (desc.netlist) {
      var graph = buildNetlist(desc.netlist);
      requireCombinational(graph, 'Equivalence checking');
      var nIn = graph.inputs.length;
      if (nIn > MAX_EQ_VARS) throw LabError('netlist has ' + nIn + ' inputs; exhaustive equivalence supports at most ' + MAX_EQ_VARS);
      var outs = graph.outputs.map(function (o) { return { name: o.name, values: [] }; });
      for (var v = 0; v < (1 << nIn); v += 1) {
        var values = evalSteady(graph, v);
        outs.forEach(function (o, i2) { o.values.push(values.get(graph.outputs[i2].signal)); });
      }
      return { inputs: graph.inputs, outputs: outs };
    }
    if (desc.numVars != null || desc.minterms != null || desc.dontCares != null) {
      var numVars = desc.numVars;
      if (numVars == null) throw LabError('spec descriptor requires numVars');
      var tbl = LG.fromMinterms(numVars, desc.minterms || [], desc.dontCares || []);
      var masked = tbl.care.map(function (c, i2) { return c ? tbl.outputs[i2] : 'x'; });
      return { inputs: desc.vars || LG.fromMinterms(numVars, [], []).vars, outputs: [{ name: desc.outputName || 'F', values: masked }] };
    }
    if (desc.inputs && desc.table) {
      var names = desc.inputs.slice();
      var outs2 = Object.keys(desc.table).map(function (k) { return { name: k, values: desc.table[k].slice() }; });
      return { inputs: names, outputs: outs2 };
    }
    throw LabError('descriptor needs expr, netlist, numVars/minterms, or inputs/table');
  }

  /* Compare two circuit descriptors bit-for-bit over all 2^n input vectors,
     n <= 6. Input names align by name when sets match, else by position. */
  function equivalenceCheck(descA, descB, options) {
    var a = descriptorOutputs(descA);
    var b = descriptorOutputs(descB);
    if (a.inputs.length !== b.inputs.length) {
      throw LabError('input counts differ: ' + a.inputs.length + ' vs ' + b.inputs.length);
    }
    var n = a.inputs.length;
    if (n > MAX_EQ_VARS) throw LabError('exhaustive equivalence supports at most ' + MAX_EQ_VARS + ' inputs (' + (1 << MAX_EQ_VARS) + ' vectors)');
    /* Bit permutation from b's input order to a's. */
    var map = null;
    var upper = function (s) { return String(s).toUpperCase(); };
    var aSet = a.inputs.map(upper), bSet = b.inputs.map(upper);
    var sameSet = aSet.slice().sort().join(',') === bSet.slice().sort().join(',');
    if (sameSet) {
      map = bSet.map(function (name) { return aSet.indexOf(name); });
    } else {
      map = bSet.map(function (_, i2) { return i2; });
    }
    function bitOf(inputs, idx, vector) { return (vector >> (inputs - 1 - idx)) & 1; }
    var outNames = {};
    a.outputs.forEach(function (o) { outNames[o.name] = true; });
    b.outputs.forEach(function (o) { outNames[o.name] = true; });
    var pairs = [];
    var equalCounts = a.outputs.length === b.outputs.length;
    a.outputs.forEach(function (oa, oi) {
      var ob = b.outputs.filter(function (x) { return upper(x.name) === upper(oa.name); })[0];
      /* Positional pairing is only meaningful when both sides expose the same
         number of outputs; otherwise an output could compare against a
         different function. */
      if (!ob && equalCounts) ob = b.outputs[oi];
      if (ob) pairs.push({ name: oa.name, nameB: ob.name, a: oa, b: ob });
    });
    if (!pairs.length) pairs = [{ name: a.outputs[0].name, nameB: b.outputs[0].name, a: a.outputs[0], b: b.outputs[0] }];
    var vectors = 1 << n;
    var mismatches = [];
    var mismatchCount = 0;
    var masked = 0;
    var checked = 0;
    for (var v = 0; v < vectors; v += 1) {
      /* Reorder vector bits into b's input order. */
      var vb = 0;
      for (var i2 = 0; i2 < n; i2 += 1) {
        var aBit = bitOf(n, map[i2], v);
        vb |= aBit << (n - 1 - i2);
      }
      pairs.forEach(function (pair) {
        var va = pair.a.values[v];
        var vbv = pair.b.values[vb];
        if (va === 'x' || vbv === 'x' || va === 'X' || vbv === 'X') { masked += 1; return; }
        checked += 1;
        if (va !== vbv) {
          mismatchCount += 1;
          if (mismatches.length < 64) {
            mismatches.push({ vector: v, inputs: a.inputs.map(function (nm, i3) { return nm + '=' + bitOf(n, i3, v); }).join(','), output: pair.name, a: va, b: vbv });
          }
        }
      });
    }
    return {
      pass: mismatchCount === 0,
      vectors: vectors,
      checked: checked,
      maskedDontCares: masked,
      mismatchCount: mismatchCount,
      mismatches: mismatches,
      comparedOutputs: pairs.map(function (p) { return p.name; }),
      inputOrderA: a.inputs,
      inputOrderB: b.inputs,
      alignedByName: sameSet,
      note: 'Exhaustive bit-for-bit comparison over all ' + vectors + ' input vectors.'
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. Quine-McCluskey SOP minimizer (<= 4 variables)
   * ------------------------------------------------------------------ */

  function minimizeSOP(numVars, minterms, dontCares, options) {
    if (!Number.isInteger(numVars) || numVars < 1 || numVars > 4) {
      throw LabError('the minimization lab covers 1 to 4 variables');
    }
    var opts = options || {};
    var r = LG.minimizeBoolean(numVars, minterms, dontCares || [], { vars: opts.vars });
    var sop = r.sop;
    return {
      numVars: numVars,
      vars: r.vars,
      minterms: r.minterms,
      dontCares: r.dontCares,
      expression: sop.expression,
      terms: sop.terms.slice(),
      products: sop.products.slice(),
      literals: sop.literalCount,
      termCount: sop.termCount,
      gateCount: sop.gateCount,
      primes: r.primeImplicants.map(function (p) { return p.text; }),
      essentialPrimes: r.essentialPrimeImplicants.map(function (p) { return p.text; }),
      optimal: sop.optimal !== false,
      propagationDelay: sop.propagationDelay,
      outputs: r.verification.sopOutputs.slice(),
      matchesAllCareStates: r.verification.sopMatchesCareInputs === true,
      hazards: r.hazards.sop
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. Structural Verilog-2001 export
   * ------------------------------------------------------------------ */

  var VERILOG_RESERVED = /^(always|and|assign|automatic|begin|buf|bufif0|bufif1|case|casex|casez|cell|cmos|config|deassign|default|defparam|design|disable|edge|else|end|endcase|endconfig|endfunction|endgenerate|endmodule|endprimitive|endspecify|endtable|endtask|event|for|force|forever|fork|function|generate|genvar|highz0|highz1|if|ifnone|incdir|include|initial|inout|input|instance|integer|join|large|liblist|library|localparam|macromodule|medium|module|nand|negedge|nmos|nor|noshowcancelled|not|notif0|notif1|or|output|parameter|pmos|posedge|primitive|pull0|pull1|pulldown|pullup|pulsestyle_onevent|pulsestyle_ondetect|rcmos|real|realtime|reg|release|repeat|rnmos|rpmos|rtran|rtranif0|rtranif1|scalared|showcancelled|signed|small|specify|specparam|strong0|strong1|supply0|supply1|table|task|time|tran|tranif0|tranif1|tri|tri0|tri1|triand|trior|trireg|unsigned|use|vectored|wait|wand|weak0|weak1|while|wire|wor|xnor|xor)$/i;

  function sanitizeIdent(name, fallback) {
    var s = String(name == null ? '' : name).replace(/[^A-Za-z0-9_]/g, '_');
    if (!s || /^[0-9]/.test(s)) s = (fallback || 'sig') + '_' + s;
    if (VERILOG_RESERVED.test(s)) s = 'lg_' + s;
    return s;
  }

  function uniqueId(used, base) {
    var name = base, i = 1;
    while (used.has(name)) { name = base + '_' + i; i += 1; }
    used.add(name);
    return name;
  }

  /* Emit a gate-level structural module: one primitive instantiation (or an
     expansion into primitives for composite cells) per netlist node. Wire
     names and expansion temporaries are allocated before emission so every
     declaration precedes its use. */
  function exportStructuralVerilog(netlist, options) {
    var opts = options || {};
    var graph = buildNetlist(netlist);
    requireCombinational(graph, 'Structural Verilog export');
    var moduleName = sanitizeIdent(opts.moduleName || 'logicgate_netlist', 'lg_module');
    var used = new Set();
    var inNames = {};
    graph.inputs.forEach(function (nm) {
      inNames[nm] = uniqueId(used, sanitizeIdent(nm, 'in'));
    });
    var outNames = {};
    graph.outputs.forEach(function (o) {
      outNames[o.name] = uniqueId(used, sanitizeIdent(o.name, 'out'));
    });
    /* Expansion temporaries for composite cells, allocated up front. */
    var EXPANSION_TEMPS = { MUX2: ['nsel', 'sel_lo', 'sel_hi'], FULL_ADDER: ['xab', 'gen', 'prop'] };
    var wireFor = {};
    var allWires = [];
    function wire(tag) {
      var name = uniqueId(used, sanitizeIdent(tag, 'w'));
      allWires.push(name);
      return name;
    }
    graph.gates.forEach(function (n) {
      n.outputs.forEach(function (p) { wireFor[n.id + ':' + p] = wire('n_' + n.id + '_' + p); });
      (EXPANSION_TEMPS[n.type] || []).forEach(function (t) { wireFor[n.id + ':' + t] = wire('n_' + n.id + '_' + t); });
    });
    function wireOf(sig) {
      if (sig.indexOf('IN:') === 0) return inNames[sig.slice(3, sig.lastIndexOf(':'))];
      return wireFor[sig];
    }
    var insts = [];
    var instCount = 0;
    function emit(text) { insts.push('    ' + text); instCount += 1; }
    graph.gates.forEach(function (n) {
      var ins = n.inputs.map(function (w) { return w ? wireOf(w.node + ':' + w.port) : "1'b0"; });
      var outp = function (p) { return wireFor[n.id + ':' + p]; };
      var gid = sanitizeIdent(n.id, 'g');
      switch (n.type) {
        case 'AND': case 'OR': case 'XOR': case 'NAND': case 'NOR': case 'XNOR':
          emit(n.type.toLowerCase() + ' ' + gid + ' (' + outp('y') + ', ' + ins.join(', ') + ');'); break;
        case 'NOT': emit('not ' + gid + ' (' + outp('y') + ', ' + ins[0] + ');'); break;
        case 'BUF': emit('buf ' + gid + ' (' + outp('y') + ', ' + ins[0] + ');'); break;
        case 'CONST': insts.push('    assign ' + outp('y') + " = 1'b" + (Number(n.params.value) ? 1 : 0) + ';'); break;
        case 'MUX2':
          /* y = sel ? i1 : i0 expands to not/and/and/or primitives. */
          emit('not ' + gid + '_inv (' + outp('nsel') + ', ' + ins[2] + ');');
          emit('and ' + gid + '_lo (' + outp('sel_lo') + ', ' + ins[0] + ', ' + outp('nsel') + ');');
          emit('and ' + gid + '_hi (' + outp('sel_hi') + ', ' + ins[1] + ', ' + ins[2] + ');');
          emit('or ' + gid + '_out (' + outp('y') + ', ' + outp('sel_lo') + ', ' + outp('sel_hi') + ');');
          break;
        case 'HALF_ADDER':
          emit('xor ' + gid + '_sum (' + outp('sum') + ', ' + ins.join(', ') + ');');
          emit('and ' + gid + '_cy (' + outp('carry') + ', ' + ins.join(', ') + ');');
          break;
        case 'FULL_ADDER':
          emit('xor ' + gid + '_x1 (' + outp('xab') + ', ' + ins[0] + ', ' + ins[1] + ');');
          emit('xor ' + gid + '_x2 (' + outp('sum') + ', ' + outp('xab') + ', ' + ins[2] + ');');
          emit('and ' + gid + '_a1 (' + outp('gen') + ', ' + ins[0] + ', ' + ins[1] + ');');
          emit('and ' + gid + '_a2 (' + outp('prop') + ', ' + outp('xab') + ', ' + ins[2] + ');');
          emit('or ' + gid + '_cy (' + outp('carry') + ', ' + outp('gen') + ', ' + outp('prop') + ');');
          break;
        default: throw LabError('no structural emission for node type ' + n.type);
      }
    });
    var ports = graph.inputs.map(function (i2) { return 'input  wire ' + inNames[i2]; })
      .concat(graph.outputs.map(function (o) { return 'output wire ' + outNames[o.name]; }));
    var lines = [
      '`timescale 1ns/1ps',
      '// LogicGate generated structural Verilog-2001 netlist',
      '// Gate-level primitive instantiations; delay model notes are illustrative only',
      '// Inputs: ' + graph.inputs.join(', ') + ' | Outputs: ' + graph.outputs.map(function (o) { return o.name; }).join(', '),
      '`default_nettype none',
      'module ' + moduleName + ' (',
      '    ' + ports.join(',\n    '),
      ');',
      ''
    ];
    if (allWires.length) lines.push('    wire ' + allWires.join(', ') + ';', '');
    lines.push.apply(lines, insts);
    graph.outputs.forEach(function (o) {
      lines.push('    assign ' + outNames[o.name] + ' = ' + wireOf(o.signal) + ';');
    });
    lines.push('', 'endmodule', '`default_nettype wire');
    var module = lines.join('\n') + '\n';
    var result = {
      moduleName: moduleName,
      filename: moduleName + '.v',
      module: module,
      primitiveCount: instCount,
      inputs: graph.inputs.map(function (i2) { return inNames[i2]; }),
      outputs: graph.outputs.map(function (o) { return outNames[o.name]; }),
      note: 'Structural netlist of ' + instCount + ' primitive instances; synthesizable Verilog-2001'
    };
    if (opts.spec && opts.spec.expected) {
      result.testbench = structuralTestbench(moduleName, graph, inNames, outNames, opts.spec.expected);
      result.testbenchFilename = moduleName + '_tb.v';
    }
    return result;
  }

  /* Self-checking testbench for a structural module: exhaustive vectors,
     expected output per output name given as a minterm list. */
  function structuralTestbench(moduleName, graph, inNames, outNames, expected) {
    var tbName = moduleName + '_tb';
    var nIn = graph.inputs.length;
    if (nIn < 1) throw LabError('a self-checking testbench needs at least one input');
    var size = 1 << nIn;
    var used = new Set([moduleName, tbName]);
    Object.keys(inNames).forEach(function (k) { used.add(inNames[k]); });
    Object.keys(outNames).forEach(function (k) { used.add(outNames[k]); });
    var stim = uniqueId(used, 'stimulus'), errs = uniqueId(used, 'errors'), idx = uniqueId(used, 'i');
    var tb = [];
    tb.push('// LogicGate generated self-checking testbench (structural netlist)');
    tb.push('// Run with: iverilog -o ' + tbName + '.vvp ' + moduleName + '.v ' + tbName + '.v && vvp ' + tbName + '.vvp');
    tb.push('`timescale 1ns/1ps');
    tb.push('`default_nettype none');
    tb.push('module ' + tbName + ';');
    tb.push('    reg  [' + (nIn - 1) + ':0] ' + stim + ';');
    graph.outputs.forEach(function (o) { tb.push('    wire ' + outNames[o.name] + ';'); });
    tb.push('    integer ' + errs + ';');
    tb.push('    integer ' + idx + ';');
    tb.push('');
    var conns = graph.inputs.map(function (nm, i2) {
      return '        .' + inNames[nm] + '(' + stim + '[' + (nIn - 1 - i2) + '])';
    }).concat(graph.outputs.map(function (o) { return '        .' + outNames[o.name] + '(' + outNames[o.name] + ')'; }));
    tb.push('    ' + moduleName + ' dut (');
    tb.push(conns.join(',\n'));
    tb.push('    );');
    tb.push('');
    var outs = graph.outputs.map(function (o) {
      var mins = (expected[o.name] || []);
      return { wire: outNames[o.name], mins: mins };
    });
    tb.push('    initial begin');
    tb.push('        ' + errs + ' = 0;');
    tb.push('        for (' + idx + ' = 0; ' + idx + ' < ' + size + '; ' + idx + ' = ' + idx + ' + 1) begin');
    tb.push('            ' + stim + ' = ' + idx + '[' + (nIn - 1) + ':0];');
    tb.push('            #1;');
    outs.forEach(function (o) {
      var cond = o.mins.length
        ? '(' + o.mins.map(function (m) { return '(' + stim + ' == ' + nIn + "'d" + m + ')'; }).join(' || ') + ')'
        : "1'b0";
      tb.push('            if (' + o.wire + ' !== ' + cond + ') begin');
      tb.push('                $display("FAIL %0d ' + o.wire + ': got %b", ' + idx + ', ' + o.wire + ');');
      tb.push('                ' + errs + ' = ' + errs + ' + 1;');
      tb.push('            end');
    });
    tb.push('        end');
    tb.push('        if (' + errs + ' == 0) $display("ALL ' + size + ' VECTORS PASS");');
    tb.push('        else $display("%0d VECTORS FAILED", ' + errs + ');');
    tb.push('        $finish;');
    tb.push('    end');
    tb.push('endmodule');
    tb.push('`default_nettype wire');
    return tb.join('\n') + '\n';
  }

  /* ------------------------------------------------------------------ *
   * 7. Five benchmark circuits
   * ------------------------------------------------------------------ */

  function benchmarks() {
    var defs = [
      {
        id: 'fullAdder',
        label: 'Full adder (gate level)',
        summary: 'Two XOR gates for SUM; generate/propagate carry network for COUT. The carry path races the XOR chain.',
        inputs: ['A', 'B', 'CIN'],
        outputs: [{ node: 's', port: 'y', name: 'SUM' }, { node: 'cy', port: 'y', name: 'COUT' }],
        nodes: [
          { id: 'x1', type: 'XOR' }, { id: 's', type: 'XOR' },
          { id: 'a1', type: 'AND' }, { id: 'a2', type: 'AND' }, { id: 'cy', type: 'OR' }
        ],
        edges: [
          { from: 'IN:A', to: 'x1', toPort: 0 }, { from: 'IN:B', to: 'x1', toPort: 1 },
          { from: 'x1', fromPort: 'y', to: 's', toPort: 0 }, { from: 'IN:CIN', to: 's', toPort: 1 },
          { from: 'IN:A', to: 'a1', toPort: 0 }, { from: 'IN:B', to: 'a1', toPort: 1 },
          { from: 'x1', fromPort: 'y', to: 'a2', toPort: 0 }, { from: 'IN:CIN', to: 'a2', toPort: 1 },
          { from: 'a1', fromPort: 'y', to: 'cy', toPort: 0 }, { from: 'a2', fromPort: 'y', to: 'cy', toPort: 1 }
        ],
        expected: function (b) { var s = b[0] ^ b[1] ^ b[2]; return { SUM: s, COUT: (b[0] & b[1]) | (b[2] & (b[0] ^ b[1])) }; },
        defaultTransition: { input: 'CIN', vector: 3 }
      },
      {
        id: 'mux4to1',
        label: '4:1 multiplexer',
        summary: 'Select-decoded AND-OR tree: two NOT decoders, eight AND gates, three OR gates.',
        inputs: ['D0', 'D1', 'D2', 'D3', 'S0', 'S1'],
        outputs: [{ node: 'y', port: 'y', name: 'Y' }],
        nodes: [
          { id: 'ns0', type: 'NOT' }, { id: 'ns1', type: 'NOT' },
          { id: 'g0a', type: 'AND' }, { id: 'g0b', type: 'AND' },
          { id: 'g1a', type: 'AND' }, { id: 'g1b', type: 'AND' },
          { id: 'g2a', type: 'AND' }, { id: 'g2b', type: 'AND' },
          { id: 'g3a', type: 'AND' }, { id: 'g3b', type: 'AND' },
          { id: 'o01', type: 'OR' }, { id: 'o23', type: 'OR' }, { id: 'y', type: 'OR' }
        ],
        edges: (function () {
          var e = [
            { from: 'IN:S0', to: 'ns0', toPort: 0 }, { from: 'IN:S1', to: 'ns1', toPort: 0 }
          ];
          /* Term i = Di & (i<2 ? S1 : ~S1) & (i odd ? S0 : ~S0). */
          for (var i = 0; i < 4; i += 1) {
            e.push({ from: 'IN:D' + i, to: 'g' + i + 'a', toPort: 0 });
            e.push({ from: i < 2 ? 'ns1' : 'IN:S1', fromPort: 'y', to: 'g' + i + 'a', toPort: 1 });
            e.push({ from: 'g' + i + 'a', fromPort: 'y', to: 'g' + i + 'b', toPort: 0 });
            e.push({ from: (i % 2) ? 'IN:S0' : 'ns0', fromPort: 'y', to: 'g' + i + 'b', toPort: 1 });
          }
          e.push({ from: 'g0b', fromPort: 'y', to: 'o01', toPort: 0 });
          e.push({ from: 'g1b', fromPort: 'y', to: 'o01', toPort: 1 });
          e.push({ from: 'g2b', fromPort: 'y', to: 'o23', toPort: 0 });
          e.push({ from: 'g3b', fromPort: 'y', to: 'o23', toPort: 1 });
          e.push({ from: 'o01', fromPort: 'y', to: 'y', toPort: 0 });
          e.push({ from: 'o23', fromPort: 'y', to: 'y', toPort: 1 });
          return e;
        })(),
        expected: function (b) { return { Y: b[b[4] + 2 * b[5]] }; },
        defaultTransition: { input: 'S0', vector: 1 + (0 << 4) + (1 << 3) + (1 << 2) + (1 << 1) }
      },
      {
        id: 'comparator2',
        label: '2-bit magnitude comparator',
        summary: 'XNOR equality chain feeding AND-OR greater-than and less-than networks. Three outputs.',
        inputs: ['A1', 'A0', 'B1', 'B0'],
        outputs: [{ node: 'gt', port: 'y', name: 'GT' }, { node: 'eqg', port: 'y', name: 'EQ' }, { node: 'lt', port: 'y', name: 'LT' }],
        nodes: [
          { id: 'e1', type: 'XNOR' }, { id: 'e0', type: 'XNOR' },
          { id: 'nb1', type: 'NOT' }, { id: 'nb0', type: 'NOT' },
          { id: 'na1', type: 'NOT' }, { id: 'na0', type: 'NOT' },
          { id: 'g1', type: 'AND' }, { id: 'g2a', type: 'AND' }, { id: 'g2', type: 'AND' }, { id: 'gt', type: 'OR' },
          { id: 'eqg', type: 'AND' },
          { id: 'l1', type: 'AND' }, { id: 'l2a', type: 'AND' }, { id: 'l2', type: 'AND' }, { id: 'lt', type: 'OR' }
        ],
        edges: [
          { from: 'IN:A1', to: 'e1', toPort: 0 }, { from: 'IN:B1', to: 'e1', toPort: 1 },
          { from: 'IN:A0', to: 'e0', toPort: 0 }, { from: 'IN:B0', to: 'e0', toPort: 1 },
          { from: 'IN:B1', to: 'nb1', toPort: 0 }, { from: 'IN:B0', to: 'nb0', toPort: 0 },
          { from: 'IN:A1', to: 'na1', toPort: 0 }, { from: 'IN:A0', to: 'na0', toPort: 0 },
          { from: 'IN:A1', to: 'g1', toPort: 0 }, { from: 'nb1', fromPort: 'y', to: 'g1', toPort: 1 },
          { from: 'IN:A0', to: 'g2a', toPort: 0 }, { from: 'nb0', fromPort: 'y', to: 'g2a', toPort: 1 },
          { from: 'e1', fromPort: 'y', to: 'g2', toPort: 0 }, { from: 'g2a', fromPort: 'y', to: 'g2', toPort: 1 },
          { from: 'g1', fromPort: 'y', to: 'gt', toPort: 0 }, { from: 'g2', fromPort: 'y', to: 'gt', toPort: 1 },
          { from: 'e1', fromPort: 'y', to: 'eqg', toPort: 0 }, { from: 'e0', fromPort: 'y', to: 'eqg', toPort: 1 },
          { from: 'na1', fromPort: 'y', to: 'l1', toPort: 0 }, { from: 'IN:B1', to: 'l1', toPort: 1 },
          { from: 'na0', fromPort: 'y', to: 'l2a', toPort: 0 }, { from: 'IN:B0', to: 'l2a', toPort: 1 },
          { from: 'e1', fromPort: 'y', to: 'l2', toPort: 0 }, { from: 'l2a', fromPort: 'y', to: 'l2', toPort: 1 },
          { from: 'l1', fromPort: 'y', to: 'lt', toPort: 0 }, { from: 'l2', fromPort: 'y', to: 'lt', toPort: 1 }
        ],
        expected: function (b) {
          var a = b[0] * 2 + b[1], bb = b[2] * 2 + b[3];
          return { GT: a > bb ? 1 : 0, EQ: a === bb ? 1 : 0, LT: a < bb ? 1 : 0 };
        },
        defaultTransition: { input: 'A0', vector: 4 }
      },
      {
        id: 'parity4',
        label: '4-bit parity tree',
        summary: 'Balanced XOR tree: every input is exactly two gates from the output.',
        inputs: ['A0', 'A1', 'A2', 'A3'],
        outputs: [{ node: 'p', port: 'y', name: 'P' }],
        nodes: [
          { id: 'x01', type: 'XOR' }, { id: 'x23', type: 'XOR' }, { id: 'p', type: 'XOR' }
        ],
        edges: [
          { from: 'IN:A0', to: 'x01', toPort: 0 }, { from: 'IN:A1', to: 'x01', toPort: 1 },
          { from: 'IN:A2', to: 'x23', toPort: 0 }, { from: 'IN:A3', to: 'x23', toPort: 1 },
          { from: 'x01', fromPort: 'y', to: 'p', toPort: 0 }, { from: 'x23', fromPort: 'y', to: 'p', toPort: 1 }
        ],
        expected: function (b) { return { P: b[0] ^ b[1] ^ b[2] ^ b[3] }; },
        defaultTransition: { input: 'A0', vector: 0 }
      },
      {
        id: 'consensusDemo',
        label: 'Consensus-term hazard demo',
        summary: 'F = A&B | ~A&C misses the B&C consensus cube and glitches on the A transition; F_FIXED adds it and stays clean.',
        inputs: ['A', 'B', 'C'],
        outputs: [{ node: 'f', port: 'y', name: 'F' }, { node: 'ffix', port: 'y', name: 'F_FIXED' }],
        nodes: [
          { id: 'nA', type: 'NOT' },
          { id: 'g1', type: 'AND' }, { id: 'g2', type: 'AND' }, { id: 'f', type: 'OR' },
          { id: 'g3', type: 'AND' }, { id: 'fb', type: 'OR' }, { id: 'ffix', type: 'OR' }
        ],
        edges: [
          { from: 'IN:A', to: 'nA', toPort: 0 },
          { from: 'IN:A', to: 'g1', toPort: 0 }, { from: 'IN:B', to: 'g1', toPort: 1 },
          { from: 'nA', fromPort: 'y', to: 'g2', toPort: 0 }, { from: 'IN:C', to: 'g2', toPort: 1 },
          { from: 'g1', fromPort: 'y', to: 'f', toPort: 0 }, { from: 'g2', fromPort: 'y', to: 'f', toPort: 1 },
          { from: 'IN:B', to: 'g3', toPort: 0 }, { from: 'IN:C', to: 'g3', toPort: 1 },
          { from: 'g1', fromPort: 'y', to: 'fb', toPort: 0 }, { from: 'g2', fromPort: 'y', to: 'fb', toPort: 1 },
          { from: 'fb', fromPort: 'y', to: 'ffix', toPort: 0 }, { from: 'g3', fromPort: 'y', to: 'ffix', toPort: 1 }
        ],
        expected: function (b) {
          var f = (b[0] & b[1]) | ((1 - b[0]) & b[2]);
          return { F: f, F_FIXED: f | (b[1] & b[2]) };
        },
        defaultTransition: { input: 'A', vector: 7 }
      }
    ];
    return defs.map(function (d) {
      var nIn = d.inputs.length;
      var truth = {};
      var spec = {};
      for (var v = 0; v < (1 << nIn); v += 1) {
        var bits = [];
        for (var i = 0; i < nIn; i += 1) bits.push((v >> (nIn - 1 - i)) & 1);
        var outs = d.expected(bits);
        Object.keys(outs).forEach(function (k) {
          if (!truth[k]) truth[k] = [];
          truth[k].push(outs[k]);
        });
      }
      Object.keys(truth).forEach(function (k) {
        spec[k] = { minterms: truth[k].map(function (val, i2) { return val ? i2 : -1; }).filter(function (i2) { return i2 >= 0; }) };
      });
      return {
        id: d.id,
        label: d.label,
        summary: d.summary,
        inputs: d.inputs,
        numVars: nIn,
        netlist: { inputs: d.inputs, outputs: d.outputs, nodes: d.nodes, edges: d.edges },
        truth: truth,
        spec: spec,
        outputNames: d.outputs.map(function (o) { return o.name; }),
        defaultTransition: d.defaultTransition
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * 8. FIPS 180-4 SHA-256 (pure JS, unkeyed digest)
   * ------------------------------------------------------------------ */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(text) {
    var s = unescape(encodeURIComponent(String(text)));
    var out = new Array(s.length);
    for (var i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
    return out;
  }

  /* SHA-256 over UTF-8 text, returned as lowercase hex. Unkeyed: suitable as
     a tamper-detection digest, never as a signature or password hash. */
  function sha256(text) {
    var bytes = typeof text === 'string' ? utf8Bytes(text) : Array.prototype.slice.call(text);
    var bitLen = bytes.length * 8;
    var padded = bytes.slice();
    padded.push(0x80);
    while (padded.length % 64 !== 56) padded.push(0);
    for (var i = 7; i >= 0; i -= 1) padded.push((bitLen / Math.pow(2, i * 8)) >>> 0 & 0xff || 0);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var block = 0; block < padded.length; block += 64) {
      for (var t = 0; t < 16; t += 1) {
        w[t] = ((padded[block + t * 4] << 24) | (padded[block + t * 4 + 1] << 16) | (padded[block + t * 4 + 2] << 8) | padded[block + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t += 1) {
        var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        var s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t += 1) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    return h.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  /* ------------------------------------------------------------------ *
   * 9. Report builders, CSV safety, canonical digest
   * ------------------------------------------------------------------ */

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + stableStringify(value[k]); }).join(',') + '}';
  }

  /* Spreadsheet-formula guard plus standard quoting: any field that could be
     reinterpreted as a formula gets a leading apostrophe; quoting follows
     RFC 4180 (double the inner quotes, wrap on comma/quote/newline). */
  function csvField(value) {
    var numeric = typeof value === 'number' && Number.isFinite(value);
    var s = value == null ? '' : String(value);
    if (!numeric && /^[\s\p{Cf}\p{Cc}]*[=+\-@\t\r]/u.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvRows(rows) {
    return rows.map(function (r) { return r.map(csvField).join(','); }).join('\r\n') + '\r\n';
  }

  /* Assemble a verification payload from lab results. `checkRows` is a list
     of {check, result, detail} rows describing what was verified. */
  function buildReport(options) {
    var opts = options || {};
    var payload = {
      format: 'logicgate-verification-report',
      version: 1,
      tool: 'LogicGate ' + (LG && LG.version ? LG.version : 'unknown') + ' / LogicLab ' + VERSION,
      circuit: opts.circuit || null,
      generated: opts.generated || 'offline-session',
      delayModel: 'Nominal per-gate delays in ns (illustrative); not a device measurement',
      digestNote: 'Unkeyed SHA-256 integrity digest over the canonical payload: detects local edits and corruption; it is not a signature',
      checks: (opts.checks || []).map(function (c) {
        return { check: String(c.check), result: c.result ? 'pass' : 'fail', detail: c.detail == null ? '' : String(c.detail) };
      })
    };
    var canonical = stableStringify(payload);
    return {
      payload: payload,
      canonical: canonical,
      sha256: sha256(canonical)
    };
  }

  function exportReportJSON(report) {
    return JSON.stringify({ report: report.payload, sha256: report.sha256 }, null, 2) + '\n';
  }

  /* Recompute the digest of a previously exported report. A mutated payload
     fails verification honestly rather than silently passing. */
  function verifyReport(exported) {
    var obj = typeof exported === 'string' ? JSON.parse(exported) : exported;
    if (!obj || typeof obj !== 'object' || !obj.report || typeof obj.sha256 !== 'string') {
      throw LabError('report must be an object with report and sha256 fields');
    }
    if (!/^[0-9a-f]{64}$/.test(obj.sha256)) throw LabError('report digest is not a 64-hex SHA-256');
    var actual = sha256(stableStringify(obj.report));
    return {
      pass: actual === obj.sha256,
      expected: obj.sha256,
      actual: actual,
      note: 'Unkeyed digest check: proves the payload was not altered after export, not that a trusted party signed it'
    };
  }

  function reportCSV(report) {
    var rows = [['section', 'key', 'value']];
    var p = report.payload || report;
    rows.push(['meta', 'format', p.format]);
    rows.push(['meta', 'tool', p.tool]);
    if (p.circuit) {
      rows.push(['circuit', 'id', p.circuit.id]);
      rows.push(['circuit', 'label', p.circuit.label]);
      rows.push(['circuit', 'inputs', (p.circuit.inputs || []).join(' ')]);
    }
    (p.checks || []).forEach(function (c, i) {
      rows.push(['check ' + i, c.check, c.result.toUpperCase()]);
      if (c.detail) rows.push(['check ' + i, 'detail', c.detail]);
    });
    rows.push(['meta', 'sha256', report.sha256 || (p.sha256 || '')]);
    return csvRows(rows);
  }

  function reportMarkdown(report) {
    var p = report.payload || report;
    var lines = [];
    lines.push('# LogicGate verification report');
    lines.push('');
    lines.push('- Tool: ' + p.tool);
    if (p.circuit) lines.push('- Circuit: ' + p.circuit.label + ' (' + (p.circuit.inputs || []).join(', ') + ')');
    lines.push('- Delay model: ' + p.delayModel);
    lines.push('');
    lines.push('| Check | Result | Detail |');
    lines.push('| --- | --- | --- |');
    (p.checks || []).forEach(function (c) {
      lines.push('| ' + c.check + ' | ' + c.result.toUpperCase() + ' | ' + String(c.detail).replace(/\|/g, '\\|') + ' |');
    });
    lines.push('');
    lines.push('SHA-256 (unkeyed tamper-detection digest): `' + (report.sha256 || '') + '`');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * 10. Strict URL bookmark codec (#lg=)
   * ------------------------------------------------------------------ */

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64urlEncode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
    }
    return out.replace(/\+/g, '-').replace(/\//g, '_');
  }
  function b64urlDecode(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) throw LabError('bookmark payload is not base64url');
    var clean = text.replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4) clean += '=';
    var bytes = [];
    var buf = 0, bits = 0;
    for (var i = 0; i < clean.length; i += 1) {
      var ch = clean.charAt(i);
      if (ch === '=') break;
      var v = B64.indexOf(ch);
      if (v < 0) throw LabError('bookmark payload is not base64url');
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
    }
    return bytes;
  }

  function bytesToUtf8(bytes) {
    var s = '';
    bytes.forEach(function (b) { s += String.fromCharCode(b); });
    try { return decodeURIComponent(escape(s)); } catch (e) { throw LabError('bookmark payload is not valid UTF-8'); }
  }

  function encodeBookmark(state) {
    if (!state || typeof state !== 'object') throw LabError('bookmark state is required');
    var payload = {
      v: 1,
      numVars: state.numVars,
      vars: state.vars,
      minterms: state.minterms || [],
      dontCares: state.dontCares || [],
      form: state.form === 'POS' ? 'POS' : 'SOP',
      moduleName: state.moduleName || 'logicgate_module',
      bench: state.bench || null,
      transition: state.transition || null
    };
    var json = JSON.stringify(payload);
    if (json.length > MAX_BOOKMARK_LEN) throw LabError('bookmark exceeds ' + MAX_BOOKMARK_LEN + ' characters');
    return '#lg=' + b64urlEncode(utf8Bytes(json));
  }

  /* Strict decode: versioned JSON in base64url, every field type-checked.
     Malformed links fail loudly instead of producing a half-applied spec. */
  function decodeBookmark(hash) {
    if (typeof hash !== 'string' || hash.indexOf('#lg=') !== 0) throw LabError('bookmark must start with #lg=');
    var body = hash.slice(4);
    if (!body.length || body.length > MAX_BOOKMARK_LEN * 2) throw LabError('bookmark length out of range');
    var obj;
    try { obj = JSON.parse(bytesToUtf8(b64urlDecode(body))); }
    catch (e) { throw LabError(e && e.name === 'LogicLabError' ? e.message : 'bookmark payload is not valid JSON'); }
    if (!obj || obj.v !== 1) throw LabError('unsupported bookmark version');
    var n = obj.numVars;
    if (!Number.isInteger(n) || n < 2 || n > 4) throw LabError('bookmark numVars must be 2..4');
    var vars = obj.vars;
    if (!Array.isArray(vars) || vars.length !== n || vars.some(function (x) { return typeof x !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(x); })) {
      throw LabError('bookmark vars must be ' + n + ' identifiers');
    }
    var limit = 1 << n;
    function intList(value, label) {
      if (!Array.isArray(value)) throw LabError('bookmark ' + label + ' must be an array');
      return value.map(function (x) {
        if (!Number.isInteger(x) || x < 0 || x >= limit) throw LabError('bookmark ' + label + ' entry out of range');
        return x;
      });
    }
    var minterms = intList(obj.minterms || [], 'minterms');
    var dontCares = intList(obj.dontCares || [], 'dontCares');
    var dc = new Set(dontCares);
    if (minterms.some(function (m) { return dc.has(m); })) throw LabError('bookmark minterms overlap don\'t cares');
    return {
      numVars: n,
      vars: vars.slice(),
      minterms: minterms,
      dontCares: dontCares,
      form: obj.form === 'POS' ? 'POS' : 'SOP',
      moduleName: typeof obj.moduleName === 'string' ? obj.moduleName : 'logicgate_module',
      bench: typeof obj.bench === 'string' ? obj.bench : null,
      transition: obj.transition && typeof obj.transition === 'object'
        ? { input: typeof obj.transition.input === 'string' ? obj.transition.input : null, vector: Number.isInteger(obj.transition.vector) ? obj.transition.vector : null }
        : null
    };
  }

  /* ------------------------------------------------------------------ *
   * 11. Benchmark analysis bundle + in-page self tests
   * ------------------------------------------------------------------ */

  /* One call that runs the whole lab over a benchmark circuit: equivalence of
     every output against its spec, the critical path, the full hazard scan. */
  function analyzeBenchmark(bench, options) {
    var eq = {};
    bench.outputNames.forEach(function (name) {
      eq[name] = equivalenceCheck(
        { netlist: bench.netlist },
        { numVars: bench.numVars, vars: bench.inputs, minterms: bench.spec[name].minterms, outputName: name }
      );
    });
    var pass = Object.keys(eq).every(function (k) { return eq[k].pass; });
    return {
      bench: bench,
      equivalence: eq,
      equivalent: pass,
      timing: criticalPath(bench.netlist, options),
      hazards: detectHazards(bench.netlist, options)
    };
  }

  /* The same self-checks the Run Self-Tests panel executes. Every check names
     what it proves and reports pass/fail honestly. */
  function runSelfTests() {
    var results = [];
    function check(id, name, category, fn) {
      try {
        var detail = fn();
        results.push({ id: id, name: name, category: category, pass: true, detail: detail || '' });
      } catch (err) {
        results.push({ id: id, name: name, category: category, pass: false, detail: err && err.message ? err.message : String(err) });
      }
    }
    function expect(cond, msg) { if (!cond) throw new Error(msg); }

    check('sha-empty', 'SHA-256 empty-message KAT', 'digest', function () {
      var d = sha256('');
      expect(d === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'got ' + d);
      return 'e3b0c442...b855 matches FIPS 180-4';
    });
    check('sha-abc', 'SHA-256 "abc" KAT', 'digest', function () {
      var d = sha256('abc');
      expect(d === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'got ' + d);
      return 'ba7816bf...15ad matches FIPS 180-4';
    });
    check('sha-56', 'SHA-256 56-byte multi-block KAT', 'digest', function () {
      var d = sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
      expect(d === '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', 'got ' + d);
      return '248d6a61...06c1 matches FIPS 180-4';
    });
    check('demorgan-1', 'De Morgan ~(A&B) == ~A|~B on all 4 vectors', 'equivalence', function () {
      var r = equivalenceCheck({ expr: '!(A & B)' }, { expr: '!A | !B' });
      expect(r.pass && r.checked === 4, 'mismatch on ' + r.mismatchCount + ' vectors');
      return '4/4 vectors equal';
    });
    check('demorgan-2', 'De Morgan ~(A|B) == ~A&~B on all 4 vectors', 'equivalence', function () {
      var r = equivalenceCheck({ expr: '!(A | B)' }, { expr: '!A & !B' });
      expect(r.pass && r.checked === 4, 'mismatch on ' + r.mismatchCount + ' vectors');
      return '4/4 vectors equal';
    });
    check('xor-expand', 'XOR equals its AND-OR-NOT expansion on all 4 vectors', 'equivalence', function () {
      var r = equivalenceCheck({ expr: 'A ^ B' }, { expr: '(!A & B) | (A & !B)' });
      expect(r.pass && r.checked === 4, 'mismatch on ' + r.mismatchCount + ' vectors');
      return '4/4 vectors equal';
    });
    check('nand-universal', 'NAND-only network equals A^B (universal gate proof)', 'equivalence', function () {
      var nandXor = {
        inputs: ['A', 'B'],
        outputs: [{ node: 'y', port: 'y', name: 'Y' }],
        nodes: [
          { id: 'n0', type: 'NAND' }, { id: 'n1', type: 'NAND' }, { id: 'n2', type: 'NAND' }, { id: 'y', type: 'NAND' }
        ],
        edges: [
          { from: 'IN:A', to: 'n0', toPort: 0 }, { from: 'IN:B', to: 'n0', toPort: 1 },
          { from: 'IN:A', to: 'n1', toPort: 0 }, { from: 'n0', fromPort: 'y', to: 'n1', toPort: 1 },
          { from: 'n0', fromPort: 'y', to: 'n2', toPort: 0 }, { from: 'IN:B', to: 'n2', toPort: 1 },
          { from: 'n1', fromPort: 'y', to: 'y', toPort: 0 }, { from: 'n2', fromPort: 'y', to: 'y', toPort: 1 }
        ]
      };
      var r = equivalenceCheck({ netlist: nandXor }, { expr: 'A ^ B', outputName: 'Y' });
      expect(r.pass, 'NAND network mismatches XOR');
      return '4 NAND gates reproduce XOR on 4/4 vectors';
    });
    check('qm-exhaustive-3v', 'Quine-McCluskey SOP matches all 256 three-variable functions', 'minimization', function () {
      for (var fn = 0; fn < 256; fn += 1) {
        var mins = [];
        for (var m = 0; m < 8; m += 1) if ((fn >> m) & 1) mins.push(m);
        var r = minimizeSOP(3, mins, []);
        expect(r.matchesAllCareStates, 'function ' + fn + ' SOP diverged');
      }
      return '256/256 functions verified on every minterm';
    });
    check('qm-sample-4v', 'Quine-McCluskey SOP matches a deterministic 4-variable sample', 'minimization', function () {
      var tested = 0;
      for (var fn = 0; fn < 65536; fn += 251) {
        var mins = [];
        for (var m = 0; m < 16; m += 1) if ((fn >> m) & 1) mins.push(m);
        var r = minimizeSOP(4, mins, []);
        expect(r.matchesAllCareStates, 'function ' + fn + ' SOP diverged');
        tested += 1;
      }
      return tested + ' strided 4-variable functions verified on every minterm';
    });
    check('cp-bound', 'Critical path is at least the largest single gate delay', 'timing', function () {
      var bench = benchmarks().filter(function (b) { return b.id === 'parity4'; })[0];
      var cp = criticalPath(bench.netlist);
      expect(cp.delayNs >= 4, 'delay below single XOR gate');
      expect(cp.fMaxMHz === 1000 / cp.delayNs, 'f_max formula inconsistent');
      return 't_pd = ' + cp.delayNs + ' ns, f_max = ' + cp.fMaxMHz + ' MHz';
    });
    check('cp-consistency', 'Critical path delay equals the summed delays along its path', 'timing', function () {
      var bench = benchmarks().filter(function (b) { return b.id === 'fullAdder'; })[0];
      var cp = criticalPath(bench.netlist);
      var graph = buildNetlist(bench.netlist);
      var sum = 0;
      cp.path.forEach(function (sig) {
        var cut = sig.split(':');
        var node = graph.byName.get(sig.slice(0, sig.lastIndexOf(':')));
        if (node && !node.virtual) sum += gateDelay(node, sig.slice(sig.lastIndexOf(':') + 1), null);
      });
      expect(sum === cp.delayNs, 'path sum ' + sum + ' != ' + cp.delayNs);
      return 'path of ' + cp.path.length + ' signals sums to ' + cp.delayNs + ' ns';
    });
    check('hazard-consensus', 'Consensus demo: hazard present on F, absent on F_FIXED', 'hazards', function () {
      var bench = benchmarks().filter(function (b) { return b.id === 'consensusDemo'; })[0];
      var scan = detectHazards(bench.netlist);
      var onF = scan.hazards.filter(function (h) { return h.output === 'F'; });
      var onFix = scan.hazards.filter(function (h) { return h.output === 'F_FIXED'; });
      expect(onF.length > 0, 'expected a static hazard on F');
      expect(onFix.length === 0, 'consensus cover should be hazard free');
      var h = onF[0];
      return 'static-1 glitch on F during A:' + h.fromVector + '->' + h.toVector + ' at t=' + h.glitchStartNs + ' ns; F_FIXED clean on ' + scan.checkedTransitions + ' transitions';
    });
    check('csv-injection', 'CSV export escapes formula-leading characters', 'reports', function () {
      var f = csvField('=2+3');
      expect(f === "'=2+3", 'formula cell not guarded');
      expect(csvField('a,b') === '"a,b"', 'comma not quoted');
      expect(csvField('say "hi"') === '"say ""hi"""', 'quote not doubled');
      return 'formula, comma and quote cases escaped';
    });
    check('tamper', 'Report digest catches a tampered payload', 'reports', function () {
      var report = buildReport({ circuit: { id: 'x', label: 'tamper test', inputs: ['A'] }, checks: [{ check: 'c', result: true, detail: 'd' }] });
      var json = exportReportJSON(report);
      expect(verifyReport(json).pass, 'clean report failed verification');
      var tampered = JSON.parse(json);
      tampered.report.checks[0].result = 'fail';
      var v = verifyReport(tampered);
      expect(!v.pass, 'tampered report still verified');
      return 'digest ' + report.sha256.slice(0, 12) + '... verified, mutation rejected';
    });
    check('bookmark-roundtrip', 'Bookmark encodes and strictly decodes', 'bookmarks', function () {
      var st = { numVars: 3, vars: ['A', 'B', 'C'], minterms: [1, 3, 6, 7], dontCares: [], form: 'SOP', moduleName: 'm', bench: 'consensusDemo' };
      var back = decodeBookmark(encodeBookmark(st));
      expect(back.numVars === 3 && back.minterms.join(',') === '1,3,6,7' && back.bench === 'consensusDemo', 'round trip drifted');
      var rejected = 0;
      ['#lg=%%%', '#lg=AAAA', '#xx=' + encodeBookmark(st).slice(4)].forEach(function (h) {
        try { decodeBookmark(h); } catch (e) { rejected += 1; }
      });
      expect(rejected === 3, 'malformed bookmark accepted');
      return 'round trip clean; 3 malformed forms rejected';
    });
    check('equiv-detects-mismatch', 'Equivalence checker reports a real mismatch', 'equivalence', function () {
      var r = equivalenceCheck({ expr: 'A & B' }, { expr: 'A | B' });
      expect(!r.pass && r.mismatchCount === 2, 'expected 2 mismatches, got ' + r.mismatchCount);
      return 'mismatches at vectors ' + r.mismatches.map(function (m) { return m.vector; }).join(' and ');
    });
    var pass = results.filter(function (r) { return r.pass; }).length;
    return { pass: pass === results.length, total: results.length, passed: pass, failed: results.length - pass, results: results };
  }

  return {
    version: VERSION,
    GATE_DELAYS: DEFAULT_DELAYS,
    MAX_EQ_VARS: MAX_EQ_VARS,
    buildNetlist: buildNetlist,
    evalSteady: evalSteady,
    criticalPath: criticalPath,
    transitionSim: transitionSim,
    detectHazards: detectHazards,
    equivalenceCheck: equivalenceCheck,
    minimizeSOP: minimizeSOP,
    exportStructuralVerilog: exportStructuralVerilog,
    benchmarks: benchmarks,
    analyzeBenchmark: analyzeBenchmark,
    sha256: sha256,
    stableStringify: stableStringify,
    csvField: csvField,
    csvRows: csvRows,
    buildReport: buildReport,
    exportReportJSON: exportReportJSON,
    verifyReport: verifyReport,
    reportCSV: reportCSV,
    reportMarkdown: reportMarkdown,
    encodeBookmark: encodeBookmark,
    decodeBookmark: decodeBookmark,
    runSelfTests: runSelfTests,
    LabError: LabError
  };
});
