import Fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Role, adminRoles, managementRoles, privilegedRoles, canManageUser, canAssignRole } from './rbac.js';

const { Pool } = pg;
const isProduction = process.env.NODE_ENV === 'production';
const requiredSecret = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value || (isProduction && value === fallback)) throw new Error(`${name} must be configured`);
  return value;
};
const JWT_SECRET = requiredSecret('JWT_SECRET', 'dev-secret-change-me');
const DATABASE_URL = requiredSecret('DATABASE_URL', 'postgres://kukla:kukla@localhost:5432/kukla');
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (isProduction ? undefined : 'http://localhost:3000');
if (!CORS_ORIGIN) throw new Error('CORS_ORIGIN must be configured');
const allowPublicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION === 'true' || (!isProduction && process.env.ALLOW_PUBLIC_REGISTRATION !== 'false');

const pool = new Pool({ connectionString: DATABASE_URL });
const app = Fastify({ logger: true });
await app.register(cors, { origin: CORS_ORIGIN });
await app.register(sensible);
await app.register(jwt, { secret: JWT_SECRET });
await app.register(websocket);

type User = { id:string; name:string; email?:string; phone?:string; role:Role };
declare module '@fastify/jwt' { interface FastifyJWT { user: User } }

type Params = Record<string,string>;
const parseId = (req: FastifyRequest<{Params: Params}>) => z.string().uuid().parse(req.params.id);
const tokenHash = (req: FastifyRequest) => crypto.createHash('sha256').update(req.headers.authorization?.replace(/^Bearer\s+/i,'') ?? '').digest('hex');

