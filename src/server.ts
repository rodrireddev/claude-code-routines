import { startServer } from "./app.js";

const PORT = Number(process.env.PORT ?? 3000);

await startServer(PORT);
console.log(`Routine Chat running at http://localhost:${PORT}`);
