import Fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';

const { Pool } = pg;
const app = Fastify({ logger: true });
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla' });
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? true;

await app.register(cors, { origin: CORS_ORIGIN });
await app.register(sensible);
await app.register(jwt, { secret: JWT_SECRET });
await app.register(websocket);

type Role = 'SYSTEM_OWNER'|'SUPERADMIN'|'SUPERUSER'|'ADMIN'|'LEADER'|'COORDINATOR'|'SEARCHER'|'VIEWER';
type User = { id:string; name:string; email?:string; phone?:string; role:Role };
declare module '@fastify/jwt' { interface FastifyJWT { user: User } }

type Req = FastifyRequest<{Params: Record<string,string>}>;
const auth = async (req: any) => { try { await req.jwtVerify(); } catch { throw app.httpErrors.unauthorized('Authentication required'); } };
const roles = (...allowed: Role[]) => async (req: any) => { await auth(req); if (!allowed.includes(req.user.role)) throw app.httpErrors.forbidden('Insufficient permissions'); };
const parseId = (req: any) => z.string().uuid().parse(req.params.id);

const privilegedRoles: Role[] = ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER'];
const adminRoles: Role[] = ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN'];
const managementRoles: Role[] = ['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR'];

const canManageUser = (actor: Role, target: Role) => {
  if (actor === 'SYSTEM_OWNER') return true;
  if (actor === 'SUPERADMIN') return target !== 'SYSTEM_OWNER' && target !== 'SUPERADMIN';
  if (actor === 'SUPERUSER') return target !== 'SYSTEM_OWNER' && target !== 'SUPERADMIN' && target !== 'SUPERUSER';
  if (actor === 'ADMIN') return !privilegedRoles.includes(target) && target !== 'ADMIN';
  return false;
};

const canAssignRole = (actor: Role, next: Role) => {
  if (actor === 'SYSTEM_OWNER') return next !== 'SYSTEM_OWNER';
  if (actor === 'SUPERADMIN') return !['SYSTEM_OWNER','SUPERADMIN','SUPERUSER'].includes(next);
  if (actor === 'SUPERUSER') return !['SYSTEM_OWNER','SUPERADMIN','SUPERUSER'].includes(next);
  if (actor === 'ADMIN') return !privilegedRoles.includes(next) && next !== 'ADMIN';
  return false;
};

async function audit(searchId: string|null, userId: string, type: string, payload: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId, userId, type, payload]);
}

app.get('/health', async () => ({ ok:true, service:'kukla-server', version:'2.1.0', time:new Date().toISOString() }));
app.get('/ready', async (_req, reply) => { try { await pool.query('SELECT 1'); return {ok:true}; } catch { return reply.code(503).send({ok:false}); } });

app.post('/api/v1/auth/login', async (req) => {
  const b = z.object({ login:z.string().min(1), password:z.string().min(1) }).parse(req.body);
  const r = await pool.query('SELECT id,name,email,phone,role,password_hash,active FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1',[b.login]);
  if (!r.rowCount || !r.rows[0].active || !(await bcrypt.compare(b.password,r.rows[0].password_hash))) throw app.httpErrors.unauthorized('Invalid credentials');
  const u = r.rows[0] as User & {password_hash:string};
  const token = app.jwt.sign({id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role},{expiresIn:'12h'});
  await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[u.id, crypto.createHash('sha256').update(token).digest('hex')]);
  return { token, user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role} };
});
app.post('/api/v1/auth/register', async (req) => {
  const b=z.object({
    name:z.string().min(2),
    email:z.string().email(),
    phone:z.string().optional(),
    password:z.string().min(8)
  }).parse(req.body);
  const hash=await bcrypt.hash(b.password,12);
  try { const r=await pool.query('INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,phone,role,active',[b.name,b.email,b.phone??null,hash,'SEARCHER']); return r.rows[0]; }
  catch { throw app.httpErrors.conflict('User already exists'); }
});
app.post('/api/v1/auth/logout',{preHandler:auth},async(req)=>{await pool.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);return {ok:true};});
app.get('/api/v1/me',{preHandler:auth},async req=>req.user);

