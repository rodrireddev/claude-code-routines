# Routine Chat

Mini web app en TypeScript que dispara una Claude Code Routine (`POST /v1/claude_code/routines/<id>/fire`) desde una interfaz tipo chat. El token vive solo en el servidor (no se expone al navegador).

## Uso

```bash
npm install
# opcional: cp .env.example .env con ROUTINE_TRIGGER_ID y ROUTINE_TOKEN por defecto
npm run dev            # build + start en http://localhost:3000
```

El Trigger ID y el Token se configuran en la interfaz (⚙ Configuración, guardados en localStorage); si se dejan vacíos se usan los del `.env`.

El cliente está hecho con Web Components (`<routine-chat>`, `<chat-message>`, `<chat-settings>`) en `src/client`.

Cada mensaje se envía como `{"text": "..."}`. La respuesta de la API (id y enlace de la sesión creada) se muestra como mensaje del bot.
