import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, parseId, roles } from '../http.js';
import { adminRoles } from '../rbac.js';
import { audit } from '../http.js';

const profileSchema=z.object({
  fullName:z.string().min(2).max(160).optional(), birthDate:z.string().date().optional(),
  city:z.string().max(120).optional(), district:z.string().max(120).optional(),
  extraPhone:z.string().max(30).optional(), medicalNotes:z.string().max(2000).optional(),
  skills:z.array(z.string().min(1).max(80)).max(30).optional(), hasTransport:z.boolean().optional(),
  availableForSearches:z.boolean().optional(), emergencyContactName:z.string().max(160).optional(),
  emergencyContactPhone:z.string().max(30).optional(), consentPersonalData:z.boolean().optional()
});
const select=`SELECT user_id "userId",full_name "fullName",birth_date "birthDate",city,district,extra_phone "extraPhone",medical_notes "medicalNotes",skills,has_transport "hasTransport",available_for_searches "availableForSearches",emergency_contact_name "emergencyContactName",emergency_contact_phone "emergencyContactPhone",consent_personal_data "consentPersonalData",verified,updated_at "updatedAt" FROM user_profiles WHERE user_id=$1`;
const save=async(id:string,b:any)=>{const r=await pool.query(`INSERT INTO user_profiles(user_id,full_name,birth_date,city,district,extra_phone,medical_notes,skills,has_transport,available_for_searches,emergency_contact_name,emergency_contact_phone,consent_personal_data,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,false),COALESCE($10,true),$11,$12,COALESCE($13,false),now()) ON CONFLICT(user_id) DO UPDATE SET full_name=COALESCE($2,user_profiles.full_name),birth_date=COALESCE($3,user_profiles.birth_date),city=COALESCE($4,user_profiles.city),district=COALESCE($5,user_profiles.district),extra_phone=COALESCE($6,user_profiles.extra_phone),medical_notes=COALESCE($7,user_profiles.medical_notes),skills=COALESCE($8,user_profiles.skills),has_transport=COALESCE($9,user_profiles.has_transport),available_for_searches=COALESCE($10,user_profiles.available_for_searches),emergency_contact_name=COALESCE($11,user_profiles.emergency_contact_name),emergency_contact_phone=COALESCE($12,user_profiles.emergency_contact_phone),consent_personal_data=COALESCE($13,user_profiles.consent_personal_data),verified=false,updated_at=now() RETURNING user_id`,[id,b.fullName??null,b.birthDate??null,b.city??null,b.district??null,b.extraPhone??null,b.medicalNotes??null,b.skills??null,b.hasTransport??null,b.availableForSearches??null,b.emergencyContactName??null,b.emergencyContactPhone??null,b.consentPersonalData??null]);return (await pool.query(select,[r.rows[0].user_id])).rows[0];};
const profileRoutes:FastifyPluginAsync=async app=>{
  app.get('/api/v1/me/profile',{preHandler:auth},async req=>(await pool.query(select,[req.user.id])).rows[0]??null);
  app.put('/api/v1/me/profile',{preHandler:auth},async req=>{const b=profileSchema.parse(req.body);if(b.consentPersonalData!==true)throw httpErrors.badRequest('Personal data consent is required');return save(req.user.id,b);});
  app.get('/api/v1/users/:id/profile',{preHandler:roles(...adminRoles)},async req=>{const id=parseId(req);return (await pool.query(select,[id])).rows[0]??null;});
  app.patch('/api/v1/users/:id/profile/review',{preHandler:roles(...adminRoles)},async req=>{const id=parseId(req);const {verified}=z.object({verified:z.boolean()}).parse(req.body);const result=await pool.query('UPDATE user_profiles SET verified=$1,updated_at=now() WHERE user_id=$2 AND ($1=false OR consent_personal_data=true) RETURNING user_id',[verified,id]);if(!result.rowCount)throw httpErrors.badRequest('Profile is missing or personal data consent is absent');await audit(null,req.user.id,'USER_PROFILE_REVIEWED',{userId:id,verified});return {ok:true,verified};});
};
export default profileRoutes;
