ALTER TABLE "conversation_nodes"
  ADD COLUMN IF NOT EXISTS "relation" varchar(32) DEFAULT 'main' NOT NULL;
ALTER TABLE "conversation_nodes"
  ADD COLUMN IF NOT EXISTS "inquiry_root_id" text;
ALTER TABLE "conversation_nodes"
  ADD COLUMN IF NOT EXISTS "focus_selection" jsonb;
CREATE INDEX IF NOT EXISTS "conversation_nodes_inquiry_root_idx"
  ON "conversation_nodes" ("inquiry_root_id");
