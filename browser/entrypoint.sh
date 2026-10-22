#!/bin/sh
set -e
# Chrome solo escucha la depuración en 127.0.0.1; socat la publica en la red interna.
socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 &

# El disco es de solo lectura: todo lo que Chromium escribe va a /tmp (tmpfs).
export HOME=/tmp/home XDG_CONFIG_HOME=/tmp/home/.config XDG_CACHE_HOME=/tmp/home/.cache
rm -rf /tmp/chrome /tmp/home
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"

CHROME=$(command -v chromium-browser || command -v chromium)
exec "$CHROME" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome \
  --proxy-server="${PROXY:-http://assist:3128}" \
  --proxy-bypass-list='<-loopback>' \
  --disable-quic \
  --force-webrtc-ip-handling-policy=disable_non_proxied_udp \
  --webrtc-ip-handling-policy=disable_non_proxied_udp \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-sync \
  --disable-extensions \
  --disable-component-update \
  --disable-features=Translate,MediaRouter,OptimizationHints \
  --lang="${LANG_UI:-es-419}" \
  about:blank
