# Routine Chat

Mini web app en TypeScript que dispara una Claude Code Routine (`POST /v1/claude_code/routines/<id>/fire`) desde una interfaz tipo chat. El token vive solo en el servidor (no se expone al navegador).

## Uso

```bash
npm install
cp .env.example .env   # rellena ROUTINE_TRIGGER_ID y ROUTINE_TOKEN
npm run dev            # build + start en http://localhost:3000
```

Cada mensaje se envía como `{"text": "..."}`. La respuesta de la API (id y enlace de la sesión creada) se muestra como mensaje del bot.
