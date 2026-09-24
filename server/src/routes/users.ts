import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { adminRoles, managementRoles, privilegedRoles, Role, canManageUser, canAssignRole } from '../rbac.js';
import { pool } from '../config.js';
import { audit, parseId, roles } from '../http.js';

const userRoutes: FastifyPluginAsync = async (app) => {
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
    if(!current.rowCount) throw httpErrors.notFound('User not found');
    const currentRole=current.rows[0].role as Role; const actorRole=req.user.role;
    if(!canManageUser(actorRole,currentRole)) throw httpErrors.forbidden('Insufficient permissions to modify this user');
    if(b.role!==undefined&&!canAssignRole(actorRole,b.role)) throw httpErrors.forbidden('Insufficient permissions to assign this role');
    if(id===req.user.id&&b.active===false) throw httpErrors.badRequest('You cannot deactivate yourself');
    if(id===req.user.id&&b.role!==undefined&&b.role!==actorRole) throw httpErrors.badRequest('You cannot change your own role');
    if(currentRole==='SYSTEM_OWNER'&&(b.active===false||(b.role!==undefined&&b.role!=='SYSTEM_OWNER'))) throw httpErrors.badRequest('SYSTEM_OWNER cannot be deactivated or demoted through the user API');
    if(b.role==='SYSTEM_OWNER'&&currentRole!=='SYSTEM_OWNER') throw httpErrors.forbidden('SYSTEM_OWNER can only be established by the secure bootstrap process');
    if(currentRole==='ADMIN'&&b.active===false){const admins=await pool.query(`SELECT count(*)::int AS count FROM users WHERE role IN ('SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN') AND active=true AND id<>$1`,[id]);if(admins.rows[0].count===0) throw httpErrors.badRequest('Cannot deactivate the last active system administrator');}
    const r=await pool.query(`UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),active=COALESCE($3,active),phone=COALESCE($4,phone) WHERE id=$5 RETURNING id,name,email,phone,role,active,created_at`,[b.name??null,b.role??null,b.active??null,b.phone??null,id]);
    await audit(null,req.user.id,'USER_UPDATED',{userId:id,changes:b}); return r.rows[0];
  });
};

export default userRoutes;
