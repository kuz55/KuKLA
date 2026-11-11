ALTER TABLE field_lead_proposals ADD COLUMN reminder_created_at timestamptz;
ALTER TABLE field_lead_notifications DROP CONSTRAINT field_lead_notifications_kind_check;
ALTER TABLE field_lead_notifications ADD CONSTRAINT field_lead_notifications_kind_check
  CHECK (kind IN ('PROPOSED','ACCEPTED','DECLINED','CANCELLED','NO_RESPONSE'));
CREATE INDEX field_lead_proposals_reminder_due_idx ON field_lead_proposals(created_at,id)
  WHERE reminder_created_at IS NULL;
