# PastQ Bank API v1 (contract for the PastQ app)

Base URL: `BANK_API_URL` (https://pastqbank.vercel.app). All paths below are under `/api/v1`.

## Conventions

- Server-to-server only. Send `Authorization: Bearer <BANK_SERVICE_KEY>` on every request. The key must never reach a browser.
- Success: `{ "data": ..., "meta": { "generatedAt": "ISO time" } }`. Paged lists add `meta.from` and `meta.limit`.
- Error: `{ "error": { "code": "string", "message": "string", "details"?: any } }`.
- Auth errors: 401 for a missing or invalid key; 503 when the Bank has no service key configured.
- Every response is private and uncacheable (`Cache-Control: private, no-store`). PastQ may cache CATALOG responses itself for a few minutes. It must never store question content, options, answers or passages anywhere.
- `post-utme` is the canonical exam slug (`post_utme` is also accepted in URL parameters). Exam slugs: `jamb`, `waec`, `neco`, `post-utme`.
- Session endpoints (everything under `/sessions`) require `X-User-Ref: <opaque user id>`. It must match the `user_ref` the session was created with, otherwise the response is 404 `not_found`. PastQ sends its own user id as `user_ref`.
- Paging is 1-based: `from=1` is question number 1. Every question item has a 1-based `number` in session order.
- Unknown exams or years: 404 `not_found`. Malformed year: 400 `bad_input`.

## Catalog (metadata and counts only; GET)

### GET /exams
```json
{"data":[
 {"slug":"jamb","name":"JAMB UTME",
  "profile":{"subjects_required":4,"default_question_count":40,"default_minutes":120,"shared_timer":true,"total_minutes":120},
  "listable_year_count":30,"subject_count":12,"total_published_questions":9898},
 {"slug":"waec","name":"WAEC WASSCE",
  "profile":{"subjects_required":1,"default_question_count":50,"default_minutes":60,"shared_timer":false,"total_minutes":null},
  "listable_year_count":21,"subject_count":11,"total_published_questions":2241}
],"meta":{"generatedAt":"..."}}
```
`default_question_count` and `default_minutes` are per subject; when `shared_timer` is true, `total_minutes` is the single timer for the whole exam, otherwise it is null.

### GET /exams/{exam}/profile
```json
{"data":{"id":"uuid","exam_slug":"jamb","display_name":"JAMB UTME",
 "subjects_required":4,"compulsory_subject_slug":"english-language","shared_timer":true,"total_minutes":120,
 "default_question_count":40,"default_minutes":120,
 "min_questions":5,"max_questions":100,"min_minutes":5,"max_minutes":240,
 "verified":false,"notes":"4 subjects, 180 questions, 2 hours, English 60 and others 40.",
 "subjects":[{"subject_slug":"english-language","question_count":60,"minutes":null}]}}
```
`compulsory_subject_slug` may be null. `subjects` holds per-subject overrides of the defaults. `min_*`/`max_*` are the limits a student's custom question count and minutes must respect.

### GET /exams/{exam}/years
Newest first. Only listable years appear.
```json
{"data":[
 {"year":2026,"published_count":162,"subject_count":4,"access":"free","practice_ready":true,
  "cbt":{"eligible":true,"qualifyingSubjects":["chemistry","government","mathematics","physics"],"missingCompulsory":"english-language"}},
 {"year":2019,"published_count":...,"subject_count":...,"access":"premium","practice_ready":true,
  "cbt":{"eligible":true,"qualifyingSubjects":["..."]}}
]}
```
- `access` is `"free"` or `"premium"`. Free years are the newest 2 listable years of each exam (computed per exam). This is the single source of truth for padlocks.
- `cbt.eligible` says whether a CBT can be built for that year; `cbt.reason` explains when it is false. `cbt.missingCompulsory` (a subject slug) is present when the compulsory subject (for example English) lacks enough questions that year.
- `practice_ready` is false when the year has too few questions to practise.

### GET /exams/{exam}/years/{year}/subjects
```json
{"data":{"access":"premium","subjects":[
 {"slug":"english-language","name":"English Language","published_count":108,"passage_count":30,
  "has_images":false,"practice_ready":true,"cbt_ready":true,
  "default_question_count":60,"default_minutes":120}
]}}
```
Subjects come in alphabetical order. Put the compulsory subject first in the UI (its slug is `compulsory_subject_slug` in the exam profile).

### GET /exams/{exam}/years/{year}/cbt-plan?tier=free|premium
```json
{"data":{"compulsorySubject":"english-language","missing":true,
 "qualifyingSubjects":["accounting","chemistry","government","mathematics","physics"],
 "minSubjects":4,"maxSubjects":4,
 "borrow":{"available":true,"donorYear":2022,"requiresActivation":false}}}
```
- `missing: false` means the compulsory subject is available for that year; `compulsorySubject` and `borrow` may then be null.
- When `missing: true`, the student may continue without it or, if `borrow.available`, borrow it from `borrow.donorYear`. `borrow.requiresActivation: true` means borrowing needs a premium account.
- `minSubjects`/`maxSubjects` bound how many subjects the student picks.

### GET /exams/{exam}/subjects
Per-subject totals with the year breakdown:
```json
{"data":[{"slug":"accounting","name":"Accounting","total_published":1368,
 "years":[{"year":2025,"published_count":40},{"year":2024,"published_count":40}]}]}
```

## Sessions

### POST /sessions (create)
Body:
```json
{"user_ref":"<id>","tier":"free|premium","mode":"practice|cbt","exam":"jamb","year":2019,
 "subjects":[{"slug":"mathematics","question_count":40}],
 "minutes":120,"order":"...optional","feedback":"instant|end (optional)","missing_compulsory":"skip|borrow (optional)"}
```
- Practice sessions default to `feedback_mode: "instant"`; CBT sessions to `"end"`.
- Free-tier sessions are only allowed for free years (otherwise 403/422 `premium_required`). Omitting `year` creates a mixed drill drawn from the free years for free users.
- `missing_compulsory` is used only when the CBT plan says the compulsory subject is missing.
- Selection keeps passage questions together, so the actual `total_questions` can slightly exceed the request.
- A user may have at most 5 active sessions (`too_many_active_sessions`).

Response `data` includes: `id`, `status` ("created"), `mode`, `exam`, `year`, `tier`, `total_questions`, `duration_seconds` (null for practice), `feedback_mode`, `subjects:[{slug,name,question_count,borrowed_from_year}]`.

Error codes: `invalid_config`, `premium_required`, `compulsory_subject_missing`, `not_enough_questions`, `too_many_active_sessions`.

### POST /sessions/{id}/start
Idempotent. Moves status to `in_progress` and, for timed sessions, sets the server deadline. The response data includes `id`, `user_ref`, `status`, `mode`, `exam_slug`, `exam_year`, `tier`, `total_questions`, `duration_seconds`, `feedback_mode`, and the timing fields (`started_at`, `deadline_at`). The server deadline is the only authority on time.

### GET /sessions/{id}
Summary of the session: same fields as above, plus `progress:{answered,total,flagged}` and `result_available`.

### GET /sessions/{id}/questions?from=1&limit=30
Up to 60 per call; session must be started (`not_started`) and not finished (`session_finished`). Each item has: `ref` (opaque id used for answers), `number`, `subject`, `passage` (object or null; passage HTML is included for passage questions), `question:{text, image_url?}`, `options:[{key:"A",text:"..."}]`, and the student's saved `your_choice` and `flagged` when present. Flag-only updates are reflected here and in `progress.flagged`. Answers are never included here. Question text and passages may contain simple HTML; sanitise before rendering.

### PUT /sessions/{id}/answers
Body: `{"answers":[{"ref":"<question ref>","choice":"A","flagged":false}]}` with 1 to 60 items. An item may omit `choice` (the key must be absent, not `null`) when it contains a boolean `flagged`; this updates only the flag in both modes, preserves any saved answer, does not lock an unanswered instant-mode question, and reveals no correctness. A `null` choice clears an answer (CBT only).
- Instant (practice) mode: the first answer to a question is locked (later changes return 409 `already_answered`) and the response reveals it: `{"data":{"answers":[{"ref","is_correct":true,"correct_choice":"C"}]}}`.
- CBT mode: `{"data":{"saved":1}}` only, with no correctness at all until the session is submitted.
- Other errors: 409 `session_closed`, 422 `invalid_question_ref`, 422 `invalid_choice`, 429 on rate limit.

### POST /sessions/{id}/submit
Finalizes the session (idempotent; safe to retry; also works after the deadline). Returns the result.

### GET /sessions/{id}/result
```json
{"data":{"total":5,"answered":1,"correct":0,"wrong":1,"unanswered":4,"percent":0,"time_used_seconds":27,
 "subjects":[{"slug":"mathematics","name":"Mathematics","total":5,"answered":1,"correct":0,"wrong":1,"unanswered":4,"percent":0}],
 "score_400":null}}
```
`score_400` is only set for JAMB-style exams (each subject scaled to 100, then summed). Before submission or expiry: 409 `not_submitted`. Sessions that pass their deadline are finalized automatically by the Bank.

### GET /sessions/{id}/review?from=1&limit=30
Only after submission or expiry (409 `not_submitted` otherwise). Each item:
```json
{"ref":"uuid","number":1,"subject":"mathematics","passage":null,
 "question":{"text":"..."},"options":[{"key":"A","text":"148 m"}],
 "your_choice":"A","correct_choice":"C","is_correct":false,"flagged":false}
```
Unanswered questions have `your_choice: null` and `is_correct: false`. There are no explanations.

### POST /sessions/{id}/reports
Body: `{"ref":"<question ref>","reason":"typo|wrong_answer|missing_option|bad_image|garbled_passage|other","note":"optional text"}`. A repeated report from the same user for the same question returns 200 with `duplicate: true`. Rate-limited per user.

## Rules summary

- A year is listable when it has at least `min_questions_for_listing` published questions (default 10).
- Free years: the newest `free_year_count` (default 2) listable years per exam.
- A subject qualifies for CBT when its published count is at least `ceil(required_count × 0.9)`; a year is CBT-eligible when the compulsory subject qualifies and at least `subjects_required` subjects qualify.
- Practice readiness: at least `min_questions_for_practice` (default 5) questions.
- Limits: 5 active sessions per user, 200 questions per session.
