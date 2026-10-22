# App Android de Nibbletec Assist

Permite que el técnico vea la pantalla del celular del cliente y le señale dónde tocar, con las marcas dibujadas sobre su pantalla real. Es solo visual: la app no puede tocar, escribir ni abrir nada en el teléfono.

## Qué ve el cliente

1. Recibe el enlace `https://soporte.nibbletec.com/s/123456789` y lo toca.
   - **Con la app instalada:** el enlace abre la app directamente.
   - **Sin la app:** se abre la página web con el botón **Abrir la app** y los pasos para descargarla. Después de instalar, vuelve a la página y toca **Abrir la app**.
2. Lee los términos, escribe su nombre y acepta. Queda en el mismo registro que la versión web.
3. Permite **Mostrar sobre otras apps**, para ver tus marcas. Es opcional: puede tocar **Ahora no**.
4. Toca **Compartir mi pantalla** y confirma en el diálogo de Android.
5. Usa su teléfono normalmente. Arriba ve una pastilla con **Compartiendo · Detener**, y en la notificación también puede detener.

Tú lo atiendes desde la misma consola `/tech` de siempre. El panel indica si las marcas están visibles en su pantalla.

## Requisitos

- Android 8.0 o superior.
- Las marcas se dibujan con un 80 % de opacidad. Es el máximo que permite Android para que el cliente pueda seguir tocando la pantalla debajo.
- Si Android pregunta qué compartir (Android 14 o superior), el cliente debe elegir **Pantalla completa**. Con "Una app", tú solo verías esa app y las marcas podrían no coincidir.

## 1. Crear tu llave de firma (una sola vez)

Android exige que todas las versiones de la app estén firmadas con la misma llave. Créala en tu Mac y guárdala bien: si la pierdes, los clientes tendrán que desinstalar la app para recibir actualizaciones.

```bash
keytool -genkeypair -v -keystore nibbletec-assist.jks -alias assist \
  -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` viene con Java. Si no lo tienes, Android Studio lo incluye.

Anota la huella SHA-256, que necesitarás en el servidor:

```bash
keytool -list -v -keystore nibbletec-assist.jks -alias assist | grep SHA256
```

## 2. Compilar el APK con GitHub Actions

1. Sube el proyecto a tu repositorio de GitHub (incluye la carpeta `.github`).
2. En **Settings → Secrets and variables → Actions**, crea estos secretos:

   | Secreto | Valor |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | el contenido de `base64 -i nibbletec-assist.jks` |
   | `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
   | `ANDROID_KEY_ALIAS` | `assist` |
   | `ANDROID_KEY_PASSWORD` | la contraseña de la llave |

   En Mac, `base64 -i nibbletec-assist.jks | pbcopy` copia el contenido directamente al portapapeles.
3. Cada vez que cambies algo en `android/`, o desde **Actions → App Android → Run workflow**, se genera el APK. Lo descargas en la sección **Artifacts** de esa ejecución.

Sin los secretos también compila, pero con una llave de pruebas que cambia cada vez. Sirve para probar, no para clientes.

## 3. Publicarlo para los clientes

1. En el servidor, añade la variable `ANDROID_CERT_SHA256` con la huella del paso 1 y vuelve a desplegar. Comprueba que `https://soporte.nibbletec.com/.well-known/assetlinks.json` la muestra. Esto hace que los enlaces abran la app directamente.
2. En la consola `/tech`, en **App Android**, pulsa **Subir APK** y elige el archivo.

Desde ese momento, los clientes con Android verán el botón de descarga en la página del enlace.

## Probar contra tu VM de desarrollo

La app se conecta a un solo servidor, fijado al compilar. La VM sirve HTTPS en `:8443` con un certificado propio de Caddy, que Android no acepta. Para probar desde un celular en la misma red, publica también el puerto HTTP de la app en `docker-compose.override.yml` (solo en la VM de desarrollo):

```yaml
services:
  assist:
    ports:
      - "8080:8080"
```

y compila contra esa dirección:

```bash
cd android
./gradlew assembleDebug -PserverUrl=http://10.20.10.45:8080
# APK en app/build/outputs/apk/debug/app-debug.apk
```

Con GitHub Actions, usa **Run workflow** y pon esa URL en `server_url`. Con un servidor `http://` la app permite tráfico sin cifrar automáticamente; con `https://` no.

En la app, escribe a mano el código de la sesión que creaste en la consola.

## Abrirlo en Android Studio

**File → Open** y elige la carpeta `android/`. El servidor se configura en `gradle.properties` (`serverUrl=`).

## Estructura

```
MainActivity.kt       Pantallas: código, términos, permiso de marcas, compartir
ShareService.kt       Servicio en primer plano: captura (MediaProjection) + WebRTC + WebSocket
Signaling.kt          WebSocket con el mismo protocolo que la página web
Api.kt                Términos, aceptación y servidores STUN/TURN
OverlayController.kt  Ventanas sobre otras apps (marcas + pastilla "Detener")
MarksView.kt          Dibujo de las marcas (la misma lógica que public/js/annotate.js)
Annotations.kt        Validación de las marcas recibidas
```
