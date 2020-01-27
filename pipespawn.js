/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX, async = require('async'), intRgx = /^\d+$/,
  obAss = Object.assign,
  ifFun = require('if-fun'),
  cpSpawn = require('child_process').spawn,
  futureOn = require('future-on-pmb'),
  promisify = require('pify'),
  callbackTimeoutFlexible = require('callback-timeout-flexible'),
  unixPipe = require('unix-pipe'),
  pipeFx = require('./src/pipefx/fx.js');


function isNum(x, no) { return ((x === +x) || no); }
function isPosNum(x) { return (isNum(x) && (x > 0)); }
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



EX = function pipespawn(spec, whenChildGone) {
  if (!whenChildGone) { return promisify(pipespawn)(spec); }
  if (spec && spec.substr) { spec = [spec]; }
  var meta = { cmd: [], pipes: [], errors: [],
    chEv: obAss(futureOn({ dis1: true }), {
      endStreams: [],
      activeTimeoutCbs: {},
      reallyGone: whenChildGone,
    }),
    opt: obAss({}, EX.defaultOpts) };
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


EX.defaultOpts = {
  softTimeoutSec: false,
  softTimeoutSig: 'TERM',
  hardTimeoutSec: false,
  hardTimeoutSig: 'KILL',
};


EX.scanOpt = function (meta, nxOpt) {
  if ((nxOpt && typeof nxOpt) === 'object') {
    if (Array.isArray(nxOpt)) {
      arrAppend(meta.cmd, nxOpt);
      return meta;
    }
    obAss(meta.opt, nxOpt);
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
    var t = pipeFx.typ3of(v), n, fx;
    v = (t === 'obj' ? obAss({}, v) : { what: v });
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
    fx = pipeFx.translateFdWhat(v);
    obAss(v, fx);
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
    opt.env = obAss({}, opt.env, { LANG: opt.lang, LANGUAGE: opt.lang });
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
  meta.chEv.sub(child);
  child.name = (opt.name || cmd.join(' ').substr(0, 128));
  EX.setupBasicChildApi(meta);
  if (meta.errors.length) {
    EX.issueDeathCert(child, { retval: 127, signal: null,
        code: (meta.errors[0].code || 'E_STILLBORN'), stillborn: true });
    return then(meta.errors[0]);
  }

  child.on('error', function (err) { meta.errors.push(err); });
  EX.installExitObservers(child);
  EX.preparePipesPostnatal(meta);
  EX.setupKillTimeouts(meta);

  mapOrCallIf(meta.opt.onSpawn, function (hnd) { hnd(meta); });
  then();
};


EX.setupBasicChildApi = function (meta) {
  var child = meta.child;
  child.cry = function (why) { child.emit('error', new Error(why)); };
  child.pipes = function (n) {
    if (n === undefined) { return meta.pipes; }
    return (meta.pipes[n === +n ? 'byCfd' : 'byName'][n] || false);
  };
};


EX.buryChild = function (meta) {
  function notifyParent() {
    var err = EX.combineChildErrorsWhenDone(meta), cb = meta.chEv.reallyGone;
    if (err && (!cb)) { throw err; }
    setImmediate(function () { cb(err || false, meta.child || null); });
  }

  async.series([
    curry1(EX.cleanupFDs, meta),
  ], meta.stashAwayError(notifyParent));
};


EX.cleanupFDs = function (meta, then) {
  meta.chEv.endStreams.forEach(function (st) {
    console.log('endStream now:', { fd: st.fd, end: st.end && typeof st.end });
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

  mapOrCallIf(meta.opt.onPreparePipes, function (hnd) { hnd(meta); });
  errs = ((errs.length > 0) && new Error('Failed to prepare pipes: ' +
    errs.join('\n')));
  return then(errs);
};


EX.installUnixPipe = function (p, ourIntent) {
  var stm = unixPipe.oneStream(ourIntent);
  p.stream = stm;
  p.nodeMode = stm.peerFd;
};


EX.preparePipesPostnatal = function (meta) {
  var child = meta.child;
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


EX.setupKillTimeouts = function (meta) {
  var atc = meta.chEv.activeTimeoutCbs, opt = meta.opt;
  ['soft', 'hard'].forEach(function setupTmo(name) {
    name += 'Timeout';
    var key = name + 'Sec', sec = opt[key], sig = 'SIG' + opt[name + 'Sig'];
    if (sec === false) { return; }
    if (!isPosNum(sec)) {
      throw new TypeError(key + ' must be false or a positive number');
    }
    function killItNow() {
      console.debug(name, 'kill', sec, sig);
      meta.child.kill(sig);
    }
    atc[name] = callbackTimeoutFlexible(killItNow, {
      limitSec: sec,
      name: String(meta.child) + ' ' + name,
    }).timeout;
  });
  meta.chEv.asap('exit', function abandonKillTimers() {
    Object.values(atc).forEach(function (tmo) { tmo.abandon(); });
  });
};


function makeObserverName(obs) {
  if (obs.fxName) { return (obs.fxName + '|' + obs.fdName); }
  if (obs.name) { return obs.name; }
  return false;
}


EX.waitForAllObservers = function (meta, whenAllObs) {
  var active = {}, tmoCb;
  meta.chEv.activeObservers = active;
  EX.makeObservers(meta).forEach(function add(obs, idx) {
    function wrap(cb) {
      // console.log('wait4obs go!', wrap.id);
      obs(function observerDone(err) {
        if (err) { meta.errors.push(err); }
        // console.log('wait4obs done:', wrap.id);
        delete active[wrap.id];
        cb();
      });
    }
    wrap.id = idx + '#' + makeObserverName(obs);
    active[wrap.id] = wrap;
  });
  tmoCb = callbackTimeoutFlexible(whenAllObs, {
    limitSec: 10,
    name: 'waitForAllObserversTimeout',
    autostart: false,
  });
  meta.chEv.asap('exit', function () { tmoCb.timeout.renew(true); });
  async.parallel(Object.values(active), tmoCb);
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
  var child = meta.child, errs = (meta.errors || false), e1;
  if (!errs.length) { return false; }
  e1 = errs[0];
  e1 = [ 'Spawned child had ' + errs.length + ' errors. ' +
    'Check the .errors and .child properties of this error.',
    'First message: ' + String(e1.message || e1),
    'Child name: ' + child.name,
    ].join('\n');
  e1 = new Error(e1);
  e1.errors = errs;
  e1.child = child;
  return e1;
};






















module.exports = EX;
