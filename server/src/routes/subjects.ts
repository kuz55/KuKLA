import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitAuthorizedSearchTransaction, parseId, requireSearchManagement } from '../http.js';
import { Params } from '../types.js';

const subjectColumns = `id, search_id AS "searchId", full_name AS "fullName", age, sex,
  description, clothing, medical_notes AS "medicalNotes",
  last_known_lat AS "lastKnownLat", last_known_lng AS "lastKnownLng",
  last_known_at AS "lastKnownAt", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const subjectFields = {
  fullName: z.string().trim().min(2).max(160).nullable().optional(),
  age: z.number().int().min(0).max(130).nullable().optional(),
  sex: z.string().trim().min(1).max(40).nullable().optional(),
  description: z.string().trim().min(1).max(4000).nullable().optional(),
  clothing: z.string().trim().min(1).max(2000).nullable().optional(),
  medicalNotes: z.string().trim().min(1).max(4000).nullable().optional(),
  lastKnownLat: z.number().min(-90).max(90).nullable().optional(),
  lastKnownLng: z.number().min(-180).max(180).nullable().optional(),
  lastKnownAt: z.iso.datetime().nullable().optional(),
};

const hasSubjectDetails = (value: Record<string, unknown>) =>
  ['fullName', 'age', 'sex', 'description', 'clothing', 'medicalNotes', 'lastKnownLat', 'lastKnownLng']
    .some((key) => value[key] !== undefined && value[key] !== null && value[key] !== '');

const createSubjectSchema = z.object(subjectFields)
  .refine(hasSubjectDetails, { message: 'Provide at least one subject detail' })
  .refine((value) => (value.lastKnownLat === undefined) === (value.lastKnownLng === undefined), {
    message: 'Provide both lastKnownLat and lastKnownLng, or neither',
  });

const updateSubjectSchema = z.object(subjectFields)
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })
  .refine((value) => (value.lastKnownLat === undefined) === (value.lastKnownLng === undefined), {
    message: 'Provide both lastKnownLat and lastKnownLng, or neither',
  });

const subjectRoutes: FastifyPluginAsync = async (app) => {
  // Subject profiles contain identifying and medical information. This initial
  // command-center slice is restricted to authorized search managers; field and
  // viewer access requires an explicit privacy policy and workflow.
  app.get('/api/v1/searches/:id/subjects', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        `SELECT ${subjectColumns} FROM subjects
         WHERE search_id=$1 ORDER BY created_at DESC, id`,
        [searchId],
      );
      await commitAuthorizedSearchTransaction(req, client);
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/searches/:id/subjects', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const parsed = createSubjectSchema.safeParse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      if (!parsed.success) throw parsed.error;
      const body = parsed.data;
      const result = await client.query(
        `INSERT INTO subjects(
           search_id,full_name,age,sex,description,clothing,medical_notes,
           last_known_lat,last_known_lng,last_known_at,created_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${subjectColumns}`,
        [
          searchId,
          body.fullName ?? null,
          body.age ?? null,
          body.sex ?? null,
          body.description ?? null,
          body.clothing ?? null,
          body.medicalNotes ?? null,
          body.lastKnownLat ?? null,
          body.lastKnownLng ?? null,
          body.lastKnownAt ?? null,
          req.user.id,
        ],
      );
      const subject = result.rows[0];
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SUBJECT_CREATED', { subjectId: subject.id }],
      );
      await commitAuthorizedSearchTransaction(req, client);
      return subject;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/subjects/:subjectId', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const subjectId = z.string().uuid().parse((req.params as Params).subjectId);
    const parsed = updateSubjectSchema.safeParse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      if (!parsed.success) throw parsed.error;
      const body = parsed.data;
      const result = await client.query(
        `UPDATE subjects SET
           full_name=CASE WHEN $1::boolean THEN $2 ELSE full_name END,
           age=CASE WHEN $3::boolean THEN $4 ELSE age END,
           sex=CASE WHEN $5::boolean THEN $6 ELSE sex END,
           description=CASE WHEN $7::boolean THEN $8 ELSE description END,
           clothing=CASE WHEN $9::boolean THEN $10 ELSE clothing END,
           medical_notes=CASE WHEN $11::boolean THEN $12 ELSE medical_notes END,
           last_known_lat=CASE WHEN $13::boolean THEN $14 ELSE last_known_lat END,
           last_known_lng=CASE WHEN $15::boolean THEN $16 ELSE last_known_lng END,
           last_known_at=CASE WHEN $17::boolean THEN $18 ELSE last_known_at END,
           updated_at=now()
         WHERE id=$19 AND search_id=$20
         RETURNING ${subjectColumns}`,
        [
          body.fullName !== undefined, body.fullName ?? null,
          body.age !== undefined, body.age ?? null,
          body.sex !== undefined, body.sex ?? null,
          body.description !== undefined, body.description ?? null,
          body.clothing !== undefined, body.clothing ?? null,
          body.medicalNotes !== undefined, body.medicalNotes ?? null,
          body.lastKnownLat !== undefined, body.lastKnownLat ?? null,
          body.lastKnownLng !== undefined, body.lastKnownLng ?? null,
          body.lastKnownAt !== undefined, body.lastKnownAt ?? null,
          subjectId, searchId,
        ],
      );
      if (!result.rowCount) throw httpErrors.notFound('Subject not found');
      const subject = result.rows[0];
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SUBJECT_UPDATED', { subjectId, fields: Object.keys(body) }],
      );
      await commitAuthorizedSearchTransaction(req, client);
      return subject;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default subjectRoutes;
