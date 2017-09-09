/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX, async = require('async'), intRgx = /^\d+$/,
  cpSpawn = require('child_process').spawn,
  lateOnce = require('late-once-pmb'),
  observeStreamEvents = require('log-stream-events-pmb'),
  unixPipe = require('unix-pipe'),
  pipeFx = require('./src/pipefx/fx.js');


function ifObj(x, d) { return ((x && typeof x) === 'object' ? x : d); }
function isNum(x, no) { return ((x === +x) || no); }
function sortedKeys(o) { return Object.keys(o).sort(); }
function fail(why) { throw new Error(why); }
function mapOrCallIf(x, f) { return (x && (x.map ? x.map(f) : f(x))); }
function str1ln(x) { return String(x).split(/\s*\{?\n/)[0]; }

function arrAppend(dest, src) {
  dest.push.apply(dest, src);
  return dest;
}

function mapKV(o, f) {
  return o && sortedKeys(o).map(function (k) { return f(k, o[k]); });
}


EX = function (spec, whenChildGone) {
  if (spec && spec.substr) { spec = [spec]; }
  var meta = { cmd: [], opt: {}, pipes: [] };
  spec.reduce(EX.scanOpt, meta);
  EX.scanFdPipeOpts(meta);
  EX.optimizeOptions(meta.opt);
  if (!meta.cmd[0]) { fail('No command name given'); }
  async.series([
    function (then) { return EX.preparePipesPrenatal(meta, then); },
    function (then) { return EX.actuallySpawn(meta, then); },
    function (then) { return EX.waitForAllObservers(meta, then); },
  ], function (err) { return EX.childGone(meta, err, whenChildGone); });
};


EX.scanOpt = function (meta, nxOpt) {
  if ((nxOpt && typeof nxOpt) === 'object') {
    if (Array.isArray(nxOpt)) {
      arrAppend(meta.cmd, nxOpt);
      return meta;
    }
    Object.assign(meta.opt, nxOpt);
    return meta;
  }
  meta.cmd.push(String(nxOpt));
  return meta;
};


EX.scanFdPipeOpts = function (meta) {
  var pp = meta.pipes;
  pp.byName = {};
  pp.byCfd = {};

  function addPipe(k, v) {
    var t = pipeFx.typ3of(v), n;
    v = (t === 'obj' ? Object.assign({}, v) : { what: v });
    n = v.cfd;
    if (n !== +n) { n = v.cfd = EX.fdStr2Num(k); }
    k = String(v.name || k);
    if (intRgx.exec(k)) { fail('Pipe name must contain a non-digit'); }
    if (pp.byName[k]) { fail('Duplicate file descriptor name: ' + k); }
    v.name = k;
    if (n !== +n) { fail('Child file descriptor number required for ' + k); }
    if (pp.byCfd[n]) { fail('Duplicate file descriptor number: ' + n); }
    pp.byCfd[n] = pp.byName[k] = v;
    pp.push(v);
    Object.assign(v, pipeFx.translateFdWhat(v));
  }

  mapKV(meta.opt.pipes, addPipe);
  mapKV(meta.opt, function (k, v) {
    var n = EX.fdStr2Num(k);
    if (n !== +n) { return; }
    addPipe(k, v);
  });
  pp.names = sortedKeys(pp.byName);
  pp.cfds = sortedKeys(pp.byCfd);
};


EX.fillUndefArraySlots = function (a, v) {
  var i, l = a.length;
  for (i = 0; i < l; i += 1) {
    if (a[i] === undefined) { a[i] = v; }
  }
  return a;
};


EX.fdStr2Num = function (s) {
  if (s === 'stdin') { return 0; }
  if (s === 'stdout') { return 1; }
  if (s === 'stderr') { return 2; }
  s = /^fd(\d+)$/.exec(s);
  return (s ? +s[1] : null);
};


EX.optimizeOptions = function (opt) {
  if (opt.lang) {
    opt.env = Object.assign({}, opt.env,
      { LANG: opt.lang, LANGUAGE: opt.lang });
  }
};


EX.actuallySpawn = function (meta, then) {
  var child, cmd = meta.cmd, opt = meta.opt, stdio = opt.stdio,
    endStreams = [];
  if (!stdio) { stdio = opt.stdio = []; }

  meta.pipes.forEach(function (p) {
    if (p.endStream) { endStreams.push(p.endStream); }
    var nm = p.nodeMode;
    if (nm === undefined) { return; }
    stdio[p.cfd] = nm;
  });
  EX.fillUndefArraySlots(stdio, null);

  try {
    child = cpSpawn(cmd[0], cmd.slice(1), opt);
    child.errors = [];
  } catch (spawnErr) {
    child = { errors: [spawnErr] };
  }
  meta.child = child;
  child.name = (opt.name || cmd.join(' ').substr(0, 128));
  if (endStreams.length) { setImmediate(EX.tryEndStreams, endStreams); }
  if (child.errors.length) {
    EX.buryChild(child, { retval: 127, signal: null,
        code: (child.errors[0].code || 'E_STILLBORN'), stillborn: true });
    return then(child.errors[0]);
  }

  observeStreamEvents(child, 'child');
  //observeStreamEvents(child.stdin, 'stdin');

  child.on('error', function (err) { child.errors.push(err); });
  child.cry = function (why) { child.emit('error', new Error(why)); };
  EX.installExitObservers(child);
  EX.preparePipesPostnatal(meta);
  mapOrCallIf(meta.opt.onspawn, function (hnd) { hnd(child); });

  then();
};


EX.tryEndStreams = function (streams) {
  streams.forEach(function (st) {
    try { st.end(); } catch (ignore) {}
  });
};


EX.installExitObservers = function (child) {
  child.once.dying = lateOnce(child, 'exit');
  child.once.finished = lateOnce(child, 'finished');
  child.causeOfDeath = null;
  if (isNum(child.pid)) {
    child.on('exit', function (retval, signal) {
      EX.buryChild(child, { retval: retval, signal: signal,
        code: null, stillborn: false });
    });
  } else {
    child.once('error', function (err) {
      EX.buryChild(child, { retval: 127, signal: null,
        code: (err.code || 'E_STILLBORN'), stillborn: true });
    });
  }
};


EX.buryChild = function (child, cause) {
  if (child.causeOfDeath) { return child.cry('Duplicate exit event'); }
  cause.why = (cause.signal || cause.code || cause.retval);
  child.causeOfDeath = cause;
};


EX.preparePipesPrenatal = function (meta, then) {
  // This function's async callback API is just preparation for future
  // transports that might need it, e.g. temporary files on platforms
  // that can't pipe().
  var errs = [];

  function translateNodeMode(p) {
    var t = p.makePipe;
    if (!t) { return; }
    if (t === 's') { return 'pipe'; }   // socket
    if ((t === 'r') || (t === 'w')) { return EX.installUnixPipe(p, t); }
    errs.push('Unsupported mode "' + t + '" for .makePipe for pipe ' + p.name);
  }
  meta.pipes.forEach(function (p) {
    var nm = translateNodeMode(p);
    if (nm !== undefined) { p.nodeMode = nm; }
  });

  errs = ((errs.length > 0) && new Error('Failed to prepare pipes: ' +
    errs.join('\n')));
  return then(errs);
};


EX.installUnixPipe = function (p, ourIntent) {
  var warp = unixPipe();
  observeStreamEvents(warp.rd, p.name + '|->');
  observeStreamEvents(warp.wr, p.name + '->|');
  if (ourIntent === 'r') {
    p.stream = warp.rd;
    p.endStream = p.nodeMode = warp.wr;
    return;
  }
  if (ourIntent === 'w') {
    p.stream = warp.wr;
    p.endStream = p.nodeMode = warp.rd;
    return;
  }
  fail('ourIntent must be either "r" or "w".');
};


EX.preparePipesPostnatal = function (meta) {
  var child = meta.child;

  child.pipes = function (n) {
    if (n === undefined) { return meta.pipes; }
    return (meta.pipes[n === +n ? 'byCfd' : 'byName'][n] || false);
  };

  meta.pipes.forEach(function (p) {
    var mk = p.makePipe, stream = p.stream;
    if (!mk) { return; }
    if (mk === 's') { stream = p.stream = child.stdio[p.cfd]; }
    if (!stream) { fail('No stream for pipe ' + p.name); }
    stream.hadError = false;
    stream.on('error', function (err) {
      if (!stream.hadError) { stream.hadError = err; }
      err.message += ' on pipe ' + p.name;
      child.cry(err);
    });
    mapOrCallIf(p.cc, function installCarbonCopy(dest) { stream.pipe(dest); });
  });
};


EX.waitForAllObservers = function (meta, then) {
  var obs = EX.makeObservers(meta);

  function remindObsNoFail(err) {
    var child = meta.child;
    if (err) {
      child.errors = [new Error('Observers should cry, not abort!'),
        err].concat(child.errors);
      // … because abort by one observer might hide errors from other
      // observers, thereby serializing debug efforts to one error per try.
    }
    return then(err);
  }

  return async.parallel(obs, remindObsNoFail);
};


EX.makeObservers = function (meta) {
  var obs = [], child = meta.child, opt = meta.opt;
  if (!isNum(child.pid)) { return obs; }

  obs.push(function scheduleAutopsy(then) {
    function autopsy() {
      var cause = child.causeOfDeath, want = (+opt.exitCode || 0);
      if (cause.why !== want) {
        child.cry('Expected exit reason ' + want + ' but got ' + cause.why);
      }
      then();
    }
    child.once.dying(autopsy);
  });

  meta.pipes.forEach(function (pipe) {
    var fx = pipe.fx, o = (fx && pipeFx.prepareObserver(fx, pipe, meta));
    if (o) { obs.push(o); }
  });

  return obs;
};


EX.childGone = function (meta, err, whenGone) {
  var child = meta.child;
  err = EX.combineChildErrorsWhenDone(child, err);
  if (err && (!whenGone)) { throw err; }
  setImmediate(whenGone, (err || false), (child || null));
};


EX.combineChildErrorsWhenDone = function (child, cbErr) {
  if (!child) { return cbErr; }
  var errs = (child.errors || []), e1;
  if (cbErr && (errs.indexOf(cbErr) < 0)) { errs = [cbErr].concat(errs); }
  if (!errs.length) { return false; }
  e1 = errs[0];
  e1 = [ 'Spawned child had ' + errs.length + ' errors. ' +
    'Check the .errors and .child properties of this error.',
    'First message: ' + String(e1.message || e1),
    'Child name: ' + child.name,
    ].join('\n');
  e1 = new Error(e1);
  e1.errs = errs;
  e1.child = child;
  return e1;
};






















module.exports = EX;
