/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX, async = require('async'), intRgx = /^\d+$/,
  cpSpawn = require('child_process').spawn,
  futureOn = require('future-on-pmb'),
  observeStreamEvents = require('log-stream-events-pmb'),
  unixPipe = require('unix-pipe'),
  pipeFx = require('./src/pipefx/fx.js');


function ifObj(x, d) { return ((x && typeof x) === 'object' ? x : d); }
function isNum(x, no) { return ((x === +x) || no); }
function ifFun(x, d) { return ((typeof x) === 'function' ? x : d); }
function sortedKeys(o) { return Object.keys(o).sort(); }
function fail(why) { throw new Error(why); }
function mapOrCallIf(x, f) { return (x && (x.map ? x.map(f) : f(x))); }
function str1ln(x) { return String(x).split(/\s*\{?\n/)[0]; }
function curry1(cb, a1) { return function (nx) { return cb(a1, nx); }; }

function arrAppend(dest, src) {
  dest.push.apply(dest, src);
  return dest;
}

function mapKV(o, f) {
  return o && sortedKeys(o).map(function (k) { return f(k, o[k]); });
}



EX = function (spec, whenChildGone) {
  if (spec && spec.substr) { spec = [spec]; }
  var meta, chEv = futureOn({ dis1: true });
  meta = { cmd: [], opt: {}, pipes: [], errors: [], chEv: chEv };
  chEv.endStreams = [];
  chEv.reallyGone = whenChildGone;
  spec.reduce(EX.scanOpt, meta);
  EX.scanFdPipeOpts(meta);
  EX.optimizeOptions(meta.opt);
  if (!meta.cmd[0]) { fail('No command name given'); }

  meta.stashAwayError = function (cb) {
    return function (err, x, y) {
      var elist = meta.errors;
      if (err && (elist.indexOf(err) === -1)) { elist.unshift(err); }
      cb(x, y);
    };
  };

  async.series([
    curry1(EX.preparePipesPrenatal, meta),
    curry1(EX.actuallySpawn, meta),
    curry1(EX.waitForAllObservers, meta),
  ], meta.stashAwayError(curry1(EX.buryChild, meta)));
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
    if (pp.byCfd[n]) { fail('Duplicate child file descriptor number: ' + n); }
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
  s = /^cfd(\d+)$/.exec(s);
  return (s ? +s[1] : null);
};


EX.optimizeOptions = function (opt) {
  if (opt.lang) {
    opt.env = Object.assign({}, opt.env,
      { LANG: opt.lang, LANGUAGE: opt.lang });
  }
};


EX.actuallySpawn = function (meta, then) {
  var child, cmd = meta.cmd, opt = meta.opt, stdio = opt.stdio;
  if (!stdio) { stdio = opt.stdio = []; }

  meta.pipes.forEach(function (p) {
    if (p.endStream) { meta.chEv.endStreams.push(p.endStream); }
    var nm = p.nodeMode;
    if (nm === undefined) { return; }
    stdio[p.cfd] = nm;
  });
  EX.fillUndefArraySlots(stdio, null);

  try {
    child = cpSpawn(cmd[0], cmd.slice(1), opt);
  } catch (spawnErr) {
    child = {};
    meta.errors.push(spawnErr);
  }
  meta.child = child;
  child.name = (opt.name || cmd.join(' ').substr(0, 128));
  if (meta.errors.length) {
    EX.issueDeathCert(child, { retval: 127, signal: null,
        code: (meta.errors[0].code || 'E_STILLBORN'), stillborn: true });
    return then(meta.errors[0]);
  }

  observeStreamEvents(child, 'child');
  //observeStreamEvents(child.stdin, 'stdin');

  child.on('error', function (err) { meta.errors.push(err); });
  child.cry = function (why) { child.emit('error', new Error(why)); };
  EX.installExitObservers(child);
  EX.preparePipesPostnatal(meta);
  mapOrCallIf(meta.opt.onspawn, function (hnd) { hnd(child); });

  then();
};


EX.buryChild = function (meta) {
  function notifyParent() {
    var err = EX.combineChildErrorsWhenDone(meta), cb = meta.chEv.reallyGone;
    if (err && (!cb)) { throw err; }
    setImmediate(cb, (err || false), (meta.child || null));
  }

  async.series([
    curry1(EX.cleanupFDs, meta),
  ], meta.stashAwayError(notifyParent));
};


EX.cleanupFDs = function (meta, then) {
  meta.chEv.endStreams.forEach(function (st) {
    if (ifFun(st.end)) {
      try { st.end(); } catch (ignore) {}
      return;
    }
  });
  then();
};


EX.installExitObservers = function (child) {
  child.causeOfDeath = null;
  if (isNum(child.pid)) {
    child.on('exit', function (retval, signal) {
      EX.issueDeathCert(child, { retval: retval, signal: signal,
        code: null, stillborn: false });
    });
  } else {
    child.once('error', function (err) {
      EX.issueDeathCert(child, { retval: 127, signal: null,
        code: (err.code || 'E_STILLBORN'), stillborn: true });
    });
  }
};


EX.issueDeathCert = function (child, cause) {
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
  var pipeStream = unixPipe.oneStream(ourIntent);
  observeStreamEvents(pipeStream, p.name + '|');
  p.stream = pipeStream;
  //p.endStream = pipeStream.peer;
  console.log(p.name + '|', pipeStream.fd, pipeStream.peerFd);
  p.nodeMode = pipeStream.peerFd;
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


EX.waitForAllObservers = function (meta, whenAllObs) {
  var obs = EX.makeObservers(meta);

  function remindObsNoFail(err) {
    if (err) {
      meta.errors = [new Error('Observers should cry, not abort!'),
        err].concat(meta.errors);
      // … because abort by one observer might hide errors from other
      // observers, thereby serializing debug efforts to one error per try.
    }
    return whenAllObs();
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
    meta.chEv.asap('exit', autopsy);
  });

  meta.pipes.forEach(function (pipe) {
    var fx = pipe.fx, o = (fx && pipeFx.prepareObserver(fx, pipe, meta));
    if (o) { obs.push(o); }
  });

  return obs;
};


EX.combineChildErrorsWhenDone = function (meta) {
  var child = meta.child, errs = (meta.errors || []), e1;
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
