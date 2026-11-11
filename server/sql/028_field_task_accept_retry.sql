-- Legacy experimental tasks may have been accepted before receipts existed.
ALTER TABLE field_tasks ADD COLUMN accept_request_id uuid;
ALTER TABLE field_tasks ADD COLUMN accepted_by uuid REFERENCES users(id);
ALTER TABLE field_tasks ADD CONSTRAINT field_task_accept_receipt_pair
  CHECK ((accept_request_id IS NULL) = (accepted_by IS NULL));
