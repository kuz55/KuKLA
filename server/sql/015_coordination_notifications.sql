-- Private in-app inbox for the experimental coordinator-transfer workflow.
-- Contents carry only identifiers and a type; they do not copy report data or
-- transfer reasons. An acknowledgment is distinct from delivery.
-- Transfers are removed on resolution; their opaque identifier remains in the
-- inbox so an old alert cannot be confused with a later request for the search.
ALTER TABLE coordinator_transfers ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX coordinator_transfers_id_idx ON coordinator_transfers(id);

CREATE TABLE coordination_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  search_id uuid NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TRANSFER_REQUESTED','TRANSFER_ACCEPTED','TRANSFER_DECLINED','TRANSFER_CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX coordination_notifications_unread_idx
  ON coordination_notifications (recipient_id, created_at, id) WHERE acknowledged_at IS NULL;
