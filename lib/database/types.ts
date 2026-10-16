export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
export type QuestionStatus = "published" | "quarantined" | "archived";
export type ProviderKeyStatus = "active" | "exhausted" | "invalid" | "disabled";
export type ImportJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type ImportUnitStatus = "pending" | "running" | "done" | "empty" | "failed";
export type ExamSessionStatus = "active" | "submitted" | "expired";
export type ExamSessionMode = "exam" | "study";
export type ImportJobType = "year" | "range" | "resume";
export type OptionKey = "A" | "B" | "C" | "D" | "E";
export interface BankAdmin { user_id: string; email: string; created_at: string }
export interface Provider { id: string; code: string; name: string; is_enabled: boolean; created_at: string }
export interface ProviderKey { id: string; provider_id: string; label: string; env_var_name: string; status: ProviderKeyStatus; credits_remaining: number | null; credits_checked_at: string | null; exhausted_at: string | null; last_error: string | null; last_used_at: string | null; created_at: string; updated_at: string }
export interface Exam { id: string; slug: string; name: string; provider_code: string; is_active: boolean; created_at: string; updated_at: string }
export interface Subject { id: string; slug: string; name: string; created_at: string; updated_at: string }
export interface Topic { id: string; subject_id: string; parent_topic_id: string | null; slug: string; name: string; created_at: string }
export interface Question { id: string; provider_id: string; source_question_id: string; exam_id: string; subject_id: string; topic_id: string | null; subtopic: string | null; exam_year: number; question_number: number | null; text: string; options: Json; correct_answer: OptionKey | null; explanation: string | null; section: string | null; passage_group: string | null; has_passage: boolean; image_url: string | null; difficulty: number | null; estimated_time_seconds: number | null; country: string; institution: string | null; state: string | null; provenance: Json; raw_payload: Json; content_hash: string; status: QuestionStatus; quarantine_reasons: string[]; published_at: string | null; created_at: string; updated_at: string }
export interface ImportJob { id: string; provider_id: string; job_type: ImportJobType; scope: Json; status: ImportJobStatus; discovered_count: number; inserted_count: number; updated_count: number; skipped_count: number; quarantined_count: number; rejected_count: number; requests_made: number; credits_used: number; error_summary: string | null; created_by: string | null; created_at: string; started_at: string | null; completed_at: string | null; updated_at: string }
export interface ImportUnit { id: string; job_id: string; exam_slug: string; exam_year: number; status: ImportUnitStatus; cursor: string | null; pages_fetched: number; questions_seen: number; last_error: string | null; created_at: string; updated_at: string }
export interface ImportError { id: string; job_id: string; unit_id: string | null; source_question_id: string | null; error_code: string; message: string; payload: Json | null; created_at: string }
export interface ExamSession { id: string; client_ref: string | null; mode: ExamSessionMode; config: Json; status: ExamSessionStatus; started_at: string; deadline_at: string | null; submitted_at: string | null; duration_seconds: number | null; score: number | null; max_score: number | null; marking_version: string | null; created_at: string; updated_at: string }
export interface ExamSessionQuestion { session_id: string; position: number; question_id: string; marks: number; negative_marks: number }
export interface ExamSessionAnswer { session_id: string; question_id: string; selected_option: OptionKey | null; is_flagged: boolean; answered_at: string | null; updated_at: string }
export interface AdminAuditLog { id: string; admin_user_id: string | null; action: string; entity: string | null; entity_id: string | null; details: Json | null; created_at: string }
export interface SchemaStatus { table_name: string; rls_enabled: boolean }
