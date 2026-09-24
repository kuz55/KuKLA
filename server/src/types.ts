import { Role } from './rbac.js';

export type User = { id:string; name:string; email?:string; phone?:string; role:Role };

declare module '@fastify/jwt' { interface FastifyJWT { user: User } }

export type Params = Record<string,string>;
