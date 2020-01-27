#!/bin/bash
# -*- coding: utf-8, tab-width: 2 -*-

function test_pipe14 () {
  export LANG{,UAGE}=C

  local PIPE_FD=14
  local PIPE_PATH="/dev/fd/$PIPE_FD"
  # test in interactive bash:
  # exec 14<''<(date -R) ; ./pipe14.sh ; exec 14<&-

  check_pipe 'at start'
  sleep 0.1s
  check_pipe 'shortly after'

  SECONDS=0
  timeout 5s nl -ba <&"$PIPE_FD" 2>&1 | sed -urf <(echo '
    s~^/\S+/pipespawn-pmb/test(/fixtures/)~/…\1~')
  echo "rv[nl]=${PIPESTATUS[0]} after $SECONDS sec"

  check_pipe 'after nl'

  sleep 0.2; echo 'bash still alive!'
  sleep 0.2; echo 'bash script gonna quit!'
  echo
}


function check_pipe () {
  local READY='ready' STAT=
  read -t 0 -u "$PIPE_FD" STAT || READY='clogged'
  STAT="$(LANG=C stat -c '%A %N' -- "$PIPE_PATH" | sed -rf <(echo '
    s~\x27~~g
    s~\[[0-9]+\]~[…]~
    '))"
  printf 'Pipe %- 16s %s %s\n' "$*:" "$STAT" "$READY"
}



test_pipe14 "$@"; exit $?
