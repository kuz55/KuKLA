import { buildApp } from './app.js';

const app = await buildApp();
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });