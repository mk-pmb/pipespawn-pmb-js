#!/bin/bash
# -*- coding: utf-8, tab-width: 2 -*-

FN=/dev/fd/14
# test in interactive bash:
# exec 14<''<(date -R) ; ./pipe14.sh ; exec 14<&-

export LANG{,UAGE}=C
# sleep 0.1s
echo

function check_pipe () {
  ls -gov "$FN" | tr -s '\t ' ' ' | sed -re '
    s~^(\S+ [0-9]+ [0-9]+) [A-Za-z0-9 : ]+ /~\1 Feb 30 1992 /~
    s~(-> /\S+-)[0-9]+( \(deleted\))$~\1[…number…]\2~
    s~(-> (socket|pipe):\[)[0-9]+(\])$~\1…number…\3~
    '
  echo -n "$FN is "
  [ -r "$FN" ] || echo -n un; echo readable
}

check_pipe

{ nl -ba <"$FN"
} 2>&1 | sed -re 's~^/\S+/pipespawn-pmb/test(/fixtures/)~/…\1~'

check_pipe

sleep 0.2; echo 'bash still alive!'
sleep 0.2; echo 'bash script gonna quit!'
echo
