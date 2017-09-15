/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var collectStream = require('collect-stream');


function saveCollectedData(child, fdfx, errColl, data) {
  if (errColl) {
    errColl.cfd = fdfx.cfd;
    errColl.pipeName = fdfx.name;
    child.cry(errColl);
  }

  if (data && fdfx.encoding && (typeof data !== 'string')) {
    try {
      data = data.toString(fdfx.encoding);
    } catch (errConv) {
      child.cry(errConv);
    }
  }

  fdfx.data = data;
}


function pipeFxCollect(fdfx, done) {
  var child = this, stm = fdfx.stream;

  if (stm) { return done(null, stm && 'bla'); }
  collectStream(stm, function (errColl, data) {
    //console.log('collected', errColl);
    saveCollectedData(child, fdfx, errColl, data);
    return done(null);
  });
}









module.exports = pipeFxCollect;
