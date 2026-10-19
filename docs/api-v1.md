# PastQ Bank catalog API

## Sessions
All session endpoints use the service key. Except creation, they require `X-User-Ref`, which must match the opaque owner or return 404. Responses use `{data,meta}` or `{error:{code,message,details?}}`; responses are private and never expose answers, raw payload, provenance, or source ids.

`POST /api/v1/sessions` accepts `{user_ref,tier,mode,exam,year,subjects:[{slug,question_count?}],minutes?,order?,feedback?,missing_compulsory?}`. `POST /api/v1/sessions/:id/start` starts it idempotently. `GET /api/v1/sessions/:id` returns its summary. `GET /api/v1/sessions/:id/questions?from=1&limit=30` returns up to 60 presented questions and passage HTML. Errors include `invalid_config`, `premium_required`, `compulsory_subject_missing`, `not_enough_questions`, `too_many_active_sessions`, `not_started`, `session_finished`, and `not_found`.

Free sessions are restricted to the latest configured free years; mixed drills use only those years. If compulsory English is absent for a CBT year, the client may skip it or borrow from the nearest qualifying donor year; borrowing is premium-only when that donor year is not free.

All endpoints are server-to-server `GET` requests under `/api/v1`. Send `Authorization: Bearer <BANK_SERVICE_KEY>`. Responses use `{ data, meta: { generatedAt } }`; errors use `{ error: { code, message } }`. Responses are private and never cached. Catalog data contains metadata and counts only—never question text, options, answers, or payloads. `post-utme` is canonical; `post_utme` is accepted in URL parameters.

## Endpoints

- `GET /exams` lists every exam with its slug, name, profile summary, listable year count, subject count, and total published questions.
- `GET /exams/{exam}/profile` returns the editable profile, limits, notes, and subject overrides (`subject_slug`, `question_count`, `minutes`).
- `GET /exams/{exam}/years` returns newest-first listable years. Each has `published_count`, `subject_count`, `access` (`free` or `premium`), `practice_ready`, and `cbt` (`eligible`, `qualifyingSubjects`, optional `reason`).
- `GET /exams/{exam}/years/{year}/subjects` returns subject metadata for a listable year, including counts, passage/image flags, practice and CBT readiness, defaults, and year access.
- `GET /exams/{exam}/subjects` returns each subject's aggregate published count and year/count entries.

Unknown exams or years return 404 `not_found`; malformed years return 400 `bad_input`; missing or invalid credentials return 401, and an unconfigured service key returns 503.

## Rules

A year is listable when its total published question count is at least `min_questions_for_listing` (default 10). Free years are computed independently for each exam body from listable years sorted newest first; the first `free_year_count` (default 2) are free. A subject's required count is its profile override when present, otherwise the profile default. A subject qualifies when its published count is at least `ceil(required_count * qualify_ratio)` (default ratio 0.9). A year is CBT eligible when its compulsory subject qualifies, if one is configured, and at least `subjects_required` subjects qualify. Practice readiness uses `min_questions_for_practice` (default 5).
