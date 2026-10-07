import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const id = (name: string) => text(name).primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const conversations = pgTable("conversations", {
  id: id("id"),
  workspaceId: text("workspace_id").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  summary: text("summary").notNull().default(""),
  color: varchar("color", { length: 16 }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceUpdated: index("conversations_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
}));

export const timelines = pgTable("timelines", {
  id: id("id"),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  parentTimelineId: text("parent_timeline_id"),
  forkedFromNodeId: text("forked_from_node_id"),
  name: varchar("name", { length: 200 }).notNull(),
  contextMode: varchar("context_mode", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  color: varchar("color", { length: 16 }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationStatusCreated: index("timelines_conversation_status_created_idx").on(table.conversationId, table.status, table.createdAt),
}));

export const conversationNodes = pgTable("conversation_nodes", {
  id: id("id"),
  timelineId: text("timeline_id").notNull().references(() => timelines.id),
  parentNodeId: text("parent_node_id"),
  relation: varchar("relation", { length: 32 }).notNull().default("main"),
  inquiryRootId: text("inquiry_root_id"),
  focusSelection: jsonb("focus_selection"),
  kind: varchar("kind", { length: 32 }).notNull(),
  content: text("content").notNull(),
  summary: varchar("summary", { length: 200 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
}, (table) => ({
  timelineCreated: index("conversation_nodes_timeline_created_idx").on(table.timelineId, table.createdAt),
  parent: index("conversation_nodes_parent_idx").on(table.parentNodeId),
  inquiryRoot: index("conversation_nodes_inquiry_root_idx").on(table.inquiryRootId),
}));

export const nodeSources = pgTable("node_sources", {
  nodeId: text("node_id").notNull().references(() => conversationNodes.id),
  sourceNodeId: text("source_node_id").notNull().references(() => conversationNodes.id),
  sourceType: varchar("source_type", { length: 32 }).notNull(),
  position: integer("position").notNull().default(0),
}, (table) => ({
  nodeSource: uniqueIndex("node_sources_node_source_idx").on(table.nodeId, table.sourceNodeId),
}));

export const referenceLinks = pgTable("reference_links", {
  id: id("id"),
  sourceNodeId: text("source_node_id").notNull().references(() => conversationNodes.id),
  targetNodeId: text("target_node_id").notNull().references(() => conversationNodes.id),
  label: varchar("label", { length: 200 }).notNull(),
  createdAt: createdAt(),
}, (table) => ({
  source: index("reference_links_source_idx").on(table.sourceNodeId),
  target: index("reference_links_target_idx").on(table.targetNodeId),
}));

export const threats = pgTable("threats", {
  id: id("id"),
  conversationId: text("conversation_id").notNull().references(() => conversations.id),
  nodeId: text("node_id").notNull().references(() => conversationNodes.id),
  title: varchar("title", { length: 200 }).notNull(),
  detail: text("detail").notNull().default(""),
  severity: varchar("severity", { length: 16 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  resolution: text("resolution"),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (table) => ({
  conversationStatus: index("threats_conversation_status_idx").on(table.conversationId, table.status),
  node: index("threats_node_idx").on(table.nodeId),
}));

export const turns = pgTable("turns", {
  id: id("id"),
  timelineId: text("timeline_id").notNull().references(() => timelines.id),
  userNodeId: text("user_node_id").notNull().references(() => conversationNodes.id),
  assistantNodeId: text("assistant_node_id").notNull().references(() => conversationNodes.id),
  status: varchar("status", { length: 16 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const turnEvents = pgTable("turn_events", {
  turnId: text("turn_id").notNull().references(() => turns.id),
  sequence: integer("sequence").notNull(),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
}, (table) => ({
  turnSequence: uniqueIndex("turn_events_turn_sequence_idx").on(table.turnId, table.sequence),
}));

export const idempotencyRecords = pgTable("idempotency_records", {
  id: id("id"),
  principal: text("principal").notNull(),
  route: varchar("route", { length: 200 }).notNull(),
  key: varchar("key", { length: 200 }).notNull(),
  requestHash: varchar("request_hash", { length: 64 }).notNull(),
  response: jsonb("response").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => ({
  lookup: uniqueIndex("idempotency_records_principal_route_key_idx").on(table.principal, table.route, table.key),
}));

export const outboxEvents = pgTable("outbox_events", {
  id: id("id"),
  aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: varchar("event_type", { length: 64 }).notNull(),
  payload: jsonb("payload").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => ({
  unpublished: index("outbox_events_unpublished_idx").on(table.publishedAt, table.createdAt),
}));
