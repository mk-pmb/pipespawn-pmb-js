/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX = {}, isAry = Array.isArray, isBuf = Buffer.isBuffer;


EX.typ3of = function (x) {
  if (x === null) { return 'nul'; }
  var t = typeof x;
  if (t === 'object') {
    if (isAry(x)) { return 'arr'; }
    if (isBuf(x)) { return 'buf'; }
  }
  return t.substr(0, 3);
};










module.exports = EX;
