/*jslint indent: 2, maxlen: 80, node: true */
/* -*- tab-width: 2 -*- */
'use strict';

require('usnam-pmb');

var EX = {}, equal = require('equal-pmb'), async = require('async'),
  tu = require('./util'), fixture = tu.fixture;


function loadFixtures(done) {
  async.each([
    { fn: 'clap.flac' },
    { fn: 'clap.spec.png' },
    { fn: 'clap.ogg' },
  ], fixture.load, done);
}


EX.readmeDemo = function (tests) {
  tests = [ loadFixtures ];
  function addTest(f) { tests.push(f); }
  //#u
  var pipeSpawn = require('pipespawn-pmb');

  addTest(function err_404(nextTest) {
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

  addTest(function pipe14(nextTest) {
    var cmdSpec = [ 'bash', fixture.path('pipe14.sh'),
      { stdout: 'str', stderr: { what: 'str', cc: process.stderr } },
      { fd14: [ 'hello ', 'world\n', null ] },
      ];
    pipeSpawn(cmdSpec, function verify(err, child) {
      equal.lines(child.pipes('stdout').data, [ '',
        'lr-x------ 1 64 Feb 30 1992 /dev/fd/14 -> pipe:[…number…]',
        '/dev/fd/14 is readable',
        '     1\thello world',
        'lr-x------ 1 64 Feb 30 1992 /dev/fd/14 -> pipe:[…number…]',
        '/dev/fd/14 is readable',
        'bash still alive!',
        'bash script gonna quit!',
        '', '' ]);
      equal(child.pipes('stderr').data, '');
      equal(err, false);
      equal(child.causeOfDeath, { code: null, signal: null,
        stillborn: false, retval: 0, why: 0 });
      return nextTest();
    });
  });

  addTest(function sox_flac2ogg(nextTest) {
    //console.log('base64(clap) =', fixture('clap.flac').toString('base64'));
    var cmdSpec = [ 'sox',
      { lang: 'en_US.UTF-8', softTimeoutSec: 15, hardTimeoutSec: 20,
        name: 'readmeDemo sox: flac -> mono -> spectrogram -> ogg' },

      '-R',     // disable randomness

      '--type', 'flac',
      '/dev/fd/14',
      { fd14: { what: [ 1, fixture('clap.flac'),   // that's a Buffer
                null ],
                name: 'audioIn' } },

      '--type', 'ogg', '--compression', 0,
      '/dev/fd/16',
      { fd16: { what: 'buf', name: 'audioOut' } },

      'spectrogram', '-o', '/dev/fd/15',
      { fd15: 'buf' },

      { stdout: 'str', stderr: { what: 'str', cc: process.stderr } },
      ];

    pipeSpawn(cmdSpec, function verify(err, child) {
      equal.lines(child.pipes('stdout').data, '');
      equal.lines(child.pipes('stderr').data, '');
      if (err) { throw err; }
      equal(child.causeOfDeath.stillborn, false);
      equal(child.pipes(15), fixture('clap.spec.png'));
      equal(child.pipes('audioOut'), fixture('clap.ogg'));
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
