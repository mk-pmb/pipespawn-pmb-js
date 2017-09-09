#!/bin/bash
# -*- coding: utf-8, tab-width: 2 -*-

echo "args: $*" >&2
#sleep 0.1s
for ARG in "$@"; do
  echo -n "'$ARG': " >&2
  case "$ARG" in
    /dev/fd/* )
      ls -gov -- "$ARG" >&2
      PERMS="$(stat --format=%A -- "$ARG")"
      case "$PERMS" in
      lr-* )
        echo -n 'gonna read: ' >&2
        <"$ARG" head --bytes=45 -- | base64 >&2
        ;;
      l-w* )
        echo 'gonna write.' >&2
        date -R >"$ARG"
        ;;
      esac
      ;;
    * ) echo - >&2;;
  esac
done
echo done. >&2
