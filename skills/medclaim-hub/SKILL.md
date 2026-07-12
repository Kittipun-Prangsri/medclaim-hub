---
name: medclaim-hub
description: Develop, diagnose, test, and maintain the MedClaim Hub hospital claim-management application. Use when working on its Node.js API, vanilla JavaScript dashboard, HOSxP read-only integration, UCS validation rules, Auth Code mapping, Provider ID authentication, RBAC, claim batches, FDH responses, reconciliation, reporting, settings, or production-readiness tasks.
---

# MedClaim Hub

Work from the repository root. Read `README.md`, `package.json`, and only the source files relevant to the request before editing. Read [references/architecture.md](references/architecture.md) when changing data access, authentication, rules, or claim workflow.

## Protect healthcare data

- Treat HN, VN, CID, patient names, diagnoses, treatments, Auth Codes, and charges as sensitive.
- Never print patient rows, credentials, tokens, cookies, or Claim Codes in tool output or the final response.
- Verify live-data behavior with counts, booleans, schema metadata, masked identifiers, or aggregate summaries.
- Keep `.env` out of Git. Never read or echo `HOSXP_DB_PASSWORD` unless strictly required by the running process.
- Preserve CID masking in the UI and enforce authorization on the server, not only by hiding controls.

## Preserve the data boundary

- Access HOSxP with `SELECT` only. Never add `INSERT`, `UPDATE`, `DELETE`, DDL, triggers, or schema changes against HOSxP.
- Use parameterized queries for every value from requests or configuration.
- Validate date ranges, pagination, search length, VN/HN formats, and response sizes.
- Inspect `information_schema` before assuming hospital-specific tables or columns.
- Do not guess ambiguous Auth Code mappings. Keep them in Warning state and require review.
- Limit expensive detail and list queries; avoid unbounded reads from `ovst`, `ovstdiag`, `opitemrece`, and authentication tables.

## Follow the implementation flow

1. Inspect the current repository and confirm whether `CLAIM_DATA_SOURCE` is `demo` or `hosxp` without exposing secrets.
2. Trace the request through route, service, rules engine, and repository.
3. Make the smallest compatible change. Preserve the built-in Node.js server and vanilla frontend unless the user explicitly approves a migration.
4. Apply RBAC to new sensitive APIs. Reuse permissions from `AuthService.js` or add a narrowly scoped permission.
5. Escape all user-controlled HTML with the existing `safe()` helper.
6. Add automated tests for success, validation failure, authorization, and unsafe input.
7. Run `node --check` on changed JavaScript and `npm test`.
8. For live HOSxP verification, return only HTTP status, counts, and non-identifying booleans.
9. Restart the server only when needed. Confirm `/api/health` reports the intended data source.

## Handle hospital-specific mappings

- Keep UCS `pttype` values configurable through `HOSXP_UCS_PTTYPE_CODES`.
- Preserve the current Buddhist Era conversion for `temp_authen_code` unless schema evidence requires a change.
- Accept a temp Auth Code only when the matching CID and service date produce one distinct Claim Code.
- Prefer stable keys such as VN. Use CID plus date only with ambiguity checks.
- Report schema mismatch clearly without returning SQL credentials or patient values.

## Test safely

Run:

```bash
npm test
node --check src/server.js
node --check public/app.js
```

When testing live endpoints, authenticate with a mock role, save responses outside the web root, and summarize them without PHI. Delete temporary PHI-bearing artifacts when the test finishes.

## Respect current scope

- PostgreSQL persistence is postponed. Do not install or require a PostgreSQL server unless the user explicitly resumes that work.
- HOSxP is the clinical source; MedClaim Hub must remain read-only toward it.
- Provider ID remains a mock until approved UAT credentials and callback URLs are supplied.
- Claim submission and payment flows remain simulated unless the user supplies approved FDH formats and authorizes live integration.
- Preserve the Auth Code ambiguity review and Rules approval workflow. Store decisions in MedClaim Hub only and never write resolutions back to HOSxP.
