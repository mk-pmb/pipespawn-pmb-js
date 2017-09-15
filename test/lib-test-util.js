/*jslint indent: 2, maxlen: 80, continue: false, unparam: false, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

var EX = {}, fs = require('fs'), testDir = require('absdir')(module);


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












module.exports = EX;
