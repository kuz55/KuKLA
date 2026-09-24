import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../config.js';
import { audit, auth, parseId, requireSearchAccess } from '../http.js';

const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);return (await pool.query('SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 500',[id])).rows;});
  app.post('/api/v1/searches/:id/events',{preHandler:auth},async(req)=>{const id=parseId(req);await requireSearchAccess(req,id);const b=z.object({type:z.string().min(1).max(100),payload:z.record(z.any()).default({})}).parse(req.body);await audit(id,req.user.id,b.type,b.payload);return {ok:true};});
};

export default eventRoutes;
