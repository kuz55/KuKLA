-- Private experimental inbox; it stores no applicant data or free-text reasons.
CREATE TABLE field_lead_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  audience text NOT NULL CHECK (audience IN ('CANDIDATE', 'MANAGER')),
  kind text NOT NULL CHECK (kind IN ('PROPOSED','ACCEPTED','DECLINED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE(recipient_id,proposal_id,kind)
);
CREATE INDEX field_lead_notifications_unread_idx
  ON field_lead_notifications(recipient_id,created_at,id) WHERE acknowledged_at IS NULL;
