# Retell list API audit

Source: https://docs.retellai.com/deprecation-notice/2026/06-15_legacy_list_endpoints

## Findings in this development checkout

No active callers of retired list endpoints, no Retell Node SDK dependency,
and no calls/phone inventory polling were found in the app, shared libraries,
or operational scripts. Do not infer that a Retell warning proves this checkout
is the caller. It may refer to an older deployed revision, external workflow,
or historical request. The warning's specific origin remains unverified.

Provisioning directly calls `POST /create-phone-number`; it does not first list
phone numbers. Analyzed calls arrive via the post-call webhook and are persisted
locally; they are not imported using a calls-list API.

Two actual list consumers exist:

- Owner demo-call draft selection.
- `scripts/update-retell-draft.mjs`, which defaults to read-only dry run.

Both use `GET /list-agent-versions/{agent_id}`, which remains the documented
supported endpoint. It must not be changed to an invented versioned URL.
Both follow the complete `items` / `has_more` / `pagination_key` contract. The old
array-compatibility bypass has been removed: malformed responses or a failed
later page must abort before a call or draft mutation, never accept a partial
inventory.

## Current replacements for future consumers

| Resource | Supported method/path |
| --- | --- |
| Phone numbers | `GET /v2/list-phone-numbers` |
| Calls | `POST /v3/list-calls` |
| Chats | `POST /v3/list-chats` |
| Agents | `POST /v2/list-agents` |
| Retell LLMs | `GET /v2/list-retell-llms` |
| Conversation flows | `GET /v2/list-conversation-flows` |
| Conversation flow components | `GET /v2/list-conversation-flow-components` |
| Batch tests | `GET /v2/list-batch-tests` |
| Test case definitions | `GET /v2/list-test-case-definitions` |
| Test runs | `GET /v2/list-test-runs/{test_case_batch_job_id}` |

For phone numbers and agent versions the cursor goes in the query string. For
calls it goes in the POST body, preserving filters and ordering across pages.
Agent listing uses query pagination even though it is a POST. All lists return
`items`, not a top-level array. Read until `has_more` is false. Missing/repeated
cursors, invalid envelopes, and later-page failures are errors, not success
with an incomplete result.

## Verification and release boundary

Automated tests cover multi-page phone/call envelopes, encoded cursors, empty
pages, cycle detection, malformed responses, and later-page failures. Integration
tests exercise the actual demo-call consumer and draft script with mocked
provider responses, including later-page draft selection and refusal to write
on failure. Existing provisioning and pre/post-call webhook suites must pass.
The endpoint regression guard covers backend, frontend, shared libraries, and
operational scripts, including TSX/JSX and shell/Python files.

No real phone purchases, test calls, provider configuration changes, email
delivery, secret edits, production changes, or publishing are part of this
verification. No live Retell request is necessary for the mocked regression
suite.

PJ should retain the warning's request timestamp, integration/API-key label,
method/path, and client-version information (not the secret key). Compare those
with the deployed revision and any external Node/automation client if warnings
continue. An older Node SDK must be updated in its actual environment and its
callers adjusted for the paginated response; a workspace-only change cannot
update an external client or an unpublished deployment.
