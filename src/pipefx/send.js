/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var async = require('async'),
  sockError = { ignore: 'already reported via "error" event' };

function isNum(x, no) { return ((x === +x) || no); }

function feedToPipe(dest, item) {
  //console.log({ feed: item, fd: dest.fd });
  if (item === null) { return (dest.end() && null); }
  if (item.pipe) { return (item.pipe(dest) && null); }
  var written = dest.write(item);
  //console.log({ fed: item, fd: dest.fd, written: written });
  if (written === false) { return 'wait4drain'; }
  if (written === true) { return null; }
  if (written === undefined) { return sockError; }
  throw new Error('Unexpected write failure, result = ' + String(written));
}


function pipeFxSend(fdfx, done) {
  var meta = this, child = meta.child, toChild = fdfx.stream,
    tmo = (done.timeout || false);

  function send1(item, next) {
    if (toChild.destroyed) {
      // console.debug(logPfx, { skipFin: item });
      return next();
    }
    if (tmo.renew) { tmo.renew(true); }
    if (isNum(item)) {
      // console.debug(logPfx, { delay: item });
      if (item > 0) {
        setTimeout(next, item * 1e3);
        if (tmo.renew) { tmo.renew(tmo.limitSec + item); }
        return;
      }
      return next();
    }
    var fed;
    // console.debug(logPfx, { feed: item });
    try { fed = feedToPipe(toChild, item); } catch (err) { fed = err; }
    if (fed === 'wait4drain') {
      toChild.once('drain', next);
      return;
    }
    next(fed);
  }

  function whenAllSent(err) {
    //console.log('whenAllSent', err);
    if (err === sockError) { err = null; }
    if (err) { child.cry(err); }
    return done(null);
  }

  async.eachSeries(fdfx.what, send1, whenAllSent);
}









module.exports = pipeFxSend;
