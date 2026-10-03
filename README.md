<p align="center"><img src="public/assets/logo-128.png" width="96" alt="Routine Chat" /></p>

# Routine Chat

Mini web app en TypeScript que dispara una Claude Code Routine (`POST /v1/claude_code/routines/<id>/fire`) desde una interfaz tipo chat. El token vive solo en el servidor local (no se envía a terceros).

- **Cliente:** Web Components (`<routine-chat>`, `<chat-message>`, `<chat-settings>`) en `src/client`, con estilos de [Shoelace](https://shoelace.style) (modo claro/oscuro: sistema, claro u oscuro con el botón de la barra lateral). Shoelace se sirve en local desde `node_modules`, sin CDN.
- **Servidor:** Node + TypeScript (`src/app.ts`) que hace de proxy hacia la API y sirve el cliente.
- **Escritorio:** Electron (`src/electron/main.ts`) levanta el servidor y abre la app en una ventana Chromium.

## Uso

```bash
npm install
npm run dev        # navegador: http://localhost:3000
npm run electron   # ventana de escritorio (Electron/Chromium)
```

La interfaz es similar a ChatGPT/Claude: lista de conversaciones a la izquierda y chat a la derecha. Cada conversación tiene su propio Trigger ID y Token (icono ⚙ → Configuración) y su historial, todo guardado en local (`localStorage`). Si una conversación no tiene Trigger ID/Token se usan `ROUTINE_TRIGGER_ID` y `ROUTINE_TOKEN` del `.env` (ver `.env.example`). `PORT` cambia el puerto (por defecto 3000; mantenlo fijo para conservar la configuración guardada).

Cada mensaje se envía como `{"text": "..."}`. La respuesta de la API (id y enlace de la sesión creada) se muestra como mensaje del bot.

## Revisar y aprobar Pull Requests (GitHub)

Botón **Pull requests** al pie de la barra lateral. La primera vez pide un **fine-grained personal access token** de GitHub (Settings → Developer settings → Personal access tokens → Fine-grained tokens), limitado a los repos que quieras revisar, con permisos:

- Pull requests: **Read and write**
- Contents: **Read-only**
- Metadata: Read-only (automático)

Después eliges un repositorio: la lista muestra los que GitHub devuelve para el token (privados primero, marcados con 🔒; los públicos llevan «· público»). GitHub no ofrece una llamada que liste «exactamente» los repos concedidos a un fine-grained token (siempre puede leer públicos), así que hay una casilla «Solo privados» y un botón «+» para añadir a mano cualquier `owner/repo`, que se valida contra la API, ves los PRs abiertos, su descripción, reviews existentes y diffs, y puedes **Aprobar**, **Solicitar cambios** o **Comentar** (la review se fija al commit que estabas viendo y pide confirmación). El token solo se envía a `api.github.com` y se guarda con el resto de tus datos locales (cifrado si activaste el cifrado). GitHub no permite aprobar tus propios PRs.

## Cifrado de datos locales

Por defecto el historial y los tokens se guardan en claro en `localStorage`. Desde ⚙ → **Seguridad** puedes activar el cifrado con una contraseña:

- Contraseña → clave con PBKDF2-SHA256 (600 000 iteraciones, sal aleatoria) y datos cifrados con AES-256-GCM (WebCrypto). En disco solo queda el "vault" cifrado; los datos en claro se borran.
- Al abrir la app se pide la contraseña (pantalla de bloqueo). El botón 🔒 de la cabecera bloquea al instante.
- Si olvidas la contraseña no hay recuperación: solo "borrar todo".
- El cifrado protege los datos **en reposo**. Mientras la app está desbloqueada el token está en memoria y se envía a tu servidor local (`127.0.0.1`) para llamar a la API.
