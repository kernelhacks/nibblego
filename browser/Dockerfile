# Chromium sin interfaz para el navegador compartido. No guarda secretos y vive en
# una red interna sin salida: todo su tráfico pasa por el proxy de la app.
FROM alpine:3.22

RUN apk add --no-cache chromium socat tini font-dejavu font-liberation font-noto-emoji \
 && adduser -D -h /home/chrome chrome

COPY policy.json /etc/chromium/policies/managed/policy.json
COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

USER chrome
EXPOSE 9223
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
