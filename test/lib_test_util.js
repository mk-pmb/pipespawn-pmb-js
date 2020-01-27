/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX = {}, fs = require('fs'), equal = require('equal-pmb'),
  callbackTimeoutFlexible = require('callback-timeout-flexible'),
  observeStreamEvents = require('log-stream-events-pmb'),
  wtfnode = require('wtfnode'),
  cryptoLib = require('crypto'),
  testDir = require('absdir')(module);


function fixture(id) {
  if (!fixture[id]) { throw new Error('fixture not loaded: ' + id); }
  return fixture[id].data;
}
EX.fixture = fixture;
fixture.path = function (fn) { return testDir + '/fixtures/' + fn; };
fixture.load = function (fixt, then) {
  var fn = fixt.fn;
  fixture[fn] = fixt;
  fs.readFile(fixture.path(fn), (fixt.enc || null), function (err, data) {
    fixt.err = err;
    fixt.data = data;
    then(err);
  });
};
fixture.bufferEqual = function (buf, fixtName) {
  if (!Buffer.isBuffer(buf)) { throw new TypeError('not a buffer'); }
  var want = fixture(fixtName);
  require('fs')['writeFile' + (equal && 'Sync')]('out', buf);
  equal(buf.length, want.length);
  console.debug('buf cmp go!', fixtName);
  if (want.equals(buf)) {
    console.debug('buf cmp same!', fixtName);
    return null;
  }
  console.debug('buf cmp nope!', fixtName);
  equal('buffer data', 'fixture');
};


EX.enumerateArray = function (a) {
  return JSON.stringify(Object.assign({}, a), null, 1
    ).replace(/(\n\s*)"(\d+)":/g, '$1$2:'
    ).replace(/\s+/g, ' ');
};


EX.asyncLog = function () {
  var a = arguments;
  return function (then) {
    console.log.apply(console, a);
    return then();
  };
};


EX.wtfkillSoon = function () {
  setTimeout(function () {
    wtfnode.dump();
    process.exit(1);
  }, 1e3);
};


EX.tmo = function (sec, func) {
  return callbackTimeoutFlexible(func, {
    limitSec: sec,
    obBeforeTimeout: EX.wtfkillSoon,
  });
};


function describeStreamMode(stm) {
  return (((stm.readable ? 'r' : '') + (stm.writable ? 'w' : '')) || '-');
}


EX.debugIO = {
  onSpawnChild: function monitorChild(meta) {
    var child = meta.child;
    console.debug('spawned child pid', child.pid);
    observeStreamEvents(child, 'child');
  },
  onPreparePipes: function monitorPipes(meta) {
    meta.pipes.forEach(function (p) {
      var stm = p.stream, descr = p.name + '¦' + describeStreamMode(stm);
      console.debug(descr, { ourFd: stm.fd, peerFd: stm.peerFd });
      observeStreamEvents(stm, descr);
    });
  },
};


EX.sha1hex = function (x) {
  var hash = cryptoLib.createHash('sha1');
  hash.update(x);
  return hash.digest('hex');
};














module.exports = EX;
