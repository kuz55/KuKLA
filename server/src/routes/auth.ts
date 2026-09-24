import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { allowPublicRegistration, loginRateLimit, pool } from '../config.js';
import { auth } from '../http.js';
import { User } from '../types.js';

const authRoutes: FastifyPluginAsync = async (app) => {
  // Жёсткий лимит на подбор пароля: 5 попыток с одного IP в минуту.
  // Ключ по IP, а не по логину: иначе атакующий перебирает пароли к одному
  // аккаунту с разных IP, а честный пользователь с общим логином (email)
  // блокируется на всех.
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: loginRateLimit, timeWindow: '1 minute' } },
  }, async (req) => {
    const b=z.object({login:z.string().min(1),password:z.string().min(1)}).parse(req.body);
    const r=await pool.query('SELECT id,name,email,phone,role,password_hash,active FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1',[b.login]);
    if(!r.rowCount || !r.rows[0].active || !(await bcrypt.compare(b.password,r.rows[0].password_hash))) throw httpErrors.unauthorized('Invalid credentials');
    const u=r.rows[0] as User & {password_hash:string};
    const token=app.jwt.sign({id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role},{expiresIn:'12h'});
    await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[u.id,crypto.createHash('sha256').update(token).digest('hex')]);
    return {token,user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role}};
  });

  // Регистрация — тоже дорогая операция (bcrypt с cost 12), лимит против
  // массового создания аккаунтов.
  app.post('/api/v1/auth/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    if (!allowPublicRegistration) throw httpErrors.forbidden('Public registration is disabled');
    const b=z.object({name:z.string().min(2),email:z.string().email(),phone:z.string().optional(),password:z.string().min(12)}).parse(req.body);
    const hash=await bcrypt.hash(b.password,12);
    try { const r=await pool.query('INSERT INTO users(name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,phone,role,active',[b.name,b.email,b.phone??null,hash,'SEARCHER']); return r.rows[0]; }
    catch { throw httpErrors.conflict('User already exists'); }
  });

  app.post('/api/v1/auth/logout',{preHandler:auth},async(req)=>{await pool.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);return {ok:true};});
  app.get('/api/v1/me',{preHandler:auth},async req=>req.user);
};

export default authRoutes;
