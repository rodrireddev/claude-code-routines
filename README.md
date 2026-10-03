# Routine Chat

Mini web app en TypeScript que dispara una Claude Code Routine (`POST /v1/claude_code/routines/<id>/fire`) desde una interfaz tipo chat. El token vive solo en el servidor local (no se envía a terceros).

- **Cliente:** Web Components (`<routine-chat>`, `<chat-message>`, `<chat-settings>`) en `src/client`, con estilos de [Shoelace](https://shoelace.style) (modo claro/oscuro automático). Shoelace se sirve en local desde `node_modules`, sin CDN.
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
