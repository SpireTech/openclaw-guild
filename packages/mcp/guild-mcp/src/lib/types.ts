// ── Knowledge Store ──

export interface KnowledgeChunk {
  id: string;
  source_system: string;
  source_id: string;
  source_url: string | null;
  content: string;
  summary: string | null;
  embedding_model: string;
  client_id: string | null;
  visibility: string;
  data_type: string;
  category: string | null;
  product_name: string | null;
  error_code: string | null;
  tags: string[];
  status: "active" | "invalidated";
  embedded_at: string;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  name: string;
  status: "active" | "inactive" | "prospect";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IngestionLog {
  id: string;
  source_system: string;
  status: "running" | "completed" | "failed";
  records_processed: number;
  records_failed: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

// ── Memory ──

export interface AgentMemory {
  id: string;
  agent_id: string;
  namespace: string;
  key: string;
  value: string;
  confidence: number | null;
  source: string | null;
  tags: string[];
  status: "active" | "archived" | "superseded";
  access_count: number;
  last_accessed_at: string | null;
  review_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserMemory {
  id: string;
  user_id: string;
  namespace: string;
  key: string;
  value: string;
  tags: string[];
  status: "active" | "archived" | "superseded";
  written_by: string;
  written_by_type: "user" | "agent";
  created_at: string;
  updated_at: string;
}

export interface RoleMemory {
  id: string;
  role: string;
  namespace: string;
  key: string;
  value: string;
  client_id: string | null;
  tags: string[];
  status: "active" | "archived" | "superseded";
  supersedes: string | null;
  written_by: string;
  written_by_type: "user" | "agent";
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyMemory {
  id: string;
  namespace: string;
  key: string;
  value: string;
  client_id: string | null;
  tags: string[];
  status: "active" | "archived" | "superseded";
  supersedes: string | null;
  written_by: string;
  written_by_type: "user" | "agent";
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryPromotion {
  id: string;
  source_type: "agent_memory" | "user_memory" | "role_memory";
  source_id: string;
  target_type: "role_memory" | "company_memory";
  target_role: string | null;
  proposed_by: string;
  proposed_by_type: "user" | "agent";
  proposed_namespace: string;
  proposed_key: string;
  proposed_value: string;
  proposed_client_id: string | null;
  proposed_tags: string[];
  status: "pending" | "approved" | "rejected" | "expired";
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_memory_id: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  actor_id: string;
  actor_type: "user" | "agent";
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface UserAgentGrant {
  id: string;
  user_id: string;
  agent_id: string;
  scopes: string[];
  granted_at: string;
  expires_at: string | null;
}

// ── Skills ──

export interface Skill {
  id: string;
  name: string;
  slug: string;
  scope: "company" | "role" | "individual";
  scope_value: string | null;
  description: string | null;
  current_version: number;
  status: "draft" | "published" | "deprecated";
  tags: string[];
  metadata: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version: number;
  content: string;
  change_note: string | null;
  created_by: string;
  published_at: string | null;
  created_at: string;
}

export interface SkillAssignment {
  id: string;
  skill_id: string;
  assignee_id: string;
  assignee_type: "agent" | "user";
  is_enabled: boolean;
  assigned_by: string;
  created_at: string;
}

export interface ResolvedSkill {
  skill: Skill;
  content?: string;
  source: "company" | "role" | "individual" | "assignment";
  is_enabled: boolean;
}

// ── MCP helpers ──

export interface McpTextContent {
  type: "text";
  text: string;
}

export function mcpJson(data: unknown): { content: McpTextContent[] } {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
