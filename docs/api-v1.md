# API v1 additions

All session endpoints require the service credential and `X-User-Ref` matching the session owner. Responses are `{data,meta}` or `{error:{code,message,details?}}` with `Cache-Control: private, no-store`.

Sessions support answer upserts, idempotent submit, stored results, review, reports, resume answers, deadline grace, instant-feedback locking, and result availability. `PUT /api/v1/sessions/:id/answers` accepts `{answers:[{ref,choice,flagged?,time_ms?}]}`. `POST /api/v1/sessions/:id/submit` stores and returns marking. `GET /api/v1/sessions/:id/result` returns the stored result and timing. `GET /api/v1/sessions/:id/review?from=1&limit=30` returns submitted review items. `POST /api/v1/sessions/:id/reports` accepts `{ref,reason,note?}` and is limited to ten reports/hour by default. `POST /api/cron/expire-sessions` requires `Authorization: Bearer $CRON_SECRET` and processes expiry/cleanup batches.

Deadline expiry uses the configured five-second grace. Instant practice answers are locked after first answer; end-feedback CBT answers remain editable until submit. Errors include `not_found`, `not_started`, `session_finished`, `deadline_passed`, `invalid_ref`, `invalid_choice`, `already_answered`, `not_submitted`, `rate_limited`, and `daily_session_limit`.
