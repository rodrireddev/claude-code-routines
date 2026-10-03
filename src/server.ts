import { startServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

await startServer(PORT);
console.log(`Routine chat en http://localhost:${PORT}`);
