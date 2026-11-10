#!/bin/sh
set -eu
mode=${AUTH_PROVIDER:-local}
preview=${SCORETECH_IDENTITY_PREVIEW:-false}
case "$mode" in local|scoretech) ;; *) printf 'AUTH_PROVIDER must be local or scoretech.\n' >&2; exit 1 ;; esac
case "$preview" in true|false) ;; *) printf 'SCORETECH_IDENTITY_PREVIEW must be true or false.\n' >&2; exit 1 ;; esac
directory=/etc/nginx/scoretech
mkdir -p "$directory"
temporary=$(mktemp "$directory/active.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
case "$mode:$preview" in
  local:false)
    printf '# SPHERE local authentication; no Identity routes.\n' > "$temporary"
    ;;
  scoretech:*|local:true)
    SCORETECH_IDENTITY_UPSTREAM=${SCORETECH_IDENTITY_UPSTREAM:-scoretech-identity-gateway:8080}
    export SCORETECH_IDENTITY_UPSTREAM
    # This value enters Nginx syntax: allow a Docker DNS name and TCP port only.
    if ! printf '%s\n' "$SCORETECH_IDENTITY_UPSTREAM" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*:[0-9]{1,5}$'; then
      printf 'Invalid SCORETECH_IDENTITY_UPSTREAM: expected Docker-hostname:port.\n' >&2
      exit 1
    fi
    port=${SCORETECH_IDENTITY_UPSTREAM##*:}
    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
      printf 'SCORETECH_IDENTITY_UPSTREAM port must be 1..65535.\n' >&2
      exit 1
    fi
    envsubst '$SCORETECH_IDENTITY_UPSTREAM' < "$directory/identity.conf.template" > "$temporary"
    if [ "$mode" = scoretech ]; then
      cat "$directory/cas-callback.conf" >> "$temporary"
    fi
    ;;
  *) printf 'AUTH_PROVIDER must be local or scoretech.\n' >&2; exit 1 ;;
esac
mv "$temporary" "$directory/active.conf"
