var Shell = {};

(function () {
  var CONTROL = '(?:' + [
    '\\|\\|', '\\&\\&', ';;', '\\|\\&', '[&;()|<>]'
  ].join('|') + ')';
  var META = '|&;()<> \\t';
  var BAREWORD = '(\\\\[\'"' + META + ']|[^\\s\'"' + META + '])+';
  var SINGLE_QUOTE = '"((\\\\"|[^"])*?)"';
  var DOUBLE_QUOTE = '\'((\\\\\'|[^\'])*?)\'';

  var TOKEN = '';
  for (var i = 0; i < 4; i++) {
    TOKEN += (Math.pow(16, 8) * Math.random()).toString(16);
  }

  function filter (arr, fn, self) {
    if (arr.filter) return arr.filter(fn, self);
    if (void 0 === arr || null === arr) throw new TypeError;
    if ('function' != typeof fn) throw new TypeError;
    var ret = [];
    for (var i = 0; i < arr.length; i++) {
      if (!hasOwn.call(arr, i)) continue;
      var val = arr[i];
      if (fn.call(self, val, i, arr)) ret.push(val);
    }
    return ret;
  };

  function map (xs, f) {
    if (xs.map) return xs.map(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        var x = xs[i];
        if (hasOwn.call(xs, i)) res.push(f(x, i, xs));
    }
    return res;
  };

  function parse(s, env, opts) {
    var chunker = new RegExp([
      '(' + CONTROL + ')', // control chars
      '(' + BAREWORD + '|' + SINGLE_QUOTE + '|' + DOUBLE_QUOTE + ')*'
    ].join('|'), 'g');
    var match = filter(s.match(chunker), Boolean);
    var commented = false;

    if (!match) return [];
    if (!env) env = {};
    if (!opts) opts = {};
    return map(match, function (s, j) {
      if (commented) {
        return;
      }
      if (RegExp('^' + CONTROL + '$').test(s)) {
        return { op: s };
      }

      // Hand-written scanner/parser for Bash quoting rules:
      //
      //  1. inside single quotes, all characters are printed literally.
      //  2. inside double quotes, all characters are printed literally
      //     except variables prefixed by '$' and backslashes followed by
      //     either a double quote or another backslash.
      //  3. outside of any quotes, backslashes are treated as escape
      //     characters and not printed (unless they are themselves escaped)
      //  4. quote context can switch mid-token if there is no whitespace
      //     between the two quote contexts (e.g. all'one'"token" parses as
      //     "allonetoken")
      var SQ = "'";
      var DQ = '"';
      var DS = '$';
      var BS = opts.escape || '\\';
      var quote = false;
      var esc = false;
      var out = '';
      var isGlob = false;

      for (var i = 0, len = s.length; i < len; i++) {
        var c = s.charAt(i);
        isGlob = isGlob || (!quote && (c === '*' || c === '?'));
        if (esc) {
          out += c;
          esc = false;
        }
        else if (quote) {
          if (c === quote) {
            quote = false;
          }
          else if (quote == SQ) {
            out += c;
          }
          else { // Double quote
            if (c === BS) {
              i += 1;
              c = s.charAt(i);
              if (c === DQ || c === BS || c === DS) {
                out += c;
              } else {
                out += BS + c;
              }
            }
            else if (c === DS) {
              out += parseEnvVar();
            }
            else {
              out += c;
            }
          }
        }
        else if (c === DQ || c === SQ) {
          quote = c;
        }
        else if (RegExp('^' + CONTROL + '$').test(c)) {
          return { op: s };
        }
        else if (RegExp('^#$').test(c)) {
          commented = true;
          if (out.length) {
            return [out, { comment: s.slice(i + 1) + match.slice(j + 1).join(' ') }];
          }
          return [{ comment: s.slice(i + 1) + match.slice(j + 1).join(' ') }];
        }
        else if (c === BS) {
          esc = true;
        }
        else if (c === DS) {
          out += parseEnvVar();
        }
        else out += c;
      }

      if (isGlob) return { op: 'glob', pattern: out };

      return out;

      function parseEnvVar() {
        i += 1;
        var varend, varname;
        //debugger
        if (s.charAt(i) === '{') {
          i += 1;
          if (s.charAt(i) === '}') {
            throw new Error("Bad substitution: " + s.substr(i - 2, 3));
          }
          varend = s.indexOf('}', i);
          if (varend < 0) {
            throw new Error("Bad substitution: " + s.substr(i));
          }
          varname = s.substr(i, varend - i);
          i = varend;
        }
        else if (/[*@#?$!_\-]/.test(s.charAt(i))) {
          varname = s.charAt(i);
          i += 1;
        }
        else {
          varend = s.substr(i).match(/[^\w\d_]/);
          if (!varend) {
            varname = s.substr(i);
            i = s.length;
          } else {
            varname = s.substr(i, varend.index);
            i += varend.index - 1;
          }
        }
        return getVar(null, '', varname);
      }
    })
      // finalize parsed aruments
      .reduce(function (prev, arg) {
        if (arg === undefined) {
          return prev;
        }
        return prev.concat(arg);
      }, []);

    function getVar(_, pre, key) {
      var r = typeof env === 'function' ? env(key) : env[key];
      if (r === undefined) r = '';

      if (typeof r === 'object') {
        return pre + TOKEN + json.stringify(r) + TOKEN;
      }
      else return pre + r;
    }
  }

  Shell.parse = function (s, env, opts) {
    var mapped = parse(s, env, opts);
    if (typeof env !== 'function') return mapped;
    return reduce(mapped, function (acc, s) {
      if (typeof s === 'object') return acc.concat(s);
      var xs = s.split(RegExp('(' + TOKEN + '.*?' + TOKEN + ')', 'g'));
      if (xs.length === 1) return acc.concat(xs[0]);
      return acc.concat(map(filter(xs, Boolean), function (x) {
        if (RegExp('^' + TOKEN).test(x)) {
          return json.parse(x.split(TOKEN)[1]);
        }
        else return x;
      }));
    }, []);
  };
})();


