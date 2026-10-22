# Nibbletec Assist

Soporte remoto **solo visual** desde el navegador. El cliente abre un enlace, acepta tus términos, comparte su pantalla y tú le señalas dónde hacer clic. No se instala nada y nadie toma el control del equipo.

## Cómo funciona

1. En `/tech` creas una sesión. Obtienes un enlace, un código de 9 dígitos y un mensaje listo para enviar (en español o inglés).
2. El cliente abre el enlace, lee los términos, escribe su nombre y los acepta. Se registran su nombre, la fecha, la IP, el navegador y la versión exacta de los términos.
3. El cliente pulsa **Compartir mi pantalla** y elige qué compartir: pantalla completa, una ventana o una pestaña.
4. Tú ves su pantalla y señalas con las herramientas de abajo.
5. El cliente ve tus marcas en una **ventana flotante** que queda encima de todo y se acerca sola a lo que señalas. Puede cambiar a "Ver todo" o detener en cualquier momento.
6. Cualquiera de los dos termina la sesión. Todo queda en el registro.

## Herramientas del técnico

| Tecla | Herramienta | Qué ve el cliente |
|---|---|---|
| P | Puntero láser | Un punto rojo con estela que sigue tu mouse |
| C | Clic numerado | Una diana que late, con número de paso (1, 2, 3…) |
| R | Recuadro | Un rectángulo resaltado |
| F | Foco | Todo oscurecido menos la zona elegida |
| A | Flecha | Una flecha hacia el elemento |
| D | Lápiz | Un trazo libre que se borra solo a los 12 s |
| M / Espacio | Mover | Mover la vista cuando haces zoom (rueda del mouse) |
| S | Captura | Guarda un PNG con las marcas. El cliente recibe un aviso. |
| Ctrl+Z / Supr | Deshacer / borrar todo | |

Además puedes enviar **indicaciones de texto** ("Haz clic aquí", "Desplázate hacia abajo"…) que aparecen como subtítulo. Las frases rápidas salen en el idioma del cliente.

En el panel lateral ves si el cliente tiene abierta la ventana flotante, la resolución y la fluidez del video, y si la conexión es directa o pasa por tu TURN.

## Compatibilidad del lado del cliente

| Navegador | Compartir pantalla | Ventana flotante |
|---|---|---|
| Chrome / Edge en PC o Mac | Sí | Sí, con marcas, acercamiento y botones |
| Safari en Mac | Sí | Imagen en imagen nativa (sin botones) |
| Firefox | Sí | Con el botón de imagen en imagen de Firefox |
| Celulares y tabletas | No (el navegador no lo permite) | La página lo avisa antes de aceptar |

El flujo completo se probó de punta a punta en Chromium. La alternativa para Safari y Firefox está implementada, pero conviene probarla con un equipo real antes de ofrecerla.

## Probar en tu computadora

```bash
npm install
TECH_USERS="admin:Tu nombre:clave-de-prueba" npm start
```

Abre `http://localhost:8080/tech`, crea una sesión y abre el enlace en otra ventana. Compartir pantalla exige HTTPS, salvo en `localhost`.

## Despliegue con Coolify

1. **DNS:** crea `soporte.nibbletec.com` y `turn.nibbletec.com` apuntando a la IP del servidor. Si usas Cloudflare, el registro `turn` debe ir **sin proxy** (nube gris).
2. **Firewall:** abre `3478/tcp`, `3478/udp` y `49160-49200/udp`. Los puertos 80 y 443 ya los usa Coolify.
3. **Repositorio:** sube esta carpeta a un repositorio privado (GitHub, Gitea…).
4. **Recurso en Coolify:** *+ New → Private Repository* → elige el repositorio y la rama → *Build Pack:* **Docker Compose** → *Docker Compose Location:* `/docker-compose.yml`.
5. **Variables:** en la pestaña *Environment Variables*, Coolify muestra las del compose. Rellénalas como en `.env.example`. Genera los secretos con `openssl rand -hex 32` y el hash de cada contraseña con:
   ```bash
   node server.js hash-password "tu-contraseña"
   ```
