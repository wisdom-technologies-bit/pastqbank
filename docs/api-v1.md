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
- Free-tier sessions are only allowed for free years (otherwise 403 `premium_required`). Omitting `year` creates a mixed drill drawn from the free years for free users.
- Selection keeps passage questions together, so the actual `total_questions` can slightly exceed the request.
- A user may have at most 5 active sessions (`too_many_active_sessions`).

Response `data` includes: `id`, `status` ("created"), `mode`, `exam`, `year`, `tier`, `total_questions`, `duration_seconds` (null for practice), `feedback_mode`, `notices`, `outline`, `subjects:[{slug,name,question_count,borrowed_from_year}]`. `borrowed_from_year` is the donor year for a borrowed compulsory subject and null otherwise.

#### CBT sessions (`mode: "cbt"`)
A CBT is a fixed paper for one year, so `year` is required (422 `invalid_config` with `details.reason: "year_required"` otherwise). The catalog, not the client, decides what can be sat:
- Every requested subject must qualify for that year, that is appear in `qualifyingSubjects` from `GET /exams/{exam}/years/{year}/cbt-plan` (or be the borrowed compulsory subject). Otherwise 422 `invalid_config` with `details.subjects` and `details.qualifyingSubjects`.
- The number of subjects must be between `minSubjects` and `maxSubjects` (both the exam's `subjects_required`), otherwise 422 `invalid_config` with those bounds in `details`.
- Question counts and minutes always come from the exam profile and per-subject overrides (`question_count` sent by the client is ignored). When a subject qualifies but has fewer questions than required, the paper takes `min(required, available)` instead of failing.
- Order is `original` unless the client sends `order: "shuffled"`.
- Duration comes from the profile: with `shared_timer` the whole paper gets `profile.total_minutes` (or `default_minutes`); otherwise the paper gets the sum of each requested subject's minutes override, falling back to `default_minutes` per subject. A client `minutes` value is clamped to `min_minutes`..`max_minutes`.

**Compulsory subject.** When the year has the compulsory subject it must be in the request, otherwise 422 `compulsory_subject_required`. When the year has none, `missing_compulsory` decides:
- `"skip"` (default): leave it out; the requested subjects must still be within `minSubjects`..`maxSubjects`. Asking for it is 422 `invalid_config`.
- `"borrow"`: include it. Its questions come from the nearest year that has enough of them (the `borrow.donorYear` from the CBT plan) and those rows record `borrowed_from_year`. Including it is required (422 `compulsory_subject_required`), a donor must exist (422 `compulsory_subject_missing`), and a free-tier user cannot borrow from a premium donor year (403 `premium_required` with `details.donor_year`).

Error codes: `invalid_config`, `premium_required`, `compulsory_subject_required`, `compulsory_subject_missing`, `not_enough_questions`, `too_many_active_sessions`.

### POST /sessions/{id}/start
Idempotent. Moves status to `in_progress` and, for timed sessions, sets the server deadline. The response data includes `id`, `user_ref`, `status`, `mode`, `exam_slug`, `exam_year`, `tier`, `total_questions`, `duration_seconds`, `feedback_mode`, the timing fields (`started_at`, `deadline_at`) and `server_time` (the server clock at the moment of the response, also repeated as `meta.generatedAt`). Both the first call and a repeat call include `server_time`; the server deadline is the only authority on time, so a client should count down from `deadline_at` corrected by any clock skew against `server_time`.

### GET /sessions/{id}
Summary of the session: the same fields as above, plus `server_time`, `progress:{answered,total,flagged}`, `result_available` and `subjects` so a client can build subject tabs.
```json
{"data":{"id":"uuid","status":"in_progress","mode":"cbt","exam_slug":"jamb","exam_year":2025,
 "total_questions":180,"duration_seconds":7200,"feedback_mode":"end",
 "started_at":"...","deadline_at":"...","server_time":"...",
 "progress":{"answered":12,"total":180,"flagged":1},"result_available":false,
 "subjects":[{"slug":"english-language","name":"English Language","question_count":60,"first_position":1},
             {"slug":"mathematics","name":"Mathematics","question_count":40,"first_position":61}]}}
```
`subjects` is in session order: `slug`, `name` (from the subjects table), `question_count` in this paper and `first_position` (the 1-based session position of its first question).

### GET /sessions/{id}/questions?from=1&limit=30
Up to 60 per call; session must be started (`not_started`) and not finished (`session_finished`). Items are **flat** (question text and image are NOT nested under `question`):
```json
{"ref":"uuid","number":1,"position":1,"subject":"mathematics","subject_number":1,
 "text":"Simplify 12/3 + 4 ...","image_url":null,"instruction":"Answer all questions",
 "options":[{"key":"A","text":"148 m"}],"passage":null,"passage_key":null,
 "flagged":false,"revealed":false}
```
- `ref` is the opaque id used for answers, reveals and reports. `number` and `position` are both the 1-based session order.
- `image_url` is always a string or null; when present it is an absolute HTTPS URL hosted by the source.
- `instruction` is the shared section instruction for non-passage questions, otherwise null. `passage` is `{html, range}` or null, and `passage_key` groups questions that share a passage.
- `flagged` and `revealed` are always booleans: `true` when the student flagged the question, and `true` when the correct answer was revealed for it.
- Answers are never included here: no `your_choice`, `correct_choice` or `explanation`. Question text and passages may contain simple HTML; sanitise before rendering.

### PUT /sessions/{id}/answers
Body: `{"answers":[{"ref":"<question ref>","choice":"A","flagged":false}]}` with 1 to 60 items. An item with `flagged` and no `choice` updates only the flag in either mode; it does not answer or lock the question. A `null` choice clears an answer (CBT only).
- Instant (practice) mode: the first answer to a question is locked (later changes return 409 `already_answered`) and the response reveals it: `{"data":{"answers":[{"ref","is_correct":true,"correct_choice":"C"}]}}`.
- CBT mode: `{"data":{"saved":1}}` only, with no correctness at all until the session is submitted. Answers can be changed and cleared (`choice: null`) as often as the student likes until the deadline, plus the 30 second grace period for in-flight requests, after which the session returns 409 `session_closed`.
- Answering a question whose answer was revealed (see the reveal route) returns 409 `already_revealed`.
- Other errors: 409 `session_closed`, 422 `invalid_question_ref`, 422 `invalid_choice`, 429 on rate limit.

### POST /sessions/{id}/reveal
Lets a student see the correct answer to a practice question without answering it. Body: `{"ref":"<question ref>"}`.
- Only for a session that is `in_progress`, `mode: "practice"` and `feedback_mode: "instant"`; anything else returns 409 `reveal_not_allowed`.
- `ref` must belong to the session, otherwise 422 `invalid_question_ref`.
- A revealed question stays **unanswered**: it is counted in `unanswered` in the result and is never right or wrong. A flag already on the question is kept.
- Revealing a question twice is safe and returns the same payload. Answering a revealed question later returns 409 `already_revealed`.
- If the question already has an answer, nothing changes and the existing answer is reported instead (`revealed: false`).

```json
{"data":{"ref":"uuid","correct_choice":"C","explanation":"Step by step ...","revealed":true},
 "meta":{"generatedAt":"..."}}
```
Already answered:
```json
{"data":{"ref":"uuid","correct_choice":"C","explanation":null,"is_correct":true,"revealed":false},
 "meta":{"generatedAt":"..."}}
```
`explanation` is null when the bank has none. This endpoint exists only in instant-feedback practice; CBT sessions never show correctness before submission.
- Other errors: 404 `not_found`, 429 on rate limit, 500 `reveal_failed`.

### POST /sessions/{id}/submit
Finalizes the session (idempotent; safe to retry; also works after the deadline). Returns the result.

### GET /sessions/{id}/result
```json
{"data":{"total":5,"answered":1,"correct":0,"wrong":1,"unanswered":4,"percent":0,"time_used_seconds":27,
 "subjects":[{"slug":"mathematics","name":"Mathematics","total":5,"answered":1,"correct":0,"wrong":1,"unanswered":4,"percent":0}],
 "score_400":null}}
```
- `time_used_seconds` is `started_at` to now, capped at `duration_seconds` when the paper has a timer. For a session finalized by expiry it is measured to `deadline_at`, not to the moment the Bank noticed, so it never runs past the timer.
- `score_100` is present on each `subjects[]` item for JAMB sessions: the subject score scaled to 100 (`correct / total * 100`), the same number as that subject's `percent`.
- `score_400` is set for JAMB sessions with 4 subjects: the sum of each subject's `score_100`, otherwise null. Other exams return neither `score_100` nor `score_400`.

Before submission or expiry: 409 `not_submitted`. Sessions that pass their deadline are finalized automatically by the Bank, and `POST /sessions/{id}/submit` still works after the deadline.

### GET /sessions/{id}/review?from=1&limit=30
Only after submission or expiry (409 `not_submitted` otherwise). Each item:
```json
{"ref":"uuid","number":1,"subject":"mathematics","passage":null,
 "question":{"text":"...","image_url":null},"options":[{"key":"A","text":"148 m"}],
 "your_choice":"A","correct_choice":"C","is_correct":false,"flagged":false,
 "revealed":false,"explanation":"Step by step ..."}
```
- Review items nest the question under `question:{text, image_url}`, unlike the flat questions list.
- Unanswered and revealed questions have `your_choice: null` and `is_correct: false`. `revealed` is `true` when the student revealed the answer during the session.
- `explanation` is the bank's explanation, or null when there is none.

### POST /sessions/{id}/reports
Body: `{"ref":"<question ref>","reason":"typo|wrong_answer|missing_option|bad_image|garbled_passage|other","note":"optional text"}`. A repeated report from the same user for the same question returns 200 with `duplicate: true`. Rate-limited per user.

## Rules summary

- A year is listable when it has at least `min_questions_for_listing` published questions (default 10).
- Free years: the newest `free_year_count` (default 2) listable years per exam.
- A subject qualifies for CBT when its published count is at least `ceil(required_count × 0.9)`; a year is CBT-eligible when the compulsory subject qualifies and at least `subjects_required` subjects qualify.
- Practice readiness: at least `min_questions_for_practice` (default 5) questions.
- Limits: 5 active sessions per user, 200 questions per session.