app.get('/api/v1/users',{preHandler:roles(...managementRoles)},async()=>{
  const r=await pool.query(`
    SELECT id,name,email,phone,role,active,created_at
    FROM users
    ORDER BY name
  `);
  return r.rows;
});

app.patch('/api/v1/users/:id',{preHandler:roles(...adminRoles)},async(req)=>{
  const id=parseId(req);
  const b=z.object({
    name:z.string().min(2).optional(),
    role:z.enum(['SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN','LEADER','COORDINATOR','SEARCHER','VIEWER']).optional(),
    active:z.boolean().optional(),
    phone:z.string().optional()
  }).refine(v=>
    v.name!==undefined ||
    v.role!==undefined ||
    v.active!==undefined ||
    v.phone!==undefined,
    {message:'Nothing to update'}
  ).parse(req.body);

  const current=await pool.query(
    'SELECT id,role,active FROM users WHERE id=$1',
    [id]
  );

  if(!current.rowCount)
    throw app.httpErrors.notFound('User not found');

  const currentRole = current.rows[0].role as Role;
  const actorRole = req.user.role as Role;

  if (!canManageUser(actorRole, currentRole)) {
    throw app.httpErrors.forbidden('Insufficient permissions to modify this user');
  }

  if (b.role !== undefined && !canAssignRole(actorRole, b.role)) {
    throw app.httpErrors.forbidden('Insufficient permissions to assign this role');
  }

  if (id === req.user.id && b.active === false)
    throw app.httpErrors.badRequest('You cannot deactivate yourself');

  if (id === req.user.id && b.role !== undefined && b.role !== actorRole)
    throw app.httpErrors.badRequest('You cannot change your own role');

  if (currentRole === 'SYSTEM_OWNER' && (b.active === false || (b.role !== undefined && b.role !== 'SYSTEM_OWNER')))
    throw app.httpErrors.badRequest('SYSTEM_OWNER cannot be deactivated or demoted through the user API');

  if (b.role === 'SYSTEM_OWNER' && currentRole !== 'SYSTEM_OWNER')
    throw app.httpErrors.forbidden('SYSTEM_OWNER can only be established by the secure bootstrap process');

  if (currentRole === 'ADMIN' && b.active === false) {
    const admins=await pool.query(
      `SELECT count(*)::int AS count
       FROM users
       WHERE role IN ('SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN') AND active=true AND id<>$1`,
      [id]
    );

    if(admins.rows[0].count===0)
      throw app.httpErrors.badRequest('Cannot deactivate the last active system administrator');
  }

  const r=await pool.query(`
    UPDATE users
    SET
      name=COALESCE($1,name),
      role=COALESCE($2,role),
      active=COALESCE($3,active),
      phone=COALESCE($4,phone)
    WHERE id=$5
    RETURNING id,name,email,phone,role,active,created_at
  `,[
    b.name??null,
    b.role??null,
    b.active??null,
    b.phone??null,
    id
  ]);

  await audit(null, req.user.id, 'USER_UPDATED', { userId:id, changes:b });
  return r.rows[0];
});

app.get('/api/v1/searches',{preHandler:auth},async()=> (await pool.query(`SELECT s.*,u.name creator,(SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,(SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,(SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points FROM searches s LEFT JOIN users u ON u.id=s.created_by ORDER BY s.created_at DESC`)).rows);

