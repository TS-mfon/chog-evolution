import { buildApp } from "./index.js";

const app = buildApp();

await app.listen({
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  host: "0.0.0.0",
});
