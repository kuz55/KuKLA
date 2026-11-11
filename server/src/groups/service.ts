import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

type Action = 'ADD' | 'REMOVE';
export class FieldGroupsService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  private async lockSearch(c: PoolClient, searchId: string) {
    const r = await c.query('SELECT status FROM searches WHERE id=$1 FOR UPDATE',[searchId]);
    if (!r.rowCount) throw httpErrors.notFound('Search not found');
    if (!['PLANNED','ACTIVE','PAUSED'].includes(r.rows[0].status as string)) throw httpErrors.conflict('Search is not open');
  }
  private async fieldLead(c: PoolClient, searchId: string, actor: string) {
    const r = await c.query(`SELECT f.user_id FROM search_field_leads f
      JOIN field_lead_eligibility e ON e.user_id=f.user_id JOIN users u ON u.id=f.user_id
      WHERE f.search_id=$1 AND f.user_id=$2 AND u.active=true FOR SHARE OF f,e,u`,[searchId,actor]);
    if (!r.rowCount) throw httpErrors.forbidden('Current active field lead required');
  }
  private async group(c: PoolClient, searchId: string, groupId: string) {
    const r = await c.query('SELECT id FROM field_groups WHERE search_id=$1 AND id=$2',[searchId,groupId]);
    if (!r.rowCount) throw httpErrors.notFound('Group not found');
  }
  private async member(c: PoolClient, searchId: string, target: string, requireActive = true) {
    const r = await c.query(`SELECT m.user_id FROM search_members m JOIN users u ON u.id=m.user_id
      WHERE m.search_id=$1 AND m.user_id=$2 AND ($3::boolean = false OR u.active=true) FOR SHARE OF m,u`,[searchId,target,requireActive]);
    if (!r.rowCount) throw httpErrors.notFound(requireActive ? 'Active search member not found' : 'Search member not found');
  }
  private async groupLead(c: PoolClient, searchId: string, groupId: string, actor: string) {
    const r = await c.query(`SELECT l.user_id FROM field_group_leads l
      JOIN users u ON u.id=l.user_id AND u.active=true JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
      WHERE l.search_id=$1 AND l.group_id=$2 AND l.user_id=$3 FOR SHARE OF l,u,m`,[searchId,groupId,actor]);
    if (!r.rowCount) throw httpErrors.forbidden('Current active group lead required');
  }
  private async event(c: PoolClient, searchId: string, actor: string, type: string, payload: object) {
    await c.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',[searchId,actor,type,payload]);
  }
  async create(actor: string, searchId: string, title: string, candidate: string, requestId: string) {
    if (title.trim().length < 2 || title.trim().length > 200) throw httpErrors.badRequest('Invalid group title');
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.fieldLead(c,searchId,actor);
      const previous=await c.query(`SELECT group_id,proposal_id,(initial_title=$4 AND initial_candidate_id=$5) AS matches
        FROM field_group_create_receipts WHERE search_id=$1 AND actor_id=$2 AND request_id=$3`,
      [searchId,actor,requestId,title.trim(),candidate]);
      if (previous.rowCount) {
        if (!previous.rows[0].matches) throw httpErrors.conflict('Request ID already used for a different group');
        return {groupId:previous.rows[0].group_id as string,proposalId:previous.rows[0].proposal_id as string};
      }
      await this.member(c,searchId,candidate);
      const group = await c.query('INSERT INTO field_groups(search_id,title,created_by) VALUES($1,$2,$3) RETURNING id',[searchId,title.trim(),actor]);
      const id = group.rows[0].id as string;
      const proposal = await c.query('INSERT INTO field_group_lead_proposals(group_id,search_id,candidate_id,proposed_by) VALUES($1,$2,$3,$4) RETURNING id',[id,searchId,candidate,actor]);
      await c.query(`INSERT INTO field_group_create_receipts(group_id,search_id,actor_id,request_id,initial_title,initial_candidate_id,proposal_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,searchId,actor,requestId,title.trim(),candidate,proposal.rows[0].id]);
      await this.event(c,searchId,actor,'FIELD_GROUP_CREATED',{groupId:id, candidateId:candidate, proposalId:proposal.rows[0].id});
      return {groupId:id, proposalId:proposal.rows[0].id as string};
    });
  }
  async proposeLead(actor: string, searchId: string, groupId: string, candidate: string, requestId: string) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.fieldLead(c,searchId,actor);
      const receipt=await c.query(`SELECT proposal_id,(group_id=$4 AND candidate_id=$5) AS matches
        FROM field_group_lead_proposal_receipts WHERE search_id=$1 AND actor_id=$2 AND request_id=$3`,
      [searchId,actor,requestId,groupId,candidate]);
      if (receipt.rowCount) {
        if (!receipt.rows[0].matches) throw httpErrors.conflict('Request ID already used for a different proposal');
        return {proposalId:receipt.rows[0].proposal_id as string};
      }
      await this.group(c,searchId,groupId); await this.member(c,searchId,candidate);
      const lead = await c.query('SELECT 1 FROM field_group_leads WHERE group_id=$1',[groupId]);
      if (lead.rowCount) throw httpErrors.conflict('Group already has an accepted lead');
      const proposal = await c.query(`INSERT INTO field_group_lead_proposals(group_id,search_id,candidate_id,proposed_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(group_id) DO NOTHING RETURNING id`,[groupId,searchId,candidate,actor]);
      if (!proposal.rowCount) throw httpErrors.conflict('A proposal is already pending');
      await c.query(`INSERT INTO field_group_lead_proposal_receipts(proposal_id,group_id,search_id,actor_id,request_id,candidate_id)
        VALUES($1,$2,$3,$4,$5,$6)`,[proposal.rows[0].id,groupId,searchId,actor,requestId,candidate]);
      await this.event(c,searchId,actor,'FIELD_GROUP_LEAD_PROPOSED',{groupId,candidateId:candidate,proposalId:proposal.rows[0].id});
      return {proposalId:proposal.rows[0].id as string};
    });
  }
  async myProposals(actor: string, searchId: string) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.member(c,searchId,actor);
      return (await c.query(`SELECT id,group_id,created_at FROM field_group_lead_proposals
        WHERE search_id=$1 AND candidate_id=$2 ORDER BY created_at,id LIMIT 100`,[searchId,actor])).rows;
    });
  }
  async list(actor: string, searchId: string, after?: string, limit = 50) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId);
      const active = await c.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE',[actor]);
      if (!active.rowCount) throw httpErrors.forbidden('Active user required');
      const field = await c.query(`SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id
        WHERE f.search_id=$1 AND f.user_id=$2`,[searchId,actor]);
      const result = await c.query(`SELECT g.id,g.title,g.created_at FROM field_groups g
        WHERE g.search_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM field_group_leads l WHERE l.group_id=g.id AND l.user_id=$2))
        AND ($4::uuid IS NULL OR g.id>$4::uuid) ORDER BY g.id LIMIT $5`,[searchId,actor,!!field.rowCount,after ?? null,limit+1]);
      const items=result.rows.slice(0,limit);
      return {items,nextCursor:result.rows.length>limit ? items[items.length-1].id as string : null};
    });
  }
  private async reader(c: PoolClient, searchId: string, groupId: string, actor: string) {
    const active = await c.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE',[actor]);
    if (!active.rowCount) throw httpErrors.forbidden('Active user required');
    const access = await c.query(`SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id
      WHERE f.search_id=$1 AND f.user_id=$3
      UNION ALL SELECT 1 FROM field_group_leads l JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
      WHERE l.search_id=$1 AND l.group_id=$2 AND l.user_id=$3 LIMIT 1`,[searchId,groupId,actor]);
    if (!access.rowCount) throw httpErrors.forbidden('Group or field lead required');
  }
  async groupState(actor: string, searchId: string, groupId: string) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.group(c,searchId,groupId); await this.reader(c,searchId,groupId,actor);
      const g = await c.query('SELECT id,title,created_at FROM field_groups WHERE id=$1 AND search_id=$2',[groupId,searchId]);
      const lead = await c.query('SELECT user_id,accepted_at FROM field_group_leads WHERE group_id=$1',[groupId]);
      const proposal = await c.query('SELECT id,candidate_id,created_at FROM field_group_lead_proposals WHERE group_id=$1',[groupId]);
      const members = await c.query('SELECT user_id,joined_at FROM field_group_members WHERE group_id=$1 ORDER BY joined_at,user_id',[groupId]);
      const proposals = await c.query('SELECT id,user_id,proposed_by,action,created_at FROM field_group_member_proposals WHERE group_id=$1 ORDER BY created_at,id LIMIT 100',[groupId]);
      return {group:g.rows[0],lead:lead.rows[0] ?? null,leadProposal:proposal.rows[0] ?? null,members:members.rows,memberProposals:proposals.rows};
    });
  }
  async audit(actor:string, searchId:string, groupId:string, before:string|undefined, limit:number) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.group(c,searchId,groupId); await this.reader(c,searchId,groupId,actor);
      // Whitelist event types and fields rather than exposing generic payloads.
      const r=await c.query(`SELECT id::text,user_id,type,created_at,
        jsonb_strip_nulls(jsonb_build_object('userId',payload->'userId','candidateId',payload->'candidateId',
          'proposalId',payload->'proposalId','action',payload->'action')) AS details FROM events
        WHERE search_id=$1 AND payload->>'groupId'=$2 AND type=ANY($3::text[])
        AND ($4::bigint IS NULL OR id<$4::bigint) ORDER BY events.id DESC LIMIT $5`,
      [searchId,groupId,['FIELD_GROUP_CREATED','FIELD_GROUP_LEAD_PROPOSED','FIELD_GROUP_LEAD_ACCEPTED',
        'FIELD_GROUP_LEAD_DECLINED','FIELD_GROUP_MEMBER_CHANGED','FIELD_GROUP_MEMBER_PROPOSED',
        'FIELD_GROUP_MEMBER_APPROVED','FIELD_GROUP_MEMBER_REJECTED'],before ?? null,limit+1]);
      const items=r.rows.slice(0,limit);
      return {items,nextCursor:r.rows.length>limit ? items[items.length-1].id as string : null};
    });
  }
  async respond(actor: string, searchId: string, groupId: string, proposalId: string, accept: boolean) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.group(c,searchId,groupId); await this.member(c,searchId,actor);
      const receipt=await c.query(`SELECT accepted FROM field_group_lead_response_receipts
        WHERE proposal_id=$1 AND search_id=$2 AND group_id=$3 AND candidate_id=$4`,[proposalId,searchId,groupId,actor]);
      if (receipt.rowCount) {
        if (receipt.rows[0].accepted !== accept) throw httpErrors.conflict('Proposal already decided differently');
        return {accepted:accept};
      }
      const proposal = await c.query(`DELETE FROM field_group_lead_proposals
        WHERE search_id=$1 AND group_id=$2 AND id=$3 AND candidate_id=$4 RETURNING proposed_by`,[searchId,groupId,proposalId,actor]);
      if (!proposal.rowCount) throw httpErrors.notFound('Proposal not found');
      await c.query(`INSERT INTO field_group_lead_response_receipts(proposal_id,group_id,search_id,candidate_id,accepted)
        VALUES($1,$2,$3,$4,$5)`,[proposalId,groupId,searchId,actor,accept]);
      if (accept) {
        await c.query('INSERT INTO field_group_leads(group_id,search_id,user_id) VALUES($1,$2,$3)',[groupId,searchId,actor]);
        await c.query('INSERT INTO field_group_members(group_id,search_id,user_id) VALUES($1,$2,$3)',[groupId,searchId,actor]);
      }
      await this.event(c,searchId,actor,accept?'FIELD_GROUP_LEAD_ACCEPTED':'FIELD_GROUP_LEAD_DECLINED',{groupId,proposalId});
      return {accepted:accept};
    });
  }
  async change(c: PoolClient, searchId: string, groupId: string, target: string, action: Action) {
    // An inactive person cannot be added, but must still be removable from a roster.
    await this.member(c,searchId,target,action === 'ADD');
    if (action === 'ADD') {
      const added = await c.query(`INSERT INTO field_group_members(group_id,search_id,user_id) VALUES($1,$2,$3)
        ON CONFLICT(group_id,user_id) DO NOTHING RETURNING user_id`,[groupId,searchId,target]);
      if (!added.rowCount) throw httpErrors.conflict('Already a group member');
    } else {
      const lead = await c.query('SELECT 1 FROM field_group_leads WHERE group_id=$1 AND user_id=$2',[groupId,target]);
      if (lead.rowCount) throw httpErrors.conflict('Group lead cannot be removed by this operation');
      const removed = await c.query('DELETE FROM field_group_members WHERE group_id=$1 AND user_id=$2 RETURNING user_id',[groupId,target]);
      if (!removed.rowCount) throw httpErrors.conflict('Not a group member');
    }
  }
  async apply(actor: string, searchId: string, groupId: string, target: string, action: Action, requestId:string) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.fieldLead(c,searchId,actor);
      const previous=await c.query(`SELECT (group_id=$4 AND target_id=$5 AND action=$6) AS matches
        FROM field_group_member_change_receipts WHERE search_id=$1 AND actor_id=$2 AND request_id=$3`,
      [searchId,actor,requestId,groupId,target,action]);
      if (previous.rowCount) {
        if (!previous.rows[0].matches) throw httpErrors.conflict('Request ID already used for a different roster change');
        return {changed:true};
      }
      await this.group(c,searchId,groupId); await this.change(c,searchId,groupId,target,action);
      // Any proposal for this member is stale after a direct decision.
      await c.query('DELETE FROM field_group_member_proposals WHERE group_id=$1 AND user_id=$2',[groupId,target]);
      await c.query(`INSERT INTO field_group_member_change_receipts(group_id,search_id,actor_id,request_id,target_id,action)
        VALUES($1,$2,$3,$4,$5,$6)`,[groupId,searchId,actor,requestId,target,action]);
      await this.event(c,searchId,actor,'FIELD_GROUP_MEMBER_CHANGED',{groupId,userId:target,action});
      return {changed:true};
    });
  }
  async propose(actor: string, searchId: string, groupId: string, target: string, action: Action, requestId:string) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.groupLead(c,searchId,groupId,actor);
      const previous=await c.query(`SELECT proposal_id,(group_id=$4 AND target_id=$5 AND action=$6) AS matches
        FROM field_group_member_proposal_receipts WHERE search_id=$1 AND actor_id=$2 AND request_id=$3`,
      [searchId,actor,requestId,groupId,target,action]);
      if (previous.rowCount) {
        if (!previous.rows[0].matches) throw httpErrors.conflict('Request ID already used for a different roster proposal');
        return {proposalId:previous.rows[0].proposal_id as string};
      }
      await this.group(c,searchId,groupId); await this.member(c,searchId,target,action === 'ADD');
      const present = await c.query('SELECT 1 FROM field_group_members WHERE group_id=$1 AND user_id=$2',[groupId,target]);
      if ((action === 'ADD') === Boolean(present.rowCount)) throw httpErrors.conflict('Change does not match current membership');
      if (action === 'REMOVE' && actor === target) throw httpErrors.conflict('Group lead cannot be removed by this operation');
      const r = await c.query(`INSERT INTO field_group_member_proposals(group_id,search_id,user_id,proposed_by,action)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(group_id,user_id) DO NOTHING RETURNING id`,[groupId,searchId,target,actor,action]);
      if (!r.rowCount) throw httpErrors.conflict('A proposal is already pending');
      await c.query(`INSERT INTO field_group_member_proposal_receipts(proposal_id,group_id,search_id,actor_id,request_id,target_id,action)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[r.rows[0].id,groupId,searchId,actor,requestId,target,action]);
      await this.event(c,searchId,actor,'FIELD_GROUP_MEMBER_PROPOSED',{groupId,proposalId:r.rows[0].id,userId:target,action});
      return {proposalId:r.rows[0].id as string};
    });
  }
  async decide(actor: string, searchId: string, groupId: string, proposalId: string, approve: boolean) {
    return this.tx(async c => {
      await this.lockSearch(c,searchId); await this.fieldLead(c,searchId,actor); await this.group(c,searchId,groupId);
      const receipt=await c.query(`SELECT actor_id,approved FROM field_group_member_decision_receipts
        WHERE proposal_id=$1 AND group_id=$2 AND search_id=$3`,[proposalId,groupId,searchId]);
      if (receipt.rowCount) {
        if (receipt.rows[0].actor_id!==actor || receipt.rows[0].approved!==approve) throw httpErrors.conflict('Proposal already decided differently');
        return {approved:approve};
      }
      const r = await c.query(`SELECT user_id,action,proposed_by FROM field_group_member_proposals WHERE id=$1 AND group_id=$2 AND search_id=$3`,[proposalId,groupId,searchId]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      if (approve) {
        await this.groupLead(c,searchId,groupId,r.rows[0].proposed_by as string);
        await this.change(c,searchId,groupId,r.rows[0].user_id as string,r.rows[0].action as Action);
      }
      await c.query('DELETE FROM field_group_member_proposals WHERE id=$1',[proposalId]);
      await c.query(`INSERT INTO field_group_member_decision_receipts(proposal_id,group_id,search_id,actor_id,approved)
        VALUES($1,$2,$3,$4,$5)`,[proposalId,groupId,searchId,actor,approve]);
      await this.event(c,searchId,actor,approve?'FIELD_GROUP_MEMBER_APPROVED':'FIELD_GROUP_MEMBER_REJECTED',{groupId,proposalId,userId:r.rows[0].user_id,action:r.rows[0].action});
      return {approved:approve};
    });
  }
}