6. **Dominio:** en el servicio `assist`, pon `https://soporte.nibbletec.com:8080`. El `:8080` le indica a Coolify el puerto del contenedor. `coturn` no lleva dominio.
7. **Deploy.** Luego comprueba que `https://soporte.nibbletec.com/healthz` responde `{"ok":true}` y entra en `/tech`.
8. **Comprobar el TURN:** con la sesión de técnico abierta, visita `https://soporte.nibbletec.com/api/ice`. Copia el usuario y la credencial temporales en el [Trickle ICE](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) de WebRTC. Debe aparecer un candidato `relay`.

Para cambiar los términos, edítalos en el repositorio y vuelve a desplegar.

## Términos y condiciones

Edita `terms/terms.es.html` y `terms/terms.en.html`. Son plantillas: completa lo que está entre [corchetes] y revísalas con tu abogado. No hace falta reiniciar nada. El servidor calcula una versión (hash) del texto y la guarda con cada aceptación. Si cambias los términos mientras un cliente los está leyendo, se le pide aceptarlos de nuevo.

Conserva el historial de cambios de esos archivos en Git. El registro guarda la versión aceptada, y Git guarda el texto exacto de esa versión.

## Registro de actividad

Cada evento se añade a `data/audit.jsonl` (volumen `assist-data`) y aparece en el panel:

`session_created`, `terms_accepted`, `client_connected`, `sharing_started`, `sharing_stopped`, `snapshot_taken`, `session_ended`, `tech_login`, `tech_login_failed`

```json
{"at":"2026-10-22T16:22:30.112Z","event":"terms_accepted","code":"483542305","ticket":"2041","clientName":"María López","lang":"es","termsVersion":"bcdc2fd96e6f351f","ip":"203.0.113.7","userAgent":"Mozilla/5.0 …","techUser":"dpochet"}
```

Si defines `WEBHOOK_URL`, cada evento se envía también por POST. Sirve, por ejemplo, para crear una nota en el ticket de Odoo mediante n8n. Si además defines `WEBHOOK_SECRET`, la cabecera `x-assist-signature` lleva el HMAC-SHA256 del cuerpo.

## Seguridad

- **Solo visual de verdad:** no existe ningún canal de control. Además, el navegador del cliente muestra su propio aviso de "compartiendo".
- **Video cifrado** de extremo a extremo (WebRTC, DTLS-SRTP). Tu TURN retransmite el video sin poder descifrarlo.
- Los códigos son de 9 dígitos, los enlaces caducan y hay un límite de intentos por IP. Cada cliente recibe un token propio al aceptar.
- **Técnicos:** contraseñas con scrypt, cookies firmadas `HttpOnly` y `SameSite=Strict`, y comprobación de `Origin` en la API y el WebSocket.
- **Navegador:** CSP estricta (sin scripts externos) y fuentes alojadas en tu propio servidor.
- **TURN:** credenciales temporales y bloqueo de rangos de IP privados.

## Limitaciones conocidas

- Las sesiones viven en memoria. Si reinicias el contenedor se cierran las sesiones en curso, aunque el registro se conserva. Pensado para una sola instancia.
- Si el cliente comparte la **pantalla completa**, la ventana flotante aparece dentro de la imagen como un pequeño reflejo en una esquina. Compartir solo la ventana de la aplicación lo evita.
- Las marcas aparecen en la ventana flotante, no directamente sobre el escritorio del cliente. Un navegador no puede dibujar fuera de sus ventanas.
- No hay audio: la conversación va por teléfono.

## Estructura

```
server.js              Servidor: sesiones, términos, registro, señalización WebRTC, credenciales TURN
public/client.html     Página del cliente (/s/<código>)
public/tech.html       Consola del técnico (/tech)
public/js/annotate.js  Dibujo de marcas, compartido por ambos lados
public/js/client.js    Lógica del cliente y ventana flotante
public/js/tech.js      Lógica del técnico y herramientas
terms/                 Términos en español e inglés
```

Fuente tipográfica: Atkinson Hyperlegible Next (licencia SIL OFL, en `public/fonts/OFL.txt`).
