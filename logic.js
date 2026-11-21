/* LogicGate core engine. Zero dependencies. UMD: CommonJS, AMD, and browser global. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.LogicGate = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_VARS = 16;
  var MAX_PRIME_COMPARISONS = 2000000;
  var MAX_COVER_STATES = 200000;
  var MAX_PARSE_DEPTH = 600;
  var DEFAULT_VAR_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];

  function LogicError(message) {
    var err = new Error(message);
    err.name = 'LogicError';
    return err;
  }

  function normalizeVars(vars) {
    if (vars == null) return DEFAULT_VAR_NAMES.slice(0, 2);
    if (!Array.isArray(vars)) throw LogicError('vars must be an array of names');
    if (vars.length < 1 || vars.length > MAX_VARS) throw LogicError('variable count must be between 1 and ' + MAX_VARS);
    var seen = Object.create(null);
    var out = vars.map(function (v, i) {
      if (typeof v !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
        throw LogicError('invalid variable name at index ' + i + ': ' + String(v));
      }
      if (seen[keyOf(v)]) throw LogicError('duplicate variable name: ' + v);
      if (/^(AND|OR|XOR|NAND|NOR|XNOR|NOT|TRUE|FALSE|ONE|ZERO|HIGH|LOW)$/i.test(v)) {
        throw LogicError('reserved Boolean word cannot be a variable: ' + v);
      }
      seen[keyOf(v)] = true;
      return v;
    });
    return out;
  }

  function resolveVarNames(numVars, vars) {
    if (!Number.isInteger(numVars) || numVars < 1 || numVars > MAX_VARS) {
      throw LogicError('numVars must be an integer between 1 and ' + MAX_VARS);
    }
    if (vars != null) {
      var names = normalizeVars(vars);
      if (names.length !== numVars) throw LogicError('numVars must equal vars.length');
      return names;
    }
    return DEFAULT_VAR_NAMES.slice(0, numVars);
  }

  function keyOf(name) { return name.toUpperCase(); }

  /* ------------------------------------------------------------------ *
   * 1. Boolean expression parser and evaluator
   * ------------------------------------------------------------------ */

  var WORD_TOKENS = Object.create(null);
  WORD_TOKENS.AND = { t: 'op', v: '&' };
  WORD_TOKENS.OR = { t: 'op', v: '|' };
  WORD_TOKENS.XOR = { t: 'op', v: '^' };
  WORD_TOKENS.NAND = { t: 'op', v: '&', negated: true };
  WORD_TOKENS.NOR = { t: 'op', v: '|', negated: true };
  WORD_TOKENS.XNOR = { t: 'op', v: '^', negated: true };
  WORD_TOKENS.NOT = { t: 'not', v: '!' };

  var SYMBOL_OPS = {
    '&': '&', '*': '&', '.': '&', '&&': '&',
    '|': '|', '+': '|', '||': '|',
    '^': '^', '~&': '~&', '~|': '~|', '~^': '~^'
  };

  function tokenize(source, names) {
    if (typeof source !== 'string') throw LogicError('expression must be a string');
    var tokens = [];
    var i = 0;
    while (i < source.length) {
      var ch = source[i];
      if (/\s/.test(ch)) { i += 1; continue; }
      if (ch === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i += 1;
        continue;
      }
      if (ch === '/' && source[i + 1] === '*') {
        var end = source.indexOf('*/', i + 2);
        if (end < 0) throw LogicError('unterminated block comment');
        i = end + 2;
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        var j = i + 1;
        while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
        var word = source.slice(i, j);
        var upper = keyOf(word);
        if (WORD_TOKENS[upper]) {
          var wt = WORD_TOKENS[upper];
          tokens.push(wt.negated ? { t: 'not_op', v: wt.v } : wt);
        }
        else if (upper === 'TRUE' || upper === 'ONE' || upper === 'HIGH') tokens.push({ t: 'const', v: 1 });
        else if (upper === 'FALSE' || upper === 'ZERO' || upper === 'LOW') tokens.push({ t: 'const', v: 0 });
        else if (names && !names.some(function (n) { return keyOf(n) === upper; })) {
          /* Resolve a case insensitive match, or split into single letter variables. */
          var exact = null;
          for (var q = 0; q < names.length; q += 1) {
            if (keyOf(names[q]) === upper) { exact = names[q]; break; }
          }
          if (exact) tokens.push({ t: 'var', v: exact });
          else {
            var split = true;
            for (var k = 0; k < word.length; k += 1) {
              var letter = word[k];
              var match = false;
              for (var q2 = 0; q2 < names.length; q2 += 1) {
                if (names[q2].length === 1 && keyOf(names[q2]) === keyOf(letter)) { match = true; break; }
              }
              if (!match) { split = false; break; }
            }
            if (split) for (var w = 0; w < word.length; w += 1) tokens.push({ t: 'var', v: word[w] });
            else tokens.push({ t: 'var', v: word });
          }
        }
        else tokens.push({ t: 'var', v: word });
        i = j;
        continue;
      }
      if (/[01xX]/.test(ch) && !/[A-Za-z0-9_]/.test(source[i - 1] || '')) {
        if (ch === '1' || ch === '0') tokens.push({ t: 'const', v: Number(ch) });
        else tokens.push({ t: 'const', v: 0 });
        i += 1;
        continue;
      }
      var two = source.slice(i, i + 2);
      if (SYMBOL_OPS[two]) {
        tokens.push({ t: 'op', v: SYMBOL_OPS[two] });
        i += 2;
        continue;
      }
      if (ch === '(' || ch === ')') {
        tokens.push({ t: ch === '(' ? 'lp' : 'rp', v: ch });
        i += 1;
        continue;
      }
      if (ch === '!' || ch === '~' || ch === "'") {
        tokens.push({ t: ch === "'" ? 'postfix' : 'not', v: '!' });
        i += 1;
        continue;
      }
      if (SYMBOL_OPS[ch]) {
        tokens.push({ t: 'op', v: SYMBOL_OPS[ch] });
        i += 1;
        continue;
      }
      throw LogicError('unexpected character "' + ch + '" at position ' + i);
    }
    return tokens;
  }

  var BINARY_PRECEDENCE = { '~&': 4, '~|': 2, '~^': 3, '&': 4, '^': 3, '|': 2 };

  /* Parse with implicit AND for adjacent primaries. Returns an AST. */
  function parseExpr(source, vars) {
    if (typeof source !== 'string' || source.length > 16384) throw LogicError('expression must be a string of at most 16384 characters');
    var names = vars == null ? null : normalizeVars(vars);
    var tokens = tokenize(source, names);
    var pos = 0;
    var depth = 0;

    function peek() { return tokens[pos]; }
    function take() { var t = tokens[pos]; pos += 1; return t; }
    function descend() {
      if (++depth > MAX_PARSE_DEPTH) throw LogicError('expression nesting exceeds ' + MAX_PARSE_DEPTH + ' levels');
    }
    function isPrimaryStart(t) { return !!t && (t.t === 'var' || t.t === 'const' || t.t === 'not' || t.t === 'lp'); }
    function isBinary(t) { return t && (t.t === 'op' || t.t === 'not_op'); }

    function parsePrimary() {
      var t = take();
      if (!t) throw LogicError('unexpected end of expression');
      if (t.t === 'not') {
        return { type: 'NOT', args: [parsePrimary()] };
      }
      if (t.t === 'lp') {
        var inner = parseOr(0);
        var close = take();
        if (!close || close.t !== 'rp') throw LogicError('missing closing parenthesis');
        return inner;
      }
      if (t.t === 'const') return { type: 'CONST', value: t.v };
      if (t.t === 'var') {
        var name = t.v;
        if (names) {
          var found = null;
          for (var k = 0; k < names.length; k += 1) {
            if (keyOf(names[k]) === keyOf(name)) { found = names[k]; break; }
          }
          if (!found) throw LogicError('unknown variable "' + name + '"');
          return { type: 'VAR', name: found, index: k };
        }
        return { type: 'VAR', name: name, index: null };
      }
      throw LogicError('expected a value, got "' + t.v + '"');
    }

    function makeBinary(rawOp, left, right, wordNegated) {
      var negated = !!wordNegated || rawOp.charAt(0) === '~';
      var base = rawOp.charAt(0) === '~' ? rawOp.slice(1) : rawOp;
      var type = base === '&' ? 'AND' : base === '|' ? 'OR' : 'XOR';
      return { type: type, args: [left, right], op: base, negated: negated };
    }

    function parseOr(minPrec) {
      descend();
      var left = parseUnary();
      for (;;) {
        var t = peek();
        if (isBinary(t)) {
          var prec = BINARY_PRECEDENCE[t.v] || 2;
          if (prec < minPrec) break;
          take();
          var right = parseOr(prec + 1);
          left = makeBinary(t.v, left, right, t.t === 'not_op');
          continue;
        }
        /* implicit AND: a following primary binds tighter than any explicit operator */
        if (minPrec <= BINARY_PRECEDENCE['&'] && isPrimaryStart(t)) {
          left = makeBinary('&', left, parseUnary());
          continue;
        }
        break;
      }
      depth -= 1;
      return left;
    }

    function parseUnary() {
      /* A prime is postfix; !, ~ and NOT begin the next primary. Complement
         runs nest one AST level each, so they share the parse depth budget
         (evaluate/collectVars recurse over them). */
      var prefix = 0;
      while (peek() && peek().t === 'not') { take(); prefix += 1; }
      var node = peek() && peek().t === 'lp' ? parseGroup() : parsePrimary();
      var flips = prefix;
      while (peek() && peek().t === 'postfix') { take(); flips += 1; }
      if (flips > MAX_PARSE_DEPTH) throw LogicError('complement chain exceeds ' + MAX_PARSE_DEPTH + ' levels');
      for (var i = 0; i < flips; i += 1) node = { type: 'NOT', args: [node] };
      return node;
    }

    function parseGroup() {
      take();
      var inner = parseOr(0);
      var close = take();
      if (!close || close.t !== 'rp') throw LogicError('missing closing parenthesis');
      return inner;
    }

    if (tokens.length === 0) throw LogicError('empty expression');
    var tree = parseOr(0);
    if (pos !== tokens.length) throw LogicError('unexpected trailing token "' + tokens[pos].v + '"');

    var used = collectVars(tree);
    var varNames;
    if (names) {
      varNames = names.slice();
    } else {
      varNames = used.slice();
      varNames.sort(function (a, b) {
        var aIndex = DEFAULT_VAR_NAMES.indexOf(keyOf(a));
        var bIndex = DEFAULT_VAR_NAMES.indexOf(keyOf(b));
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;
        return a.localeCompare(b);
      });
    }
    reindex(tree, varNames);
    if (varNames.length > MAX_VARS) throw LogicError('expression exceeds ' + MAX_VARS + ' variables');
    return {
      ast: tree,
      vars: varNames,
      source: source,
      evaluate: function (values) { return evaluateAst(tree, values, varNames); },
      toString: function () { return astToText(tree); }
    };
  }

  function collectVars(node, acc) {
    acc = acc || [];
    if (!node || typeof node !== 'object') return acc;
    if (node.type === 'VAR') {
      if (!acc.some(function (name) { return keyOf(name) === keyOf(node.name); })) acc.push(node.name);
      return acc;
    }
    (node.args || []).forEach(function (a) { collectVars(a, acc); });
    return acc;
  }

  function reindex(node, names) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VAR') {
      for (var i = 0; i < names.length; i += 1) {
        if (keyOf(names[i]) === keyOf(node.name)) { node.index = i; node.name = names[i]; return; }
      }
    }
    (node.args || []).forEach(function (a) { reindex(a, names); });
  }

  function evaluateAst(node, values, names) {
    function value(i, name) {
      var v;
      if (Array.isArray(values) || (values && typeof values.length === 'number')) v = values[i];
      else if (values && typeof values === 'object') v = values[name] != null ? values[name] : values[keyOf(name)];
      else v = 0;
      if (v === true) return 1;
      if (v === false) return 0;
      if (v === 'x' || v === 'X' || v == null) return 0;
      var n = Number(v);
      return n ? 1 : 0;
    }
    switch (node.type) {
      case 'CONST': return node.value ? 1 : 0;
      case 'VAR': return value(node.index, node.name);
      case 'NOT': return 1 - evaluateAst(node.args[0], values, names);
      case 'AND': {
        var a = evaluateAst(node.args[0], values, names) & evaluateAst(node.args[1], values, names);
        return node.negated ? 1 - a : a;
      }
      case 'OR': {
        var o = evaluateAst(node.args[0], values, names) | evaluateAst(node.args[1], values, names);
        return node.negated ? 1 - o : o;
      }
      case 'XOR': {
        var x = evaluateAst(node.args[0], values, names) ^ evaluateAst(node.args[1], values, names);
        return node.negated ? 1 - x : x;
      }
      default: throw LogicError('unknown AST node ' + node.type);
    }
  }

  function astToText(node) {
    var prec = { OR: 1, XOR: 2, AND: 3, NOT: 4, VAR: 5, CONST: 5 };
    var symbol = { '&': ' & ', '|': ' | ', '^': ' ^ ', '~&': ' ~& ', '~|': ' ~| ', '~^': ' ~^ ' };
    function walk(n, parentPrec) {
      if (n.type === 'CONST') return String(n.value);
      if (n.type === 'VAR') return n.name;
      if (n.type === 'NOT') {
        var inner = walk(n.args[0], prec.NOT);
        return '!(' + inner + ')';
      }
      if (n.negated) return '!( ' + walk(n.args[0], prec[n.type]) + symbol[n.op] + walk(n.args[1], prec[n.type]) + ' )';
      var text = walk(n.args[0], prec[n.type]) + symbol[n.op] + walk(n.args[1], prec[n.type]);
      return prec[n.type] < parentPrec ? '(' + text + ')' : text;
    }
    return walk(node, 0);
  }

  /* Truth table from an expression. Accepts parsed AST or source string. */
  function evalTruthTable(expr, vars) {
    var parsed = isParsed(expr) ? expr : parseExpr(expr, vars);
    var names = parsed.vars;
    var rows = 1 << names.length;
    var table = [];
    var minterms = [];
    for (var m = 0; m < rows; m += 1) {
      var inputs = Object.create(null);
      for (var i = 0; i < names.length; i += 1) {
        inputs[names[i]] = (m >> (names.length - 1 - i)) & 1;
      }
      var out = parsed.evaluate(inputs);
      table.push({ index: m, inputs: inputs, output: out });
      if (out) minterms.push(m);
    }
    return { vars: names, rows: table, minterms: minterms, outputs: table.map(function (r) { return r.output; }) };
  }

  function isParsed(x) {
    return x && typeof x === 'object' && x.ast && Array.isArray(x.vars) && typeof x.evaluate === 'function';
  }

  /* Parse a minterm or don't-care list from text or arrays. */
  function parseMintermList(value, numVars) {
    resolveVarNames(numVars);
    var limit = 1 << numVars;
    var out = [];
    var values;
    if (value == null || value === '') return out;
    if (Array.isArray(value)) values = value;
    else if (typeof value === 'string') {
      values = value.split(/[\s,;]+/).filter(function (s) { return s.length > 0; });
    } else if (typeof value === 'number') values = [value];
    else throw LogicError('minterm list must be a string, number, or array');
    values.forEach(function (item) {
      if (typeof item === 'string' && (item.trim().toLowerCase() === 'x' || item.trim() === '-')) return;
      if ((typeof item !== 'number' && typeof item !== 'string') ||
          (typeof item === 'string' && !/^\d+$/.test(item.trim()))) {
        throw LogicError('invalid minterm ' + String(item));
      }
      var n = Number(item);
      if (!Number.isInteger(n) || n < 0 || n >= limit) {
        throw LogicError('minterm ' + String(item) + ' out of range 0..' + (limit - 1));
      }
      if (out.indexOf(n) < 0) out.push(n);
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function fromMinterms(numVars, minterms, dontCares) {
    var on = parseMintermList(minterms, numVars);
    var dc = parseMintermList(dontCares, numVars);
    var size = 1 << numVars;
    var outputs = new Array(size).fill(0);
    var care = new Array(size).fill(1);
    dc.forEach(function (m) { care[m] = 0; outputs[m] = 0; });
    on.forEach(function (m) {
      if (!care[m]) throw LogicError('minterm ' + m + ' is also listed as a don\'t care');
      outputs[m] = 1;
    });
    return { vars: resolveVarNames(numVars), minterms: on, dontCares: dc, outputs: outputs, care: care };
  }

  /* ------------------------------------------------------------------ *
   * 2. Quine-McCluskey prime implicants and Petrick's method
   * ------------------------------------------------------------------ */

  function popcount(n) {
    var c = 0;
    while (n) { n &= n - 1; c += 1; }
    return c;
  }

  /* An implicant is { mask: bit positions that matter, value: those bits, minterms: [] }. */
  function implicantKey(mask, value) { return mask + ':' + value; }

  function covers(implicant, minterm) {
    return ((minterm & implicant.mask) ^ implicant.value) === 0;
  }

  function isPowerOfTwo(n) { return n > 0 && (n & (n - 1)) === 0; }

  function primeImplicants(numVars, terms) {
    resolveVarNames(numVars);
    terms = parseMintermList(terms, numVars);
    if (terms.length === (1 << numVars)) return [{ mask: 0, value: 0, minterms: terms }];
    var comparisons = 0;
    var groups = new Map();
    terms.slice().sort(function (a, b) { return a - b; }).forEach(function (m) {
      if (m < 0 || m >= (1 << numVars)) throw LogicError('term ' + m + ' out of range');
      var key = implicantKey((1 << numVars) - 1, m);
      if (!groups.has(key)) groups.set(key, { mask: (1 << numVars) - 1, value: m, minterms: [m], used: false });
    });
    var current = groups;
    var allPrimes = new Map();
    var round = 0;
    while (current.size > 0 && round <= numVars) {
      var entries = Array.from(current.values());
      var next = new Map();
      var byOnes = new Map();
      entries.forEach(function (imp) {
        var ones = popcount(imp.value & imp.mask);
        if (!byOnes.has(ones)) byOnes.set(ones, []);
        byOnes.get(ones).push(imp);
      });
      var onesKeys = Array.from(byOnes.keys()).sort(function (a, b) { return a - b; });
      for (var gi = 0; gi + 1 < onesKeys.length; gi += 1) {
        var low = byOnes.get(onesKeys[gi]) || [];
        var high = byOnes.get(onesKeys[gi + 1]) || [];
        if (onesKeys[gi + 1] !== onesKeys[gi] + 1) continue;
        low.forEach(function (a) {
          high.forEach(function (b) {
            if (++comparisons > MAX_PRIME_COMPARISONS) throw LogicError('Exact prime generation budget exceeded; reduce the variable count or simplify the function');
            if (a.mask !== b.mask) return;
            var diff = (a.value ^ b.value) & a.mask;
            if (!isPowerOfTwo(diff)) return;
            var mask = a.mask & ~diff;
            var value = a.value & mask;
            var key = implicantKey(mask, value);
            var minterms = a.minterms.concat(b.minterms).filter(function (m, idx, arr) { return arr.indexOf(m) === idx; });
            if (!next.has(key)) next.set(key, { mask: mask, value: value, minterms: minterms, used: false });
            else {
              var existing = next.get(key);
              minterms.forEach(function (m) { if (existing.minterms.indexOf(m) < 0) existing.minterms.push(m); });
            }
            a.used = true;
            b.used = true;
          });
        });
      }
      entries.forEach(function (imp) {
        if (!imp.used) {
          var k = implicantKey(imp.mask, imp.value);
          allPrimes.set(k, { mask: imp.mask, value: imp.value, minterms: imp.minterms.slice().sort(function (x, y) { return x - y; }) });
        }
      });
      current = next;
      round += 1;
    }
    current.forEach(function (imp, key) {
      allPrimes.set(key, { mask: imp.mask, value: imp.value, minterms: imp.minterms.slice().sort(function (x, y) { return x - y; }) });
    });
    return Array.from(allPrimes.values());
  }

  function literalCost(imp) { return popcount(imp.mask); }

  /* Enumerate covers of the essential-free remainder using branch and bound. */
  function minimumCover(primes, targets) {
    if (targets.length === 0) return [];
    var targetSet = targets.slice();
    var targetIndex = new Map();
    targetSet.forEach(function (m, i) { targetIndex.set(m, i); });
    var candidates = primes.map(function (p, i) {
      var bits = 0n;
      p.minterms.forEach(function (m) {
        if (targetIndex.has(m)) bits |= 1n << BigInt(targetIndex.get(m));
      });
      return { index: i, bits: bits, literals: literalCost(p), size: p.minterms.length };
    }).filter(function (c) { return c.bits !== 0n; });
    if (candidates.length === 0) throw LogicError('no prime implicant covers the required minterms');
    var full = (1n << BigInt(targetSet.length)) - 1n;
    function bitCount(bits) { var count = 0; while (bits) { bits &= bits - 1n; count++; } return count; }
    /* Sort by coverage size descending to find good solutions early. */
    candidates.sort(function (a, b) {
      return bitCount(b.bits) - bitCount(a.bits) || a.literals - b.literals || a.index - b.index;
    });
    var best = null;
    var visited = new Map();
    var searched = 0;
    function score(sel) {
      var gates = sel.length;
      var literals = 0;
      sel.forEach(function (c) { literals += c.literals; });
      return [gates, literals, gates + literals];
    }
    function better(a, b) {
      for (var i = 0; i < 3; i += 1) {
        if (a[i] !== b[i]) return a[i] < b[i];
      }
      return false;
    }
    function search(start, covered, selected) {
      if (++searched > MAX_COVER_STATES) throw LogicError('Exact cover budget exceeded; reduce the variable count or simplify the function');
      var currentScore = score(selected);
      var prior = visited.get(covered);
      if (prior && !better(currentScore, prior)) return;
      visited.set(covered, currentScore);
      if (best) {
        var optimistic = score(selected);
        if (optimistic[0] > best.s[0]) return;
        if (optimistic[0] === best.s[0] && optimistic[1] >= best.s[1]) return;
      }
      if (covered === full) {
        var s = score(selected);
        if (!best || better(s, best.s)) best = { indices: selected.map(function (c) { return c.index; }), s: s };
        return;
      }
      /* Pick the uncovered target with the fewest covering candidates. */
      var bestOptions = null;
      for (var t = 0; t < targetSet.length; t += 1) {
        if (covered & (1n << BigInt(t))) continue;
        var options = candidates.filter(function (c) { return c.bits & (1n << BigInt(t)); });
        if (bestOptions === null || options.length < bestOptions.length) {
          bestOptions = options;
          if (options.length <= 1) break;
        }
      }
      if (!bestOptions || bestOptions.length === 0) return;
      bestOptions.forEach(function (c) {
        if (selected.indexOf(c) >= 0) return;
        if (best && selected.length + 1 > best.s[0]) return;
        selected.push(c);
        search(0, covered | c.bits, selected);
        selected.pop();
      });
    }
    search(0, 0n, []);
    if (!best) throw LogicError('failed to find a cover');
    return best.indices.map(function (i) { return primes[i]; });
  }

  function implicantToProduct(imp, names, numVars, complemented) {
    var parts = [];
    for (var i = 0; i < numVars; i += 1) {
      var bit = 1 << (numVars - 1 - i);
      if (!(imp.mask & bit)) continue;
      var positive = (imp.value & bit) !== 0;
      var usePositive = complemented ? !positive : positive;
      parts.push(usePositive ? names[i] : '!' + names[i]);
    }
    if (parts.length === 0) return complemented ? '0' : '1';
    return parts.join(complemented ? ' | ' : ' & ');
  }

  function implicantToText(imp, names, numVars, complemented) {
    var parts = [];
    for (var i = 0; i < numVars; i += 1) {
      var bit = 1 << (numVars - 1 - i);
      if (!(imp.mask & bit)) continue;
      var positive = (imp.value & bit) !== 0;
      var usePositive = complemented ? !positive : positive;
      parts.push((usePositive ? '' : '~') + names[i]);
    }
    if (parts.length === 0) return complemented ? '0' : '1';
    return complemented ? '(' + parts.join(' + ') + ')' : parts.join('');
  }

  function buildSolution(imp, kind, names, numVars) {
    return {
      terms: [implicantToText(imp, names, numVars, kind === 'POS')],
      product: implicantToProduct(imp, names, numVars, kind === 'POS'),
      minterms: imp.minterms.slice(),
      cube: { mask: imp.mask, value: imp.value, literals: literalCost(imp) },
      size: imp.minterms.length
    };
  }

  function metricsFor(chosen, kind, names, numVars) {
    var terms = [];
    var products = [];
    var literals = 0;
    var cubes = [];
    chosen.forEach(function (imp) {
      terms.push(implicantToText(imp, names, numVars, kind === 'POS'));
      products.push(implicantToProduct(imp, names, numVars, kind === 'POS'));
      literals += literalCost(imp);
      cubes.push({ mask: imp.mask, value: imp.value, literals: literalCost(imp), minterms: imp.minterms.slice() });
    });
    var gateCount;
    if (terms.length === 0) gateCount = { not: 0, and: 0, or: 0, nand: 0, total: 0 };
    else if (terms.length === 1 && (terms[0] === '1' || terms[0] === '0')) {
      gateCount = { not: 0, and: 0, or: 0, nand: 0, total: 0 };
    } else {
      var uniqueInversions = new Set();
      chosen.forEach(function (imp) {
        for (var i = 0; i < numVars; i += 1) {
          var bit = 1 << (numVars - 1 - i);
          if (!(imp.mask & bit)) continue;
          var positive = (imp.value & bit) !== 0;
          if ((kind === 'SOP' && !positive) || (kind === 'POS' && positive)) uniqueInversions.add(i);
        }
      });
      var notGates = uniqueInversions.size;
      var innerGates = 0;
      var outerGates = 0;
      chosen.forEach(function (imp) {
        var n = literalCost(imp);
        if (kind === 'SOP') innerGates += Math.max(0, n - 1);
        else outerGates += Math.max(0, n - 1);
      });
      if (kind === 'SOP') outerGates = chosen.length - 1;
      else innerGates = chosen.length - 1;
      gateCount = {
        not: notGates,
        and: innerGates,
        or: outerGates,
        nand: 0,
        total: notGates + innerGates + outerGates
      };
    }
    /* NAND-NAND and NOR-NOR implementations use one gate per product/sum plus one output gate. */
    gateCount.nand = gateCount.total === 0 ? 0 : chosen.length + 1;
    var depth = 0;
    chosen.forEach(function (imp) {
      var inversion = 0;
      for (var i = 0; i < numVars; i++) {
        var bit = 1 << (numVars - 1 - i);
        if ((imp.mask & bit) && (kind === 'POS' ? !!(imp.value & bit) : !(imp.value & bit))) inversion = 1;
      }
      depth = Math.max(depth, inversion + (literalCost(imp) > 1 ? Math.ceil(Math.log2(literalCost(imp))) : 0));
    });
    if (chosen.length > 1) depth += Math.ceil(Math.log2(chosen.length));
    return {
      terms: terms,
      products: products,
      implicants: cubes,
      gateCount: gateCount,
      literalCount: literals,
      termCount: chosen.length,
      expression: kind === 'SOP'
        ? (terms.length ? terms.join(' + ') : '0')
        : (terms.length ? terms.join('') : '1'),
      propagationDelay: {
        units: 'gate-delays',
        levels: depth,
        estimate: depth * 2,
        note: 'Illustrative 2 ns per level of balanced two-input gates and shared inverters; not a device timing measurement'
      }
    };
  }

  function evaluateSolution(chosen, numVars, kind, size) {
    var outputs = new Array(size);
    for (var m = 0; m < size; m += 1) {
      var val;
      if (kind === 'SOP') {
        val = 0;
        for (var i = 0; i < chosen.length; i += 1) {
          if (covers(chosen[i], m)) { val = 1; break; }
        }
      } else {
        val = 1;
        for (var j = 0; j < chosen.length; j += 1) {
          if (covers(chosen[j], m)) { val = 0; break; }
        }
      }
      outputs[m] = val;
    }
    return outputs;
  }

  function minimizeBoolean(numVars, minterms, dontCares, options) {
    if (!Number.isInteger(numVars) || numVars < 1 || numVars > MAX_VARS) {
      throw LogicError('numVars must be an integer between 1 and ' + MAX_VARS);
    }
    var opts = options || {};
    var names = resolveVarNames(numVars, opts.vars);
    var size = 1 << numVars;
    var on = parseMintermList(minterms, numVars);
    var dc = parseMintermList(dontCares, numVars);
    var dcSet = new Set(dc);
    on.forEach(function (m) {
      if (dcSet.has(m)) throw LogicError('minterm ' + m + ' is also listed as a don\'t care');
    });
    var care = new Array(size).fill(1);
    dc.forEach(function (m) { care[m] = 0; });
    var truth = new Array(size).fill(0);
    on.forEach(function (m) { truth[m] = 1; });

    var sopTerms = on.concat(dc);
    var sopPrimes = sopTerms.length ? primeImplicants(numVars, sopTerms) : [];
    /* Essential primes: a required minterm covered by exactly one prime. */
    var essential = [];
    var essentialKeys = new Set();
    on.forEach(function (m) {
      var covering = sopPrimes.filter(function (p) { return p.minterms.indexOf(m) >= 0; });
      if (covering.length === 1) {
        var k = implicantKey(covering[0].mask, covering[0].value);
        if (!essentialKeys.has(k)) { essentialKeys.add(k); essential.push(covering[0]); }
      }
    });
    var covered = new Set();
    essential.forEach(function (p) { p.minterms.forEach(function (m) { covered.add(m); }); });
    var remaining = on.filter(function (m) { return !covered.has(m); });
    var sopChosen = essential.slice();
    if (remaining.length) {
      minimumCover(sopPrimes, remaining).forEach(function (p) { sopChosen.push(p); });
    }
    sopChosen = dedupeImplicants(sopChosen);

    var zeros = [];
    for (var z = 0; z < size; z += 1) if (truth[z] === 0 && care[z]) zeros.push(z);
    var posTerms = zeros.concat(dc);
    var posPrimes = posTerms.length ? primeImplicants(numVars, posTerms) : [];
    var posEssential = [];
    var posKeys = new Set();
    zeros.forEach(function (m) {
      var covering = posPrimes.filter(function (p) { return p.minterms.indexOf(m) >= 0; });
      if (covering.length === 1) {
        var k = implicantKey(covering[0].mask, covering[0].value);
        if (!posKeys.has(k)) { posKeys.add(k); posEssential.push(covering[0]); }
      }
    });
    var posCovered = new Set();
    posEssential.forEach(function (p) { p.minterms.forEach(function (m) { posCovered.add(m); }); });
    var posRemaining = zeros.filter(function (m) { return !posCovered.has(m); });
    var posChosen = posEssential.slice();
    if (posRemaining.length) {
      minimumCover(posPrimes, posRemaining).forEach(function (p) { posChosen.push(p); });
    }
    posChosen = dedupeImplicants(posChosen);

    var sop = metricsFor(sopChosen, 'SOP', names, numVars);
    var pos = metricsFor(posChosen, 'POS', names, numVars);
    var sopOutputs = evaluateSolution(sopChosen, numVars, 'SOP', size);
    var posOutputs = evaluateSolution(posChosen, numVars, 'POS', size);

    var hazards = {
      sop: staticHazards(sopChosen, on, names, numVars, 'SOP'),
      pos: staticHazards(posChosen, zeros, names, numVars, 'POS')
    };
    return {
      numVars: numVars,
      vars: names,
      minterms: on,
      dontCares: dc,
      truthTable: truth,
      care: care,
      primeImplicants: sopPrimes.map(function (p) { return describePrime(p, names, numVars, 'SOP'); }),
      essentialPrimeImplicants: essential.map(function (p) { return describePrime(p, names, numVars, 'SOP'); }),
      posEssentialPrimeImplicants: posEssential.map(function (p) { return describePrime(p, names, numVars, 'POS'); }),
      posPrimeImplicants: posPrimes.map(function (p) { return describePrime(p, names, numVars, 'POS'); }),
      sop: sop,
      pos: pos,
      hazards: hazards,
      metrics: {
        gateCount: sop.gateCount,
        literalCount: sop.literalCount,
        propagationDelay: sop.propagationDelay.estimate,
        propagationDelayUnits: 'ns',
        termCount: sop.termCount,
        sopVsPos: { sopGates: sop.gateCount.total, posGates: pos.gateCount.total, recommended: pos.gateCount.total < sop.gateCount.total ? 'POS' : 'SOP' }
      },
      verification: {
        sopMatchesCareInputs: on.concat(zeros.filter(function (m) { return care[m]; })).every(function (m) { return sopOutputs[m] === truth[m]; }),
        posMatchesCareInputs: on.concat(zeros.filter(function (m) { return care[m]; })).every(function (m) { return posOutputs[m] === truth[m]; }),
        sopOutputs: sopOutputs,
        posOutputs: posOutputs,
        dontCareAssignments: dc.map(function (m) { return { minterm: m, sop: sopOutputs[m], pos: posOutputs[m] }; })
      }
    };
  }

  function dedupeImplicants(list) {
    var seen = new Set();
    return list.filter(function (p) {
      var k = implicantKey(p.mask, p.value);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function describePrime(p, names, numVars, kind) {
    return {
      mask: p.mask,
      value: p.value,
      minterms: p.minterms.slice(),
      literals: literalCost(p),
      size: p.minterms.length,
      text: implicantToText(p, names, numVars, kind === 'POS'),
      product: implicantToProduct(p, names, numVars, kind === 'POS')
    };
  }

  /* An adjacent pair of care states needs a common cube to avoid a static hazard. */
  function staticHazards(chosen, targets, names, numVars, kind) {
    var targetSet = new Set(targets);
    var found = [];
    targets.forEach(function (from) {
      for (var i = 0; i < numVars; i++) {
        var bit = 1 << (numVars - 1 - i);
        var to = from ^ bit;
        if (to <= from || !targetSet.has(to)) continue;
        if (chosen.some(function (cube) { return covers(cube, from) && covers(cube, to); })) continue;
        var cube = { mask: ((1 << numVars) - 1) & ~bit, value: from & ~bit, minterms: [from, to] };
        found.push({ from: from, to: to, variable: names[i], type: kind === 'SOP' ? 'static-1' : 'static-0', consensus: implicantToProduct(cube, names, numVars, kind === 'POS') });
      }
    });
    return found;
  }

  /* Karnaugh map layout for 2, 3, and 4 variables. */
  function karnaughMap(numVars, minterms, dontCares) {
    if (!Number.isInteger(numVars) || numVars < 2 || numVars > 4) throw LogicError('Karnaugh map supports 2 to 4 variables');
    var on = parseMintermList(minterms, numVars);
    var dc = parseMintermList(dontCares, numVars);
    if (on.some(function (m) { return dc.indexOf(m) >= 0; })) throw LogicError('minterm is also listed as a don\'t care');
    var size = 1 << numVars;
    var rowVars = Math.floor(numVars / 2);
    var colVars = numVars - rowVars;
    var rows = 1 << rowVars;
    var cols = 1 << colVars;
    function gray(n) { return n ^ (n >> 1); }
    var cells = [];
    for (var r = 0; r < rows; r += 1) {
      var row = [];
      for (var c = 0; c < cols; c += 1) {
        var m = (gray(r) << colVars) | gray(c);
        row.push({
          row: r, col: c, minterm: m,
          value: dc.indexOf(m) >= 0 ? 'X' : (on.indexOf(m) >= 0 ? 1 : 0),
          rowGray: gray(r), colGray: gray(c)
        });
      }
      cells.push(row);
    }
    return {
      numVars: numVars,
      rows: rows,
      cols: cols,
      rowVars: rowVars,
      colVars: colVars,
      grayOrder: { rows: Array.from({ length: rows }, function (_, i) { return gray(i); }), cols: Array.from({ length: cols }, function (_, i) { return gray(i); }) },
      cells: cells,
      size: size,
      minterms: on,
      dontCares: dc
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. Netlist DAG and sequential circuit simulator
   * ------------------------------------------------------------------ */

  var GATE_DEFS = {
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
    FULL_ADDER: { inputs: 3, outputs: ['sum', 'carry'], fn: function (a) {
      var s = a[0] ^ a[1] ^ a[2];
      var c = (a[0] & a[1]) | (a[2] & (a[0] ^ a[1]));
      return { sum: s, carry: c };
    } },
    DFF: { inputs: 1, outputs: ['q'], sequential: true, fn: function (a) { return { q: a[0] }; } },
    CONST: { inputs: 0, outputs: ['y'], fn: function () { return 0; } }
  };

  function buildGraph(netlist) {
    if (!netlist || typeof netlist !== 'object') throw LogicError('netlist must be an object');
    var nodes = Array.isArray(netlist.nodes) ? netlist.nodes : [];
    var edges = Array.isArray(netlist.edges) ? netlist.edges : [];
    var inputs = Array.isArray(netlist.inputs) ? netlist.inputs : [];
    if (inputs.length > MAX_VARS) throw LogicError('netlist supports at most ' + MAX_VARS + ' external inputs');
    var byName = new Map();
    /* External inputs are virtual nodes. IN:<name> is an alias for <name>. */
    inputs.forEach(function (inp) {
      var name = typeof inp === 'string' ? inp : inp.name;
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw LogicError('input must have a valid identifier name');
      if (byName.has('IN:' + name)) throw LogicError('duplicate input name: ' + name);
      byName.set('IN:' + name, {
        id: 'IN:' + name, type: 'INPUT', virtual: true,
        def: { inputs: 0, outputs: ['y'], fn: function () { return 0; } },
        inputs: [], outputs: ['y'], label: name, init: 0, params: {}
      });
    });
    nodes.forEach(function (n) {
      if (!n || typeof n.id !== 'string' || !n.id || n.id.indexOf('IN:') === 0) throw LogicError('each node needs a nonempty string id outside the IN: namespace');
      if (byName.has(n.id)) throw LogicError('duplicate node id: ' + n.id);
      var type = String(n.type || '').toUpperCase();
      var def = GATE_DEFS[type];
      if (!def) throw LogicError('unknown node type "' + type + '" on ' + n.id);
      byName.set(n.id, {
        id: n.id, type: type, def: def,
        inputs: new Array(def.inputs).fill(null),
        outputs: def.outputs.slice(),
        label: n.label || n.id,
        init: n.init === 1 || n.init === true ? 1 : 0,
        params: n.params || {}
      });
    });
    edges.forEach(function (e, i) {
      if (!e || typeof e !== 'object') throw LogicError('invalid edge at index ' + i);
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
      if (!byName.has(from)) throw LogicError('edge ' + i + ' has unknown source "' + fromRaw + '"');
      if (!byName.has(to)) throw LogicError('edge ' + i + ' has unknown target "' + to + '"');
      var src = byName.get(from);
      var dst = byName.get(to);
      if (src.outputs.indexOf(fromPort) < 0) throw LogicError('edge ' + i + ' references missing output port ' + fromPort);
      var idx = typeof toPort === 'number' ? toPort : dst.inputs.indexOf(toPort);
      if (!Number.isInteger(idx) || idx < 0 || idx >= dst.inputs.length) {
        throw LogicError('edge ' + i + ' references invalid input port ' + toPort);
      }
      if (dst.inputs[idx]) throw LogicError('node ' + to + ' input ' + idx + ' is driven more than once');
      dst.inputs[idx] = { node: from, port: fromPort };
    });
    return { byName: byName, nodes: Array.from(byName.values()), edges: edges };
  }

  function combinationalOrder(graph) {
    var state = new Map();
    var order = [];
    var stack = [];
    function visit(id) {
      var s = state.get(id);
      if (s === 2) return;
      if (s === 1) throw LogicError('combinational cycle detected: ' + stack.concat(id).join(' -> '));
      state.set(id, 1);
      stack.push(id);
      var node = graph.byName.get(id);
      if (!node.def.sequential && !node.virtual) {
        node.inputs.forEach(function (wire) {
          if (wire) visit(wire.node);
        });
      }
      stack.pop();
      state.set(id, 2);
      order.push(node);
    }
    graph.nodes.forEach(function (n) { visit(n.id); });
    return order;
  }

  function detectCycles(netlist) {
    var graph = buildGraph(netlist);
    var allCycles = [];
    var state = new Map();
    var path = [];
    function dfs(id) {
      if (state.get(id) === 2) return;
      if (state.get(id) === 1) {
        var start = path.indexOf(id);
        allCycles.push(path.slice(start).concat(id));
        return;
      }
      state.set(id, 1);
      path.push(id);
      var n = graph.byName.get(id);
      if (!n.virtual) n.inputs.forEach(function (w) { if (w) dfs(w.node); });
      path.pop();
      state.set(id, 2);
    }
    graph.nodes.filter(function (n) { return !n.virtual; }).forEach(function (n) { dfs(n.id); });
    var combCycles = [];
    try { combinationalOrder(graph); }
    catch (err) { combCycles.push(err.message); }
    return {
      hasCycle: allCycles.length > 0,
      cycles: allCycles,
      hasCombinationalCycle: combCycles.length > 0,
      combinationalCycles: combCycles,
      isSequential: graph.nodes.some(function (n) { return n.def.sequential; }),
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length
    };
  }

  function simulateNetlist(netlist, inputVectors, options) {
    var opts = options || {};
    var graph = buildGraph(netlist);
    var cycleInfo = detectCycles(netlist);
    if (cycleInfo.hasCombinationalCycle) {
      throw LogicError('combinational loop: ' + cycleInfo.combinationalCycles.join('; '));
    }
    var order = combinationalOrder(graph).filter(function (n) { return !n.virtual && !n.def.sequential; });
    var dffs = graph.nodes.filter(function (n) { return n.def.sequential; });
    var inputs = Array.isArray(netlist.inputs) ? netlist.inputs.slice() : [];
    var outputs = Array.isArray(netlist.outputs) ? netlist.outputs.slice() : [];
    if (outputs.length === 0) {
      graph.nodes.forEach(function (n) {
        if (n.virtual) return;
        n.outputs.forEach(function (p) { outputs.push({ node: n.id, port: p, name: n.id + '_' + p }); });
      });
    }
    var vectors = normalizeVectors(inputVectors, inputs);
    var state = new Map();
    dffs.forEach(function (n) {
      n.outputs.forEach(function (p) { state.set(n.id + ':' + p, n.init); });
    });
    inputs.forEach(function (inp) {
      var name = typeof inp === 'string' ? inp : inp.name;
      state.set('IN:' + name, 0);
    });
    var cycles = [];
    var hazards = [];
    /* A pin with no driver reads as 0; that is reported, never silent. */
    order.forEach(function (n) {
      n.inputs.forEach(function (wire, i) {
        if (!wire) hazards.push({ cycle: null, type: 'undriven-input', node: n.id, port: i, message: 'node ' + n.id + ' input ' + i + ' has no driver and reads 0' });
      });
    });
    dffs.forEach(function (n) {
      if (!n.inputs[0]) hazards.push({ cycle: null, type: 'undriven-input', node: n.id, port: 0, message: 'register ' + n.id + ' D input has no driver and holds ' + n.init });
    });
    var maxSteps = opts.maxSteps == null ? 200 : opts.maxSteps;
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10000) throw LogicError('maxSteps must be an integer between 1 and 10000');
    var outputNames = new Set();
    outputs.forEach(function (o) {
      if (!o || !graph.byName.has(o.node) || graph.byName.get(o.node).outputs.indexOf(o.port) < 0) throw LogicError('output references a missing node or port');
      var name = o.name || (o.node + '_' + o.port);
      if (outputNames.has(name)) throw LogicError('duplicate output name: ' + name);
      outputNames.add(name);
    });
    vectors.forEach(function (vector, cycleIndex) {
      if (typeof vector === 'number' && (!Number.isSafeInteger(vector) || vector < 0 || vector >= Math.pow(2, inputs.length))) throw LogicError('numeric input vector is outside the declared input width');
      var inputState = new Map(state);
      inputs.forEach(function (inp, idx) {
        var name = typeof inp === 'string' ? inp : inp.name;
        var v;
        if (typeof vector === 'number') v = (vector >> (inputs.length - 1 - idx)) & 1;
        else if (Array.isArray(vector)) v = vector[idx];
        else if (vector && typeof vector === 'object') v = vector[name] != null ? vector[name] : (vector[keyOf(name)] != null ? vector[keyOf(name)] : 0);
        else throw LogicError('input vector must be a number, array or object');
        if (v === 'x' || v === 'X' || v == null) v = 0;
        v = Number(v);
        if (v !== 0 && v !== 1) throw LogicError('input values must be binary');
        inputState.set('IN:' + name, v);
        inputState.set('IN:' + name + ':y', v);
      });
      var snapshots = [];
      var settled = false;
      var prevValues = null;
      for (var step = 0; step < maxSteps; step += 1) {
        var values = new Map(inputState);
        dffs.forEach(function (n) {
          n.outputs.forEach(function (p) { values.set(n.id + ':' + p, state.get(n.id + ':' + p)); });
        });
        order.forEach(function (node) {
          var args = node.inputs.map(function (w) {
            if (!w) return 0;
            var key = w.node + ':' + w.port;
            return values.has(key) ? values.get(key) : 0;
          });
          var result = node.def.fn(args);
          if (node.type === 'CONST') result = Number(node.params.value) ? 1 : 0;
          if (typeof result === 'number') {
            values.set(node.id + ':y', result);
          } else {
            Object.keys(result).forEach(function (p) { values.set(node.id + ':' + p, result[p]); });
          }
        });
        var signature = signatureOf(values, order, dffs);
        snapshots.push(capture(outputs, values, inputState));
        if (signature === prevValues || step === 0) { settled = true; break; }
        prevValues = signature;
      }
      if (!settled) {
        hazards.push({ cycle: cycleIndex, type: 'oscillation', message: 'network did not settle within ' + maxSteps + ' evaluation steps' });
      }
      if (snapshots.length > 2) {
        hazards.push({ cycle: cycleIndex, type: 'glitch', steps: snapshots.length - 1, message: 'multiple evaluation passes needed to settle' });
      }
      var final = snapshots[snapshots.length - 1];
      var out = Object.create(null);
      outputs.forEach(function (o) {
        var name = o.name || (o.node + '_' + o.port);
        out[name] = final.values[o.node + ':' + o.port] != null ? final.values[o.node + ':' + o.port] : 0;
      });
      /* Non-blocking DFF update: sample D input from the settled combinational values. */
      var nextState = new Map(state);
      dffs.forEach(function (n) {
        var wire = n.inputs[0];
        var key = wire ? wire.node + ':' + wire.port : null;
        var d = key ? (final.allValues[key] || 0) : 0;
        n.outputs.forEach(function (p) { nextState.set(n.id + ':' + p, d ? 1 : 0); });
      });
      state = nextState;
      cycles.push({
        cycle: cycleIndex,
        inputs: final.inputs,
        outputs: out,
        steps: snapshots.length,
        settled: settled,
        state: Object.fromEntries(state)
      });
    });
    return {
      inputs: inputs.map(function (i) { return typeof i === 'string' ? i : i.name; }),
      outputs: outputs.map(function (o) { return o.name || (o.node + '_' + o.port); }),
      cycles: cycles,
      hazards: hazards,
      cycleInfo: cycleInfo,
      finalState: Object.fromEntries(state),
      waveform: buildWaveform(cycles, inputs, outputs)
    };
  }

  function normalizeVectors(vectors, inputs) {
    if (vectors == null) return [{}];
    if (!Array.isArray(vectors)) vectors = [vectors];
    if (vectors.length === 0) return [{}];
    return vectors;
  }

  function signatureOf(values, order, dffs) {
    var parts = [];
    order.forEach(function (n) { n.outputs.forEach(function (p) { parts.push(values.get(n.id + ':' + p)); }); });
    dffs.forEach(function (n) { n.outputs.forEach(function (p) { parts.push(values.get(n.id + ':' + p)); }); });
    return parts.join(',');
  }

  function capture(outputs, values, inputState) {
    var inputsObj = Object.create(null);
    inputState.forEach(function (v, k) {
      if (k.indexOf('IN:') === 0 && k.indexOf(':y') < 0) inputsObj[k.slice(3)] = v;
    });
    return { inputs: inputsObj, values: Object.fromEntries(values), allValues: Object.fromEntries(values) };
  }

  function buildWaveform(cycles, inputs, outputs) {
    var names = inputs.map(function (i) { return typeof i === 'string' ? i : i.name; })
      .concat(outputs.map(function (o) { return o.name || (o.node + '_' + o.port); }));
    return {
      signals: names.map(function (name) {
        return {
          name: name,
          values: cycles.map(function (c) {
            return c.inputs[name] != null ? c.inputs[name] : (c.outputs[name] != null ? c.outputs[name] : 0);
          })
        };
      }),
      cycles: cycles.length
    };
  }

  /* ------------------------------------------------------------------ *
   * 4. Verilog-2001 module and self-checking testbench exporter
   * ------------------------------------------------------------------ */

  function sanitizeIdentifier(name, fallback) {
    var s = String(name == null ? '' : name).replace(/[^A-Za-z0-9_]/g, '_');
    if (!s || /^[0-9]/.test(s)) s = (fallback || 'signal') + '_' + s;
    if (/^(always|and|assign|automatic|begin|buf|bufif0|bufif1|case|casex|casez|cell|cmos|config|deassign|default|defparam|design|disable|edge|else|end|endcase|endconfig|endfunction|endgenerate|endmodule|endprimitive|endspecify|endtable|endtask|event|for|force|forever|fork|function|generate|genvar|highz0|highz1|if|ifnone|incdir|include|initial|inout|input|instance|integer|join|large|liblist|library|localparam|macromodule|medium|module|nand|negedge|nmos|nor|noshowcancelled|not|notif0|notif1|or|output|parameter|pmos|posedge|primitive|pull0|pull1|pulldown|pullup|pulsestyle_onevent|pulsestyle_ondetect|rcmos|real|realtime|reg|release|repeat|rnmos|rpmos|rtran|rtranif0|rtranif1|scalared|showcancelled|signed|small|specify|specparam|strong0|strong1|supply0|supply1|table|task|time|tran|tranif0|tranif1|tri|tri0|tri1|triand|trior|trireg|unsigned|use|vectored|wait|wand|weak0|weak1|while|wire|wor|xnor|xor)$/i.test(s)) {
      s = 'lg_' + s;
    }
    return s;
  }

  function uniqueNames(list, fallback) {
    var used = new Set();
    return list.map(function (n, i) {
      var base = sanitizeIdentifier(n, fallback + i);
      var name = base;
      var suffix = 1;
      while (used.has(name)) { name = base + '_' + suffix; suffix += 1; }
      used.add(name);
      return name;
    });
  }

  function verilogExpression(product, varMap) {
    if (product === '1') return "1'b1";
    if (product === '0') return "1'b0";
    return product.split(' & ').map(function (literal) {
      var neg = literal.charAt(0) === '!';
      var raw = neg ? literal.slice(1) : literal;
      var v = varMap[raw] || sanitizeIdentifier(raw, 'v');
      return (neg ? '~' : '') + v;
    }).join(' & ');
  }

  function verilogSum(product, varMap) {
    if (product === '1') return "1'b1";
    if (product === '0') return "1'b0";
    return '(' + product.split(' | ').map(function (literal) {
      var neg = literal.charAt(0) === '!';
      var raw = neg ? literal.slice(1) : literal;
      var v = varMap[raw] || sanitizeIdentifier(raw, 'v');
      return (neg ? '~' : '') + v;
    }).join(' | ') + ')';
  }

  function buildSpec(spec) {
    if (!spec || typeof spec !== 'object') throw LogicError('spec must be an object');
    var numVars = spec.numVars;
    var vars = spec.vars;
    var exprTable = null;
    if (vars == null && numVars == null && spec.expr != null) {
      /* An expression-only spec infers its variables from the parse. */
      exprTable = evalTruthTable(spec.expr);
      vars = exprTable.vars;
      numVars = vars.length;
    }
    var names = vars ? normalizeVars(vars) : resolveVarNames(numVars == null ? 2 : numVars);
    if (numVars == null) numVars = names.length;
    if (numVars !== names.length) throw LogicError('numVars must equal vars.length');
    var minterms = spec.minterms;
    if (minterms == null && spec.expr != null) {
      var tt = exprTable || evalTruthTable(spec.expr, names);
      minterms = tt.minterms;
    }
    var result = minimizeBoolean(numVars, minterms, spec.dontCares, { vars: names });
    return { spec: spec, numVars: numVars, names: names, result: result };
  }

  function exportVerilog(spec) {
    var ctx = buildSpec(spec);
    var s = ctx.spec;
    var names = ctx.names;
    var result = ctx.result;
    var moduleName = sanitizeIdentifier(s.moduleName || s.name || 'logicgate_module', 'lg_module');
    var form = String(s.form || 'SOP').toUpperCase();
    if (form !== 'SOP' && form !== 'POS') throw LogicError('form must be SOP or POS');
    var solution = form === 'POS' ? result.pos : result.sop;
    var vNames = uniqueNames(names, 'in');
    var varMap = Object.create(null);
    names.forEach(function (n, i) { varMap[n] = vNames[i]; });
    var outName = sanitizeIdentifier(s.outputName || 'y', 'lg_out');
    var outputBase = outName;
    var outputSuffix = 1;
    while (vNames.indexOf(outName) >= 0) outName = outputBase + '_' + outputSuffix++;
    var lines = [];
    lines.push('`timescale 1ns/1ps');
    lines.push('// LogicGate generated synthesizable Verilog-2001 module');
    lines.push('// Function: ' + (solution.expression || 'constant'));
    lines.push('// Variables: ' + names.join(', '));
    lines.push('// Minterms: ' + (result.minterms.length ? result.minterms.join(', ') : 'none'));
    lines.push('// Don\'t cares: ' + (result.dontCares.length ? result.dontCares.join(', ') : 'none'));
    lines.push('// Form: ' + form + ', literals: ' + solution.literalCount + ', terms: ' + solution.termCount);
    lines.push('`default_nettype none');
    lines.push('module ' + moduleName + ' (');
    var ports = vNames.concat([outName]);
    lines.push('    ' + ports.map(function (p, i) { return i === ports.length - 1 ? 'output wire ' + p : 'input  wire ' + p; }).join(',\n    '));
    lines.push(');');
    lines.push('');
    if (form === 'SOP') {
      if (solution.products.length === 0 || (solution.products.length === 1 && solution.products[0] === '0')) {
        lines.push('    assign ' + outName + " = 1'b0;");
      } else if (solution.products.length === 1 && solution.products[0] === '1') {
        lines.push('    assign ' + outName + " = 1'b1;");
      } else {
        var terms = solution.products.map(function (p) {
          var e = verilogExpression(p, varMap);
          return e.indexOf('&') >= 0 ? '(' + e + ')' : e;
        });
        lines.push('    assign ' + outName + ' = ' + wrapJoin(terms, ' | ', '        ') + ';');
      }
    } else {
      /* POS: a maxterm with no literals evaluates to 0, and an empty product is 1. */
      if (solution.products.length === 0) {
        lines.push('    assign ' + outName + " = 1'b1;");
      } else if (solution.products.length === 1 && solution.products[0] === '0') {
        lines.push('    assign ' + outName + " = 1'b0;");
      } else {
        lines.push('    assign ' + outName + ' = ' + wrapJoin(solution.products.map(function (p) { return verilogSum(p, varMap); }), ' & ', '        ') + ';');
      }
    }
    lines.push('');
    lines.push('endmodule');
    lines.push('`default_nettype wire');
    var module = lines.join('\n') + '\n';

    var tbName = moduleName + '_tb';
    var localNames = new Set([outName, moduleName, tbName]);
    function localName(base) {
      var name = base, suffix = 1;
      while (localNames.has(name)) name = base + '_' + suffix++;
      localNames.add(name);
      return name;
    }
    var stimulusName = localName('stimulus');
    var errorsName = localName('errors');
    var indexName = localName('i');
    var expectedName = localName('expected');
    var careFunctionName = localName('is_dont_care');
    var instanceName = localName('dut');
    var tb = [];
    var size = 1 << ctx.numVars;
    tb.push('// LogicGate generated self-checking testbench');
    tb.push('// Run with: iverilog -o ' + tbName + '.vvp ' + moduleName + '.v ' + tbName + '.v && vvp ' + tbName + '.vvp');
    tb.push('`timescale 1ns/1ps');
    tb.push('`default_nettype none');
    tb.push('module ' + tbName + ';');
    tb.push('    reg  [' + (ctx.numVars - 1) + ':0] ' + stimulusName + ';');
    tb.push('    wire ' + outName + ';');
    tb.push('    integer ' + errorsName + ';');
    tb.push('    integer ' + indexName + ';');
    tb.push('    reg ' + expectedName + ';');
    tb.push('');
    tb.push('    ' + moduleName + ' ' + instanceName + ' (');
    tb.push('        ' + vNames.map(function (v, i) { return '.' + v + '(' + stimulusName + '[' + (ctx.numVars - 1 - i) + '])'; }).concat(['.' + outName + '(' + outName + ')']).join(',\n        '));
    tb.push('    );');
    tb.push('');
    tb.push('    function ' + careFunctionName + ';');
    tb.push('        input [' + (ctx.numVars - 1) + ':0] s;');
    tb.push('        begin');
    tb.push('            ' + careFunctionName + ' = ' + buildExpectedFunction({ minterms: result.dontCares }, ctx.numVars, true) + ';');
    tb.push('        end');
    tb.push('    endfunction');
    tb.push('');
    tb.push('    initial begin');
    tb.push('        ' + errorsName + ' = 0;');
    tb.push('        for (' + indexName + ' = 0; ' + indexName + ' < ' + size + '; ' + indexName + ' = ' + indexName + ' + 1) begin');
    tb.push('            ' + stimulusName + ' = ' + indexName + '[' + (ctx.numVars - 1) + ':0];');
    tb.push('            #1;');
    tb.push('            ' + expectedName + ' = ' + buildExpectedFunction(result, ctx.numVars, false, stimulusName) + ';');
    tb.push('            if (' + careFunctionName + '(' + stimulusName + ')) begin');
    tb.push('                $display("DONT CARE %0d: %b", ' + indexName + ', ' + outName + ');');
    tb.push('            end');
    tb.push('            else if (' + outName + ' !== ' + expectedName + ') begin');
    tb.push('                $display("FAIL %0d: got %b expected %b", ' + indexName + ', ' + outName + ', ' + expectedName + ');');
    tb.push('                ' + errorsName + ' = ' + errorsName + ' + 1;');
    tb.push('            end');
    tb.push('            else begin');
    tb.push('                $display("PASS %0d: %b", ' + indexName + ', ' + outName + ');');
    tb.push('            end');
    tb.push('        end');
    tb.push('        if (' + errorsName + ' == 0) $display("ALL ' + size + ' VECTORS PASS");');
    tb.push('        else $display("%0d VECTORS FAILED", ' + errorsName + ');');
    tb.push('        $finish;');
    tb.push('    end');
    tb.push('');
    tb.push('    initial begin');
    tb.push('        $dumpfile("' + tbName + '.vcd");');
    tb.push('        $dumpvars(0, ' + tbName + ');');
    tb.push('    end');
    tb.push('endmodule');
    tb.push('`default_nettype wire');
    var testbench = tb.join('\n') + '\n';

    return {
      moduleName: moduleName,
      testbenchName: tbName,
      module: module,
      testbench: testbench,
      filename: moduleName + '.v',
      testbenchFilename: tbName + '.v',
      form: form,
      expression: solution.expression,
      vectorCount: size,
      truthTable: result.truthTable,
      dontCares: result.dontCares,
      inputNames: vNames,
      outputName: outName,
      spec: { numVars: ctx.numVars, vars: names, minterms: result.minterms, dontCares: result.dontCares, form: form }
    };
  }

  /* Break long operator chains onto continuation lines so emitted files stay readable. */
  function wrapJoin(parts, op, indent) {
    var groups = [];
    for (var i = 0; i < parts.length; i += 4) groups.push(parts.slice(i, i + 4).join(op));
    return groups.join(op.trim() + '\n' + indent);
  }

  function buildExpectedFunction(result, numVars, forDontCare, stimulusName) {
    var terms = [];
    result.minterms.forEach(function (m) {
      terms.push('(' + (forDontCare ? 's' : (stimulusName || 'stimulus')) + ' == ' + numVars + "'d" + m + ')');
    });
    if (terms.length === 0) return "1'b0";
    return '(' + wrapJoin(terms, ' || ', '            ') + ')';
  }

  /* Read the emitted RTL back into the parser and verify every care vector. */
  function verifyVerilog(bundle) {
    if (!bundle || typeof bundle.module !== 'string' || !bundle.spec) throw LogicError('a Verilog export bundle is required');
    var source = bundle.module.replace(/\/\/[^\n]*/g, '');
    var assignments = Array.from(source.matchAll(/\bassign\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g));
    var inputs = Array.from(source.matchAll(/\binput\s+wire\s+([A-Za-z_][A-Za-z0-9_]*)/g)).map(function (m) { return m[1]; });
    var output = /\boutput\s+wire\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(source);
    if (assignments.length !== 1 || !output || assignments[0][1] !== output[1] || inputs.length !== bundle.spec.numVars) throw LogicError('unsupported or malformed continuous-assignment Verilog');
    var expression = assignments[0][2].replace(/1'b([01])/g, '$1');
    var table = evalTruthTable(expression, inputs);
    var expected = fromMinterms(bundle.spec.numVars, bundle.spec.minterms, bundle.spec.dontCares);
    var failures = [];
    var checked = 0;
    expected.outputs.forEach(function (value, vector) {
      if (!expected.care[vector]) return;
      checked++;
      if (table.outputs[vector] !== value) failures.push({ vector: vector, expected: value, actual: table.outputs[vector] });
    });
    return { passes: failures.length === 0, checked: checked, total: table.outputs.length, failures: failures, outputs: table.outputs };
  }

  function exportVerificationJSON(spec) {
    var ctx = buildSpec(spec);
    var bundle = exportVerilog(spec);
    return JSON.stringify({
      format: 'logicgate-verification', version: 1,
      specification: bundle.spec,
      synthesis: { sop: ctx.result.sop, pos: ctx.result.pos },
      verification: { sop: ctx.result.verification.sopMatchesCareInputs, pos: ctx.result.verification.posMatchesCareInputs, rtl: verifyVerilog(bundle) },
      staticHazards: ctx.result.hazards,
      timingModel: 'Balanced two-input gates at an illustrative 2 ns per level'
    }, null, 2) + '\n';
  }

  /* ------------------------------------------------------------------ *
   * 5. Built-in presets
   * ------------------------------------------------------------------ */

  function preset(id, label, description, numVars, vars, minterms, dontCares, expr, extra) {
    var obj = {
      id: id, label: label, description: description,
      numVars: numVars, vars: vars, minterms: minterms, dontCares: dontCares || [], expr: expr || null
    };
    if (extra) Object.keys(extra).forEach(function (k) { obj[k] = extra[k]; });
    return obj;
  }

  var PRESETS = {
    cyclicCover: preset('cyclicCover', 'Exact cover challenge', 'Six care states, zero essential primes. An exact three-cube cover resolves the cyclic chart.', 4, ['A', 'B', 'C', 'D'], [1, 2, 3, 4, 5, 6], [], null, { moduleName: 'cyclic_cover', outputName: 'covered' }),
    staticHazard: preset('staticHazard', 'Hazard detective', 'The A transition at B=C=1 exposes a static-1 hazard. Inspect the missing B & C consensus term.', 3, ['A', 'B', 'C'], [1, 3, 6, 7], [], 'A & B | !A & C', { moduleName: 'hazard_case', outputName: 'F' }),
    sevenSegmentDecoder: preset(
      'sevenSegmentDecoder', 'Seven segment decoder',
      'Segment a of a BCD to seven segment display. States 10 to 15 are don\'t cares.',
      4, ['A', 'B', 'C', 'D'], [0, 2, 3, 5, 6, 7, 8, 9], [10, 11, 12, 13, 14, 15],
      null,
      { outputName: 'seg_a', moduleName: 'seg7_a', segmentMap: { a: [0, 2, 3, 5, 6, 7, 8, 9], b: [0, 1, 2, 3, 4, 7, 8, 9], c: [0, 1, 3, 4, 5, 6, 7, 8, 9], d: [0, 2, 3, 5, 6, 8, 9], e: [0, 2, 6, 8], f: [0, 4, 5, 6, 8, 9], g: [2, 3, 4, 5, 6, 8, 9] } }
    ),
    alu4BitSlice: preset(
      'alu4BitSlice', 'ALU 4 bit slice',
      'One bit of a four bit arithmetic logic unit. Full adder with operation select and carry chain.',
      4, ['A', 'B', 'CIN', 'OP'], [1, 2, 4, 7, 8, 11, 13, 14], [],
      null,
      { outputName: 'result', moduleName: 'alu_slice', netlist: aluSliceNetlist() }
    ),
    carryLookahead4Bit: preset(
      'carryLookahead4Bit', 'Carry lookahead 4 bit',
      'Carry generate and propagate logic for a four bit carry lookahead adder, C4 as a function of A, B, CIN.',
      9, ['A0', 'B0', 'A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'CIN'], [], [],
      null,
      { outputName: 'C4', moduleName: 'cla4_carry', netlist: carryLookaheadNetlist(), vectorCount: 512 }
    ),
    syncCounter: preset(
      'syncCounter', 'Clocked two-bit counter',
      'Two D registers with an enable. Eight clock edges count 0 to 3 twice, then four edges hold while EN is low. The next-bit equation is Q1 XOR Q0.',
      2, ['Q1', 'Q0'], [1, 2], [], 'Q1 ^ Q0',
      {
        outputName: 'next_bit', moduleName: 'counter2_slice', runLabel: 'Clock the counter',
        netlist: {
          inputs: ['EN'],
          outputs: [{ node: 'q0', port: 'q', name: 'b0' }, { node: 'q1', port: 'q', name: 'b1' }],
          nodes: [
            { id: 'q0', type: 'DFF', init: 0 }, { id: 'q1', type: 'DFF', init: 0 },
            { id: 'x0', type: 'XOR' }, { id: 'a0', type: 'AND' }, { id: 'x1', type: 'XOR' }
          ],
          edges: [
            { from: 'IN:EN', to: 'x0', toPort: 0 }, { from: 'q0', fromPort: 'q', to: 'x0', toPort: 1 },
            { from: 'x0', fromPort: 'y', to: 'q0', toPort: 0 },
            { from: 'IN:EN', to: 'a0', toPort: 0 }, { from: 'q0', fromPort: 'q', to: 'a0', toPort: 1 },
            { from: 'a0', fromPort: 'y', to: 'x1', toPort: 0 }, { from: 'q1', fromPort: 'q', to: 'x1', toPort: 1 },
            { from: 'x1', fromPort: 'y', to: 'q1', toPort: 0 }
          ]
        },
        stimulus: [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0],
        /* Independent oracle: the count before edge i is the number of earlier EN=1 vectors, mod 4. */
        expectedWave: (function () {
          var en = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0];
          var b0 = [], b1 = [], seen = 0;
          for (var i = 0; i < en.length; i += 1) { var c = seen % 4; b0.push(c & 1); b1.push((c >> 1) & 1); seen += en[i]; }
          return { b0: b0, b1: b1 };
        })()
      }
    ),
    majorityVoter: preset(
      'majorityVoter', 'Majority voter',
      'Triple modular redundant majority voter. Output is high when at least two of three inputs agree high.',
      3, ['A', 'B', 'C'], [3, 5, 6, 7], [],
      'A & B | B & C | A & C',
      { outputName: 'vote', moduleName: 'majority3' }
    ),
    grayCodeConverter: preset(
      'grayCodeConverter', 'Gray code converter',
      'Bit 2 of a four bit binary to reflected Gray code converter, G2 = B2 XOR B3.',
      4, ['B3', 'B2', 'B1', 'B0'], [4, 5, 6, 7, 8, 9, 10, 11], [],
      'B3 ^ B2',
      { outputName: 'G2', moduleName: 'gray_bit2' }
    )
  };

  function aluSliceNetlist() {
    return {
      inputs: ['A', 'B', 'CIN', 'OP'],
      outputs: [{ node: 'fa', port: 'sum', name: 'result' }, { node: 'fa', port: 'carry', name: 'cout' }],
      nodes: [
        { id: 'xor_op', type: 'XOR' },
        { id: 'fa', type: 'FULL_ADDER' }
      ],
      edges: [
        { from: 'IN:A', to: 'xor_op', toPort: 0 },
        { from: 'IN:OP', to: 'xor_op', toPort: 1 },
        { from: 'xor_op', fromPort: 'y', to: 'fa', toPort: 1 },
        { from: 'IN:B', to: 'fa', toPort: 0 },
        { from: 'IN:CIN', to: 'fa', toPort: 2 }
      ]
    };
  }

  function carryLookaheadNetlist() {
    var nodes = [], edges = [];
    function gate(id, type, a, b) {
      nodes.push({ id: id, type: type });
      edges.push({ from: a, to: id, toPort: 0 });
      edges.push({ from: b, to: id, toPort: 1 });
      return id;
    }
    for (var i = 0; i < 4; i++) {
      gate('p' + i, 'XOR', 'IN:A' + i, 'IN:B' + i);
      gate('g' + i, 'AND', 'IN:A' + i, 'IN:B' + i);
    }
    var p32 = gate('p32', 'AND', 'p3', 'p2');
    var p321 = gate('p321', 'AND', p32, 'p1');
    var p3210 = gate('p3210', 'AND', p321, 'p0');
    var t2 = gate('t2', 'AND', 'p3', 'g2');
    var t1 = gate('t1', 'AND', p32, 'g1');
    var t0 = gate('t0', 'AND', p321, 'g0');
    var tc = gate('tc', 'AND', p3210, 'IN:CIN');
    var s32 = gate('s32', 'OR', 'g3', t2);
    var s10 = gate('s10', 'OR', t1, t0);
    var s = gate('s', 'OR', s32, s10);
    gate('C4', 'OR', s, tc);
    return {
      inputs: ['A0', 'B0', 'A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'CIN'],
      outputs: [{ node: 'C4', port: 'y', name: 'C4' }], nodes: nodes, edges: edges
    };
  }

  function getPreset(name) {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, name)) throw LogicError('unknown preset: ' + name);
    return JSON.parse(JSON.stringify(PRESETS[name]));
  }

  function listPresets() {
    return Object.keys(PRESETS).map(function (k) {
      return { id: k, label: PRESETS[k].label, description: PRESETS[k].description, numVars: PRESETS[k].numVars };
    });
  }

  /* Preset truth tables and netlist helpers. */
  function presetTruthTable(name) {
    var p = getPreset(name);
    if (name === 'carryLookahead4Bit') {
      var outputs = [];
      for (var m = 0; m < 512; m += 1) {
        /* Vector bit order: A0 B0 A1 B1 A2 B2 A3 B3 CIN, most significant first. */
        var a = 0, b = 0;
        for (var bit = 0; bit < 4; bit += 1) {
          a |= (((m >> (8 - 2 * bit)) & 1) << bit);
          b |= (((m >> (7 - 2 * bit)) & 1) << bit);
        }
        outputs.push((a + b + (m & 1)) >= 16 ? 1 : 0);
      }
      return outputs;
    }
    if (name === 'alu4BitSlice') {
      /* Independent oracle: the slice computes sum = B ^ (A ^ OP) ^ CIN
         for input order A, B, CIN, OP (most significant vector bit first). */
      var slice = [];
      for (var v = 0; v < 16; v += 1) {
        var av = (v >> 3) & 1, bv = (v >> 2) & 1, cin = (v >> 1) & 1, op = v & 1;
        slice.push(bv ^ (av ^ op) ^ cin);
      }
      return slice;
    }
    var size = 1 << p.numVars;
    var table = new Array(size).fill(0);
    p.minterms.forEach(function (m) { table[m] = 1; });
    return table;
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */

  return {
    version: '2.0.0',
    MAX_VARS: MAX_VARS,
    LogicError: LogicError,
    parseExpr: parseExpr,
    evalTruthTable: evalTruthTable,
    parseMintermList: parseMintermList,
    fromMinterms: fromMinterms,
    minimizeBoolean: minimizeBoolean,
    primeImplicants: primeImplicants,
    karnaughMap: karnaughMap,
    simulateNetlist: simulateNetlist,
    detectCycles: detectCycles,
    exportVerilog: exportVerilog,
    verifyVerilog: verifyVerilog,
    exportVerificationJSON: exportVerificationJSON,
    presets: PRESETS,
    getPreset: getPreset,
    listPresets: listPresets,
    presetTruthTable: presetTruthTable,
    GATE_TYPES: Object.keys(GATE_DEFS),
    truthTableFromExpression: function (expr, vars) { return evalTruthTable(expr, vars); },
    solvePetrick: function (numVars, minterms, dontCares, options) { return minimizeBoolean(numVars, minterms, dontCares, options); }
  };
});
