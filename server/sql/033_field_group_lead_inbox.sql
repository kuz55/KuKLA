-- Private experimental inbox. Notification is not device delivery.
CREATE TABLE field_group_lead_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  search_id uuid NOT NULL,
  group_id uuid NOT NULL,
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('LEAD_PROPOSED','LEAD_ACCEPTED','LEAD_DECLINED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  FOREIGN KEY(group_id,search_id) REFERENCES field_groups(id,search_id) ON DELETE CASCADE,
  UNIQUE(recipient_id,proposal_id,kind)
);
CREATE INDEX field_group_lead_notifications_unread ON field_group_lead_notifications(recipient_id,created_at,id) WHERE acknowledged_at IS NULL;