const auth = async (req: FastifyRequest) => {
  try {
    await req.jwtVerify();
    const session = await pool.query(
      `SELECT u.id,u.name,u.email,u.phone,u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
      [tokenHash(req)]
    );
    if (!session.rowCount) throw app.httpErrors.unauthorized('Session expired or revoked');
    req.user = session.rows[0] as User;
  } catch (error) {
    if ((error as {statusCode?:number}).statusCode === 401) throw error;
    throw app.httpErrors.unauthorized('Authentication required');
  }
};

const roles = (...allowed: Role[]) => async (req: FastifyRequest) => {
  await auth(req);
  if (!allowed.includes(req.user.role)) throw app.httpErrors.forbidden('Insufficient permissions');
};

async function searchExists(searchId:string) {
  const r = await pool.query('SELECT id FROM searches WHERE id=$1',[searchId]);
  if (!r.rowCount) throw app.httpErrors.notFound('Search not found');
}

async function canAccessSearch(user: User, searchId: string): Promise<boolean> {
  if (privilegedRoles.includes(user.role)) return true;
  const r = await pool.query(
    `SELECT 1 FROM search_members WHERE search_id=$1 AND user_id=$2
     UNION SELECT 1 FROM search_organizations so JOIN organization_members om ON om.organization_id=so.organization_id
     WHERE so.search_id=$1 AND om.user_id=$2 AND om.active=true LIMIT 1`,
    [searchId,user.id]
  );
  return Boolean(r.rowCount);
}

async function requireSearchAccess(req: FastifyRequest, searchId: string) {
  await searchExists(searchId);
  if (!(await canAccessSearch(req.user, searchId))) throw app.httpErrors.forbidden('Access to this search is denied');
}

async function requireSearchManagement(req: FastifyRequest, searchId: string) {
  await requireSearchAccess(req, searchId);
  if (!managementRoles.includes(req.user.role)) throw app.httpErrors.forbidden('Search management permission required');
}

async function audit(searchId: string|null, userId: string, type: string, payload: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId,userId,type,payload]);
}

app.get('/health', async () => ({ ok:true, service:'kukla-server', version:'2.1.0', time:new Date().toISOString() }));
app.get('/ready', async (_req, reply) => { try { await pool.query('SELECT 1'); return {ok:true}; } catch { return reply.code(503).send({ok:false}); } });

app.post('/api/v1/auth/login', async (req) => {
  const b=z.object({login:z.string().min(1),password:z.string().min(1)}).parse(req.body);
  const r=await pool.query('SELECT id,name,email,phone,role,password_hash,active FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1',[b.login]);
  if(!r.rowCount || !r.rows[0].active || !(await bcrypt.compare(b.password,r.rows[0].password_hash))) throw app.httpErrors.unauthorized('Invalid credentials');
  const u=r.rows[0] as User & {password_hash:string};
  const token=app.jwt.sign({id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role},{expiresIn:'12h'});
  await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[u.id,crypto.createHash('sha256').update(token).digest('hex')]);
  return {token,user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role}};
});

app.post('/api/v1/auth/register', async (req) => {
  if (!allowPublicRegistration) throw app.httpErrors.forbidden('Public registration is disabled');
  const b=z.object({name:z.string().min(2),email:z.string().email(),phone:z.string().optional(),password:z.string().min(12)}).parse(req.body);
  const hash=await bcrypt.hash(b.password,12);
  try { const r=await pool.query('INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,phone,role,active',[b.name,b.email,b.phone??null,hash,'SEARCHER']); return r.rows[0]; }
  catch { throw app.httpErrors.conflict('User already exists'); }
});
app.post('/api/v1/auth/logout',{preHandler:auth},async(req)=>{await pool.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);return {ok:true};});
app.get('/api/v1/me',{preHandler:auth},async req=>req.user);

app.get('/api/v1/users',{preHandler:roles(...managementRoles)},async(req)=>{
  if (privilegedRoles.includes(req.user.role) || adminRoles.includes(req.user.role)) return (await pool.query('SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY name')).rows;
  return (await pool.query(`SELECT DISTINCT u.id,u.name,u.email,u.phone,u.role,u.active,u.created_at
    FROM users u JOIN search_members sm ON sm.user_id=u.id
    JOIN search_members mine ON mine.search_id=sm.search_id
    WHERE mine.user_id=$1 ORDER BY u.name`,[req.user.id])).rows;
});

app.patch('/api/v1/users/:id',{preHandler:roles(...adminRoles)},async(req)=>{
  const id=parseId(req); const b=z.object({name:z.string().min(2).optional(),role:z.enum(['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER']).optional(),active:z.boolean().optional(),phone:z.string().optional()}).refine(v=>v.name!==undefined||v.role!==undefined||v.active!==undefined||v.phone!==undefined,{message:'Nothing to update'}).parse(req.body);
  const current=await pool.query('SELECT id,role,active FROM users WHERE id=$1',[id]);
  if(!current.rowCount) throw app.httpErrors.notFound('User not found');
  const currentRole=current.rows[0].role as Role; const actorRole=req.user.role;
  if(!canManageUser(actorRole,currentRole)) throw app.httpErrors.forbidden('Insufficient permissions to modify this user');
  if(b.role!==undefined&&!canAssignRole(actorRole,b.role)) throw app.httpErrors.forbidden('Insufficient permissions to assign this role');
  if(id===req.user.id&&b.active===false) throw app.httpErrors.badRequest('You cannot deactivate yourself');
  if(id===req.user.id&&b.role!==undefined&&b.role!==actorRole) throw app.httpErrors.badRequest('You cannot change your own role');
  if(currentRole==='SYSTEM_OWNER'&&(b.active===false||(b.role!==undefined&&b.role!=='SYSTEM_OWNER'))) throw app.httpErrors.badRequest('SYSTEM_OWNER cannot be deactivated or demoted through the user API');
  if(b.role==='SYSTEM_OWNER'&&currentRole!=='SYSTEM_OWNER') throw app.httpErrors.forbidden('SYSTEM_OWNER can only be established by the secure bootstrap process');
  if(currentRole==='ADMIN'&&b.active===false){const admins=await pool.query(`SELECT count(*)::int AS count FROM users WHERE role IN ('SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN') AND active=true AND id<>$1`,[id]);if(admins.rows[0].count===0) throw app.httpErrors.badRequest('Cannot deactivate the last active system administrator');}
  const r=await pool.query(`UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),active=COALESCE($3,active),phone=COALESCE($4,phone) WHERE id=$5 RETURNING id,name,email,phone,role,active,created_at`,[b.name??null,b.role??null,b.active??null,b.phone??null,id]);
  await audit(null,req.user.id,'USER_UPDATED',{userId:id,changes:b}); return r.rows[0];
});

app.get('/api/v1/searches',{preHandler:auth},async(req)=>{
  const privileged=privilegedRoles.includes(req.user.role);
  const query=privileged
    ? `SELECT s.*,u.name creator,(SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,(SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,(SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points FROM searches s LEFT JOIN users u ON u.id=s.created_by ORDER BY s.created_at DESC`
    : `SELECT s.*,u.name creator,(SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,(SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,(SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points FROM searches s LEFT JOIN users u ON u.id=s.created_by WHERE EXISTS (SELECT 1 FROM search_members sm WHERE sm.search_id=s.id AND sm.user_id=$1) OR EXISTS (SELECT 1 FROM search_organizations so JOIN organization_members om ON om.organization_id=so.organization_id WHERE so.search_id=s.id AND om.user_id=$1 AND om.active=true) ORDER BY s.created_at DESC`;
  return (await pool.query(query,privileged?[]:[req.user.id])).rows;
});
app.get('/api/v1/searches/:id',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const r=await pool.query(`SELECT s.*,u.name creator,(SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,(SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,(SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points FROM searches s LEFT JOIN users u ON u.id=s.created_by WHERE s.id=$1`,[id]);return r.rows[0];});
app.post('/api/v1/searches',{preHandler:roles(...managementRoles)},async(req)=>{const b=z.object({title:z.string().min(2),area:z.string().optional(),description:z.string().optional(),incident_lat:z.number().min(-90).max(90).optional(),incident_lng:z.number().min(-180).max(180).optional()}).parse(req.body);const r=await pool.query('INSERT INTO searches(title,area,description,incident_lat,incident_lng,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.title,b.area??null,b.description??null,b.incident_lat??null,b.incident_lng??null,req.user.id]);await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.rows[0].id,req.user.id]);await audit(r.rows[0].id,req.user.id,'SEARCH_CREATED',{title:b.title});return r.rows[0];});
app.patch('/api/v1/searches/:id',{preHandler:roles(...managementRoles)},async(req)=>{const id=parseId(req);await requireSearchManagement(req,id);const b=z.object({status:z.enum(['PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED']).optional(),title:z.string().min(2).optional(),area:z.string().optional(),description:z.string().optional(),incident_lat:z.number().min(-90).max(90).optional(),incident_lng:z.number().min(-180).max(180).optional()}).parse(req.body);const r=await pool.query(`UPDATE searches SET title=COALESCE($1,title),area=COALESCE($2,area),description=COALESCE($3,description),status=COALESCE($4,status),incident_lat=COALESCE($5,incident_lat),incident_lng=COALESCE($6,incident_lng),started_at=CASE WHEN $4='ACTIVE' AND started_at IS NULL THEN now() ELSE started_at END,ended_at=CASE WHEN $4 IN ('COMPLETED','CANCELLED') THEN now() ELSE ended_at END WHERE id=$7 RETURNING *`,[b.title??null,b.area??null,b.description??null,b.status??null,b.incident_lat??null,b.incident_lng??null,id]);await audit(id,req.user.id,'SEARCH_UPDATED',{changes:b});return r.rows[0];});
app.get('/api/v1/searches/:id/members',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);return (await pool.query(`SELECT u.id,u.name,u.email,u.phone,u.role,m.joined_at FROM search_members m JOIN users u ON u.id=m.user_id WHERE m.search_id=$1 ORDER BY m.joined_at`,[id])).rows;});
app.post('/api/v1/searches/:id/join',{preHandler:auth},async(req)=>{const id=parseId(req);await searchExists(id);await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,req.user.id]);await audit(id,req.user.id,'MEMBER_JOINED');return {ok:true};});
app.delete('/api/v1/searches/:id/members/:userId',{preHandler:roles(...managementRoles)},async(req: FastifyRequest<{Params:{id:string;userId:string}}>)=>{const id=parseId(req);await requireSearchManagement(req,id);const uid=z.string().uuid().parse(req.params.userId);await pool.query('DELETE FROM search_members WHERE search_id=$1 AND user_id=$2',[id,uid]);await audit(id,req.user.id,'MEMBER_REMOVED',{userId:uid});return {ok:true};});

app.get('/api/v1/searches/:id/tasks',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);return (await pool.query('SELECT t.*,u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.search_id=$1 ORDER BY t.status,t.priority,t.created_at',[id])).rows;});
app.post('/api/v1/searches/:id/tasks',{preHandler:roles(...managementRoles)},async(req)=>{const id=parseId(req);await requireSearchManagement(req,id);const b=z.object({title:z.string().min(2),description:z.string().optional(),assigneeId:z.string().uuid().optional(),priority:z.number().int().min(1).max(3).default(2),lat:z.number().min(-90).max(90).optional(),lng:z.number().min(-180).max(180).optional()}).parse(req.body);if(b.assigneeId){const member=await pool.query('SELECT 1 FROM search_members WHERE search_id=$1 AND user_id=$2',[id,b.assigneeId]);if(!member.rowCount) throw app.httpErrors.badRequest('Assignee must be a member of the search');}const r=await pool.query('INSERT INTO tasks(search_id,title,description,assignee_id,priority,lat,lng,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,b.title,b.description??null,b.assigneeId??null,b.priority,b.lat??null,b.lng??null,req.user.id]);await audit(id,req.user.id,'TASK_CREATED',{taskId:r.rows[0].id});return r.rows[0];});
app.patch('/api/v1/tasks/:id',{preHandler:auth},async(req)=>{const id=parseId(req);const b=z.object({status:z.enum(['OPEN','IN_PROGRESS','DONE','CANCELLED']).optional(),assigneeId:z.string().uuid().nullable().optional(),description:z.string().optional(),priority:z.number().int().min(1).max(3).optional()}).parse(req.body);const current=await pool.query('SELECT * FROM tasks WHERE id=$1',[id]);if(!current.rowCount)throw app.httpErrors.notFound('Task not found');const task=current.rows[0];await requireSearchAccess(req,task.search_id);const privileged=privilegedRoles.includes(req.user.role);const manager=managementRoles.includes(req.user.role);if(!privileged&&!manager){if(req.user.role!=='SEARCHER'||task.assignee_id!==req.user.id)throw app.httpErrors.forbidden('You may only update tasks assigned to you');if(b.assigneeId!==undefined||b.priority!==undefined)throw app.httpErrors.forbidden('Searchers cannot reassign or reprioritize tasks');}if(b.assigneeId){const member=await pool.query('SELECT 1 FROM search_members WHERE search_id=$1 AND user_id=$2',[task.search_id,b.assigneeId]);if(!member.rowCount)throw app.httpErrors.badRequest('Assignee must be a member of the search');}const r=await pool.query(`UPDATE tasks SET status=COALESCE($1,status),assignee_id=CASE WHEN $6=true THEN NULL WHEN $2::uuid IS NOT NULL THEN $2::uuid ELSE assignee_id END,description=COALESCE($3,description),priority=COALESCE($4,priority),completed_at=CASE WHEN $1='DONE' THEN now() WHEN $1 IS NOT NULL THEN NULL ELSE completed_at END WHERE id=$5 RETURNING *`,[b.status??null,b.assigneeId??null,b.description??null,b.priority??null,id,b.assigneeId===null]);await audit(task.search_id,req.user.id,'TASK_UPDATED',{taskId:id,changes:b});return r.rows[0];});

app.get('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);return (await pool.query('SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 500',[id])).rows;});
app.post('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const b=z.object({type:z.string().min(1).max(100),payload:z.record(z.any()).default({})}).parse(req.body);await audit(id,req.user.id,b.type,b.payload);return {ok:true};});

app.post('/api/v1/searches/:id/gps',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const b=z.object({points:z.array(z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180),accuracy:z.number().nonnegative().optional(),altitude:z.number().optional(),speed:z.number().nonnegative().optional(),recorded_at:z.string().datetime().optional()})).min(1).max(1000)}).parse(req.body);const client=await pool.connect();try{await client.query('BEGIN');for(const p of b.points)await client.query('INSERT INTO gps_points(search_id,user_id,lat,lng,accuracy,altitude,speed,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()))',[id,req.user.id,p.lat,p.lng,p.accuracy??null,p.altitude??null,p.speed??null,p.recorded_at??null]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return {ok:true,count:b.points.length};});
app.get('/api/v1/searches/:id/gps',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const q=z.object({since:z.string().datetime().optional(),userId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(10000).default(5000)}).parse(req.query);return (await pool.query(`SELECT g.*,u.name user_name FROM gps_points g JOIN users u ON u.id=g.user_id WHERE g.search_id=$1 AND ($2::timestamptz IS NULL OR g.recorded_at>=$2) AND ($3::uuid IS NULL OR g.user_id=$3) ORDER BY g.recorded_at LIMIT $4`,[id,q.since??null,q.userId??null,q.limit])).rows;});

app.get('/api/v1/searches/:id/snapshot',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const [search,members,tasks,events,gps]=await Promise.all([pool.query('SELECT * FROM searches WHERE id=$1',[id]),pool.query('SELECT u.id,u.name,u.role,m.joined_at FROM search_members m JOIN users u ON u.id=m.user_id WHERE m.search_id=$1',[id]),pool.query('SELECT * FROM tasks WHERE search_id=$1 ORDER BY created_at',[id]),pool.query('SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 200',[id]),pool.query('SELECT g.*,u.name user_name FROM gps_points g JOIN users u ON u.id=g.user_id WHERE g.search_id=$1 ORDER BY g.recorded_at DESC LIMIT 5000',[id])]);return {search:search.rows[0],members:members.rows,tasks:tasks.rows,events:events.rows,gps:gps.rows};});

app.get('/api/v1/ws',{websocket:true,preHandler:auth},(socket:any)=>{socket.send(JSON.stringify({type:'hello',serverTime:new Date().toISOString()}));socket.on('message',(raw:Buffer)=>{try{const msg=JSON.parse(raw.toString());if(msg.type==='ping')socket.send(JSON.stringify({type:'pong'}));}catch{socket.send(JSON.stringify({type:'error',message:'Invalid message'}));}});});

app.setErrorHandler((err,_req,reply)=>{const error=err as {validation?:unknown;statusCode?:number;message?:string};app.log.error(err);if(error.validation)return reply.code(400).send({error:'VALIDATION_ERROR',message:error.message??'Validation error'});const status=error.statusCode??500;return reply.code(status).send({error:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':'ERROR',message:status<500?(error.message??'Request failed'):'Internal server error'});});
const port=Number(process.env.PORT??8080);await app.listen({host:'0.0.0.0',port});
