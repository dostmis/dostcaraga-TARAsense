# TARAsense Launch Readiness Checklist

## Completed in this sprint (April 13, 2026)

- [x] Enforced one-response-per-participant at DB level (`SensoryResponse` unique key on `studyId + participantId`).
- [x] Added strict server-side payload validation for sensory responses.
- [x] Added per-question type validation against configured study attributes.
- [x] Added transaction-safe submit flow to reduce race conditions under concurrent traffic.
- [x] Converted duplicate-submit cases into idempotent success responses.
- [x] Prevented analysis/notification side-effect failures from breaking response submission.
- [x] Hardened study creation validation (attribute uniqueness, exactly one overall-liking question, JAR option checks).
- [x] Added guardrails in analysis engine for malformed JAR values.
- [x] Verified code compiles in production build.

## Required before national launch (P0)

- [ ] Run load test at expected peak concurrency and 2x burst.
- [ ] Add API rate limiting and abuse controls at edge/reverse proxy.
- [ ] Add centralized application monitoring (error tracking, request latency, DB health).
- [ ] Define SLOs/SLAs and alert thresholds.
- [ ] Add backup + restore drill and verify recovery time.
- [ ] Freeze schema changes before launch week.
- [ ] Execute full UAT with MSME/FIC/consumer workflows.

## Required before national launch (P1)

- [ ] Implement complete JAR v1 spec (5-point JAR capture, top-3 optimization flow, custom-attribute guardrails, moderate-driver reporting).
- [ ] Add e2e regression tests for study creation, participation, submission, and analysis pipeline.
- [ ] Add operational runbook for incident handling.
- [ ] Add admin dashboards for submission failures and queue backlogs.

## Launch-day runbook (minimum)

1. Validate DB connectivity and migration status.
2. Validate app health endpoint and dashboard load times.
3. Run smoke script for study create -> submit -> analysis route.
4. Confirm alerting channels are active.
5. Assign on-call engineer and escalation chain.
