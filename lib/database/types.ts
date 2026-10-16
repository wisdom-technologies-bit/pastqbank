export type ProviderStatus = "active" | "exhausted" | "invalid" | "disabled";
export type QuestionStatus = "published" | "quarantined" | "archived";
export type ImportJobType = "year" | "range" | "resume";
export type ImportJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ImportUnitStatus = "pending" | "running" | "done" | "empty" | "failed";
export type SessionMode = "exam" | "study";
export type SessionStatus = "active" | "submitted" | "expired";
export type OptionKey = "A" | "B" | "C" | "D" | "E";
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
export interface BankAdmin { user_id: string; email: string; created_at: string }
export interface Provider { id: string; code: string; name: string; is_enabled: boolean; created_at: string }
export interface ProviderKey { id: string; provider_id: string; label: string; env_var_name: string; status: ProviderStatus; credits_remaining: number | null; credits_checked_at: string | null; exhausted_at: string | null; last_error: string | null; last_used_at: string | null; created_at: string; updated_at: string }
export interface Exam { id: string; slug: string; name: string; provider_code: string; is_active: boolean; created_at: string; updated_at: string }
export interface Subject { id: string; slug: string; name: string; created_at: string; updated_at: string }
export interface Topic { id: string; subject_id: string; parent_topic_id: string | null; slug: string; name: string; created_at: string }
export interface Question { id: string; provider_id: string; source_question_id: string; exam_id: string; subject_id: string; topic_id: string | null; subtopic: string | null; exam_year: number; question_number: number | null; text: string; options: Record<OptionKey, string>; correct_answer: OptionKey | null; explanation: string | null; section: string | null; passage_group: string | null; has_passage: boolean; image_url: string | null; difficulty: number | null; estimated_time_seconds: number | null; country: string; institution: string | null; state: string | null; provenance: Json; raw_payload: Json; content_hash: string; status: QuestionStatus; quarantine_reasons: string[]; published_at: string | null; created_at: string; updated_at: string }
export interface SchemaStatus { table_name: string; rls_enabled: boolean }