app.get('/api/v1/searches/:id',{preHandler:auth},async(req)=>{const id=parseId(req);const r=await pool.query(`SELECT s.*,u.name creator,(SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,(SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks FROM searches s LEFT JOIN users u ON u.id=s.created_by WHERE s.id=$1`,[id]);if(!r.rowCount)throw app.httpErrors.notFound();return r.rows[0];});
app.post('/api/v1/searches',{preHandler:roles(...managementRoles)},async(req)=>{const b=z.object({title:z.string().min(2),area:z.string().optional(),description:z.string().optional(),incident_lat:z.number().min(-90).max(90).optional(),incident_lng:z.number().min(-180).max(180).optional()}).parse(req.body);const r=await pool.query('INSERT INTO searches(title,area,description,incident_lat,incident_lng,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[b.title,b.area??null,b.description??null,b.incident_lat??null,b.incident_lng??null,req.user.id]);await audit(r.rows[0].id,req.user.id,'SEARCH_CREATED',{title:b.title});return r.rows[0];});
app.patch('/api/v1/searches/:id',{preHandler:roles(...managementRoles)},async(req)=>{const id=parseId(req);const b=z.object({status:z.enum(['PLANNED','ACTIVE','PAUSED','COMPLETED','CANCELLED']).optional(),title:z.string().min(2).optional(),area:z.string().optional(),description:z.string().optional(),incident_lat:z.number().optional(),incident_lng:z.number().optional()}).parse(req.body);const r=await pool.query(`UPDATE searches SET title=COALESCE($1,title),area=COALESCE($2,area),description=COALESCE($3,description),status=COALESCE($4,status),incident_lat=COALESCE($5,incident_lat),incident_lng=COALESCE($6,incident_lng),started_at=CASE WHEN $4='ACTIVE' AND started_at IS NULL THEN now() ELSE started_at END,ended_at=CASE WHEN $4 IN ('COMPLETED','CANCELLED') THEN now() ELSE ended_at END WHERE id=$7 RETURNING *`,[b.title??null,b.area??null,b.description??null,b.status??null,b.incident_lat??null,b.incident_lng??null,id]);if(!r.rowCount)throw app.httpErrors.notFound();await audit(id,req.user.id,'SEARCH_UPDATED',{changes:b});return r.rows[0];});
app.get('/api/v1/searches/:id/members',{preHandler:auth},async(req)=>{const id=parseId(req);return (await pool.query(`SELECT u.id,u.name,u.email,u.phone,u.role,m.joined_at FROM search_members m JOIN users u ON u.id=m.user_id WHERE m.search_id=$1 ORDER BY m.joined_at`,[id])).rows;});
app.post('/api/v1/searches/:id/join',{preHandler:auth},async(req)=>{const id=parseId(req);await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,req.user.id]);await audit(id,req.user.id,'MEMBER_JOINED');return {ok:true};});
app.delete('/api/v1/searches/:id/members/:userId',{preHandler:roles(...managementRoles)},async(req: FastifyRequest<{Params:{id:string;userId:string}}>)=>{const id=parseId(req);const uid=z.string().uuid().parse(req.params.userId);await pool.query('DELETE FROM search_members WHERE search_id=$1 AND user_id=$2',[id,uid]);await audit(id,req.user.id,'MEMBER_REMOVED',{userId:uid});return {ok:true};});

app.get('/api/v1/searches/:id/tasks',{preHandler:auth},async(req)=>{const id=parseId(req);return (await pool.query('SELECT t.*,u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.search_id=$1 ORDER BY t.status,t.priority,t.created_at',[id])).rows;});
app.post('/api/v1/searches/:id/tasks',{preHandler:roles(...managementRoles)},async(req)=>{const id=parseId(req);const b=z.object({title:z.string().min(2),description:z.string().optional(),assigneeId:z.string().uuid().optional(),priority:z.number().int().min(1).max(3).default(2),lat:z.number().min(-90).max(90).optional(),lng:z.number().min(-180).max(90).optional()}).parse(req.body);const r=await pool.query('INSERT INTO tasks(search_id,title,description,assignee_id,priority,lat,lng,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,b.title,b.description??null,b.assigneeId??null,b.priority,b.lat??null,b.lng??null,req.user.id]);await audit(id,req.user.id,'TASK_CREATED',{taskId:r.rows[0].id});return r.rows[0];});
app.patch('/api/v1/tasks/:id',{preHandler:auth},async(req)=>{const id=parseId(req);const b=z.object({status:z.enum(['OPEN','IN_PROGRESS','DONE','CANCELLED']).optional(),assigneeId:z.string().uuid().nullable().optional(),description:z.string().optional(),priority:z.number().int().min(1).max(3).optional()}).parse(req.body);const r=await pool.query(`UPDATE tasks SET status=COALESCE($1,status),assignee_id=COALESCE($2,assignee_id),description=COALESCE($3,description),priority=COALESCE($4,priority),completed_at=CASE WHEN $1='DONE' THEN now() WHEN $1 IS NOT NULL THEN NULL ELSE completed_at END WHERE id=$5 RETURNING *`,[b.status??null,b.assigneeId??null,b.description??null,b.priority??null,id]);if(!r.rowCount)throw app.httpErrors.notFound();const task=r.rows[0];await audit(task.search_id,req.user.id,'TASK_UPDATED',{taskId:id,status:b.status});return task;});

app.get('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);return (await pool.query('SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 500',[id])).rows;});
app.post('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);const b=z.object({type:z.string().min(1).max(100),payload:z.record(z.any()).default({})}).parse(req.body);await audit(id,req.user.id,b.type,b.payload);return {ok:true};});

app.post('/api/v1/searches/:id/gps',{preHandler:auth},async(req)=>{const id=parseId(req);const b=z.object({points:z.array(z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180),accuracy:z.number().nonnegative().optional(),altitude:z.number().optional(),speed:z.number().nonnegative().optional(),recorded_at:z.string().datetime().optional()})).min(1).max(1000)}).parse(req.body);const client=await pool.connect();try{await client.query('BEGIN');for(const p of b.points)await client.query('INSERT INTO gps_points(search_id,user_id,lat,lng,accuracy,altitude,speed,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()))',[id,req.user.id,p.lat,p.lng,p.accuracy??null,p.altitude??null,p.speed??null,p.recorded_at??null]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}return {ok:true,count:b.points.length};});
app.get('/api/v1/searches/:id/gps',{preHandler:auth},async(req)=>{const id=parseId(req);const q=z.object({since:z.string().datetime().optional(),userId:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(10000).default(5000)}).parse(req.query);return (await pool.query(`SELECT g.*,u.name user_name FROM gps_points g JOIN users u ON u.id=g.user_id WHERE g.search_id=$1 AND ($2::timestamptz IS NULL OR g.recorded_at>=$2) AND ($3::uuid IS NULL OR g.user_id=$3) ORDER BY g.recorded_at LIMIT $4`,[id,q.since??null,q.userId??null,q.limit])).rows;});

app.get('/api/v1/searches/:id/snapshot',{preHandler:auth},async(req)=>{const id=parseId(req);const [search,members,tasks,events,gps]=await Promise.all([pool.query('SELECT * FROM searches WHERE id=$1',[id]),pool.query('SELECT u.id,u.name,u.role,m.joined_at FROM search_members m JOIN users u ON u.id=m.user_id WHERE m.search_id=$1',[id]),pool.query('SELECT * FROM tasks WHERE search_id=$1 ORDER BY created_at',[id]),pool.query('SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 200',[id]),pool.query('SELECT g.*,u.name user_name FROM gps_points g JOIN users u ON u.id=g.user_id WHERE g.search_id=$1 ORDER BY g.recorded_at DESC LIMIT 5000',[id])]);if(!search.rowCount)throw app.httpErrors.notFound();return {search:search.rows[0],members:members.rows,tasks:tasks.rows,events:events.rows,gps:gps.rows};});

app.get('/api/v1/ws',{websocket:true},(socket:any,req:any)=>{socket.send(JSON.stringify({type:'hello',serverTime:new Date().toISOString()}));socket.on('message',(raw:Buffer)=>{try{const msg=JSON.parse(raw.toString());if(msg.type==='ping')socket.send(JSON.stringify({type:'pong'}));}catch{socket.send(JSON.stringify({type:'error',message:'Invalid message'}));}});});

app.setErrorHandler((err, _req, reply)=>{const error=err as {validation?:unknown;statusCode?:number;message?:string};app.log.error(err);if(error.validation)return reply.code(400).send({error:'VALIDATION_ERROR',message:error.message??'Validation error'});return reply.code(error.statusCode??500).send({error:'ERROR',message:error.message??'Internal server error'});});
const port=Number(process.env.PORT??8080);
await app.listen({host:'0.0.0.0',port});
