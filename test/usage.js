/*jslint indent: 2, maxlen: 80, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

//require('usnam-pmb');

var EX = {}, equal = require('equal-pmb'), async = require('async'),
  tu = require('./lib_test_util'), fixture = tu.fixture;


function loadFixtures(done) {
  async.each([
    { fn: 'dtmf0.flac' },
  ], fixture.load, done);
}


EX.readmeDemo = function (tests) {
  tests = [ loadFixtures ];
  function addTest(n, f) {
    tests.push(tu.asyncLog('>>> Test:', n, '>>>'),
      f, tu.asyncLog('<<< Test:', n, '<<<'));
  }
  //#u
  var pipeSpawn = require('pipespawn-pmb');

  addTest('/err/404', function (nextTest) {
    var cmdSpec = [ '/dev/null/this/program/should/not/exist' ];
    pipeSpawn(cmdSpec, function verify(err, child) {
      equal(err instanceof Error, true);
      equal(err.message, 'Spawned child had 1 errors. ' +
        'Check the .errors and .child properties of this error.\n' +
        'First message: spawn ENOTDIR\n' +
        'Child name: /dev/null/this/program/should/not/exist');
      equal(child.causeOfDeath.stillborn, true);
      return nextTest();
    });
  });

  addTest('pipe14', function (nextTest) {
    var cmdSpec = [ 'bash', fixture.path('pipe14.sh'),
      { stdout: 'str', stderr: { what: 'str', cc: process.stderr } },
      { cfd14: ['hello ', 'world\n', null] },
      ];
    pipeSpawn(cmdSpec, function verify(err, child) {
      if (err) {
        equal.lists(err.errors.map(String), []);
        equal(String(err), false);
      }
      equal.lines(child.pipes('stdout').data, [
        'Pipe at start:        lr-x------ /dev/fd/14 -> pipe:[…] clogged',
        'Pipe shortly after:   lr-x------ /dev/fd/14 -> pipe:[…] ready',
        '     1\thello world',
        'rv[nl]=0 after 0 sec',
        'Pipe after nl:        lr-x------ /dev/fd/14 -> pipe:[…] ready',
        'bash still alive!',
        'bash script gonna quit!',
        '',
        ''
      ]);
      equal(child.pipes('stderr').data, '');
      equal(child.causeOfDeath, { code: null, signal: null,
        stillborn: false, retval: 0, why: 0 });
      return nextTest();
    });
  });

  addTest('sox: flac -> au', function (nextTest) {
    //console.log('base64(clap) =', fixture('clap.flac').toString('base64'));
    var cmdSpec = [ 'sox',
      { lang: 'en_US.UTF-8', softTimeoutSec: 15, hardTimeoutSec: 20,
        name: 'readmeDemo sox: flac -> mono -> spectrogram -> ogg' },

      '-R',     // disable randomness

      '--type', 'flac', '/dev/fd/14',
      { cfd14: { what: [ 1, fixture('dtmf0.flac'),   // that's a Buffer
                null ],
                name: 'audioIn' } },

      '--type', 'au', '/dev/fd/16',
      { cfd16: { what: 'buf', name: 'audioOut' } },

      'spectrogram',
      '-x', '100', '-y', '64',  // minimum size supported by sox
      '-o', '/dev/fd/15', { cfd15: 'buf' },

      { stdout: 'str', stderr: { what: 'str', cc: process.stderr } },
      ];

    pipeSpawn(cmdSpec, function verify(err, child) {
      equal.lines(child.pipes('stdout').data, '');
      equal.lines(child.pipes('stderr').data, '');
      if (err) { throw err; }
      equal(child.causeOfDeath.stillborn, false);
      equal(tu.sha1hex(child.pipes(15).data),
        '6b9228a575faecd789b09934d3d058da297cb1fe');
      equal(tu.sha1hex(child.pipes('audioOut').data),
        '59d3a2309872afd60d523e9bb126d647bed2d2db');
      return nextTest();
    });
  });
  //#r

  async.series(tests, function (err) {
    if (err) { throw err; }
    console.log("+OK usage test passed.");    //= "+OK usage test passed."
  });
};















module.exports = EX;
if (require.main === module) { EX.readmeDemo(); }
