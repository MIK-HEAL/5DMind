CREATE TABLE IF NOT EXISTS "conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "title" varchar(200) NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "color" varchar(16) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "conversations_workspace_updated_idx" ON "conversations" ("workspace_id", "updated_at");
CREATE TABLE IF NOT EXISTS "timelines" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL REFERENCES "conversations"("id"),
  "parent_timeline_id" text,
  "forked_from_node_id" text,
  "name" varchar(200) NOT NULL,
  "context_mode" varchar(32) NOT NULL,
  "status" varchar(16) DEFAULT 'active' NOT NULL,
  "color" varchar(16) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "timelines_conversation_status_created_idx" ON "timelines" ("conversation_id", "status", "created_at");
CREATE TABLE IF NOT EXISTS "conversation_nodes" (
  "id" text PRIMARY KEY NOT NULL,
  "timeline_id" text NOT NULL REFERENCES "timelines"("id"),
  "parent_node_id" text,
  "kind" varchar(32) NOT NULL,
  "content" text NOT NULL,
  "summary" varchar(200) NOT NULL,
  "status" varchar(16) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "conversation_nodes_timeline_created_idx" ON "conversation_nodes" ("timeline_id", "created_at");
CREATE INDEX IF NOT EXISTS "conversation_nodes_parent_idx" ON "conversation_nodes" ("parent_node_id");
CREATE TABLE IF NOT EXISTS "node_sources" (
  "node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "source_node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "source_type" varchar(32) NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "node_sources_node_source_idx" UNIQUE ("node_id", "source_node_id")
);
CREATE TABLE IF NOT EXISTS "reference_links" (
  "id" text PRIMARY KEY NOT NULL,
  "source_node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "target_node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "label" varchar(200) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "reference_links_source_idx" ON "reference_links" ("source_node_id");
CREATE INDEX IF NOT EXISTS "reference_links_target_idx" ON "reference_links" ("target_node_id");
CREATE TABLE IF NOT EXISTS "threats" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL REFERENCES "conversations"("id"),
  "node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "title" varchar(200) NOT NULL,
  "detail" text DEFAULT '' NOT NULL,
  "severity" varchar(16) NOT NULL,
  "status" varchar(16) DEFAULT 'open' NOT NULL,
  "resolution" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "resolved_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "threats_conversation_status_idx" ON "threats" ("conversation_id", "status");
CREATE INDEX IF NOT EXISTS "threats_node_idx" ON "threats" ("node_id");
CREATE TABLE IF NOT EXISTS "turns" (
  "id" text PRIMARY KEY NOT NULL,
  "timeline_id" text NOT NULL REFERENCES "timelines"("id"),
  "user_node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "assistant_node_id" text NOT NULL REFERENCES "conversation_nodes"("id"),
  "status" varchar(16) NOT NULL,
  "model" varchar(100) NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "completed_at" timestamptz
);
CREATE TABLE IF NOT EXISTS "turn_events" (
  "turn_id" text NOT NULL REFERENCES "turns"("id"),
  "sequence" integer NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "turn_events_turn_sequence_idx" UNIQUE ("turn_id", "sequence")
);
CREATE TABLE IF NOT EXISTS "idempotency_records" (
  "id" text PRIMARY KEY NOT NULL,
  "principal" text NOT NULL,
  "route" varchar(200) NOT NULL,
  "key" varchar(200) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "response" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "idempotency_records_principal_route_key_idx" UNIQUE ("principal", "route", "key")
);
CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" text PRIMARY KEY NOT NULL,
  "aggregate_type" varchar(64) NOT NULL,
  "aggregate_id" text NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "published_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "outbox_events_unpublished_idx" ON "outbox_events" ("published_at", "created_at");
