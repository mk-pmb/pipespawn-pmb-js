/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX = {}, fxCore = require('./core'), addons,
  ifFun = require('if-fun');

addons = [
  fxCore,
  { send: require('./send') },
  { collect: require('./collect') },
];


EX.translateFdWhat = function (fd) {
  var w = fd.what, t = fxCore.typ3of(w);
  function fail(why) { throw new Error(why + ' for FD ' + fd.name); }
  if (t === 'num') { return { nodeMode: w }; }
  if (!w) { return { nodeMode: w }; }
  if (t === 'str') {
    if (w === 'pipe') { fail('Unsupported transport mechanism: ' + w); }
    if (w === 'ign') { return { nodeMode: 'ignore' }; }
    if (w === 'sock') { return { makePipe: 's' }; }
    if (w === 'buf') { return { makePipe: 'r', fx: 'collect' }; }
    if (w === 'str') {
      return { makePipe: 'r', fx: 'collect', encoding: 'UTF-8' };
    }
    return { nodeMode: w };
  }
  if (t === 'buf') { w = [w, null]; }
  if (w.pipe) { w = [w]; }
  fd.what = w;
  if (w.forEach) { return { makePipe: 'w', fx: 'send' }; }
  return false;
};


EX.prepareObserver = function (fxName, fdfx, meta) {
  var fxFunc = ifFun(EX[fxName]), obs;
  if (!fxFunc) {
    meta.child.cry('Unsupported fdfx: ' + fxName);
    return null;
  }
  obs = function pipeFxObserver(done) {
    done.fdName = fdfx.name;
    fxFunc.call(meta, fdfx, done);
  };
  obs.fdName = fdfx.name;
  obs.fxName = fxName;
  return obs;
};


















module.exports = Object.assign.apply(null, [EX].concat(addons));
