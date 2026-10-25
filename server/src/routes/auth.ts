import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import crypto from 'node:crypto';
import { z } from 'zod';
import { allowPublicRegistration, loginRateLimit, pool } from '../config.js';
import { auth } from '../http.js';
import { sendOtp } from '../sms.js';

const phoneSchema=z.string().regex(/^\+?[1-9]\d{9,14}$/);
const normalize=(phone:string)=>phone.startsWith('+')?phone:`+${phone}`;
const hash=(value:string)=>crypto.createHash('sha256').update(value).digest('hex');
const superuserPhone=process.env.SUPERUSER_PHONE?normalize(process.env.SUPERUSER_PHONE):'';

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/auth/request-otp',{config:{rateLimit:{max:loginRateLimit,timeWindow:'1 minute'}}},async(req)=>{
    if(!allowPublicRegistration) throw httpErrors.forbidden('Public registration is disabled');
    const b=z.object({phone:phoneSchema,name:z.string().min(2).max(120)}).parse(req.body);
    const phone=normalize(b.phone); const code=String(crypto.randomInt(100000,1000000));
    await pool.query('DELETE FROM otp_challenges WHERE phone=$1 OR expires_at<now()',[phone]);
    await pool.query('INSERT INTO otp_challenges(phone,code_hash,name,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',[phone,hash(code),b.name]);
    let delivery:string;
    try { delivery=await sendOtp(phone,code,req.log); }
    catch(error) {
      await pool.query('DELETE FROM otp_challenges WHERE phone=$1 AND consumed_at IS NULL',[phone]);
      throw error;
    }
    return {ok:true,expiresIn:600,delivery};
  });
  app.post('/api/v1/auth/verify-otp',{config:{rateLimit:{max:10,timeWindow:'1 minute'}}},async(req)=>{
    const b=z.object({phone:phoneSchema,code:z.string().regex(/^\d{6}$/),name:z.string().min(2).max(120).optional()}).parse(req.body);
    const phone=normalize(b.phone); const r=await pool.query('SELECT * FROM otp_challenges WHERE phone=$1 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1',[phone]);
    if(!r.rowCount) throw httpErrors.unauthorized('OTP expired or not requested'); const challenge=r.rows[0];
    if(challenge.attempts>=5) throw httpErrors.tooManyRequests('Too many OTP attempts');
    const valid=crypto.timingSafeEqual(Buffer.from(challenge.code_hash,'hex'),Buffer.from(hash(b.code),'hex'));
    await pool.query('UPDATE otp_challenges SET attempts=attempts+1,consumed_at=CASE WHEN $2 THEN now() ELSE consumed_at END WHERE id=$1',[challenge.id,valid]);
    if(!valid) throw httpErrors.unauthorized('Invalid OTP');
    const existing=await pool.query('SELECT id,name,email,phone,role,active FROM users WHERE phone=$1',[phone]); let u=existing.rows[0];
    const requestedRole=phone===superuserPhone?'SUPERUSER':'SEARCHER';
    if(!u){const created=await pool.query('INSERT INTO users(name,phone,password_hash,role) VALUES($1,$2,NULL,$3) RETURNING id,name,email,phone,role,active',[b.name??challenge.name,phone,requestedRole]);u=created.rows[0];}
    else if(phone===superuserPhone && u.role!=='SUPERUSER'){
      const promoted=await pool.query('UPDATE users SET role=$2 WHERE id=$1 RETURNING id,name,email,phone,role,active',[u.id,'SUPERUSER']);
      u=promoted.rows[0];
    }
    if(!u.active) throw httpErrors.unauthorized('Account is disabled');
    const token=app.jwt.sign({id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role},{expiresIn:'12h'});
    await pool.query('INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'12 hours\')',[u.id,hash(token)]);
    return {token,user:u};
  });
  app.post('/api/v1/auth/logout',{preHandler:auth},async(req)=>{await pool.query('DELETE FROM sessions WHERE user_id=$1',[req.user.id]);return {ok:true};});
  app.get('/api/v1/me',{preHandler:auth},async req=>req.user);
};
export default authRoutes;
