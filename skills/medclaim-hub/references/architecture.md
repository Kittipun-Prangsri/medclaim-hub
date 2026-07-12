# Architecture reference

## Runtime

- Node.js 18+ ESM
- Built-in HTTP server in `src/server.js`
- Vanilla HTML/CSS/JavaScript in `public/`
- `mysql2/promise` for HOSxP
- In-memory workflow and Provider ID mock sessions

## Main components

- `src/repositories/HosxpRepository.js`: read-only HOSxP lists, search, pagination, Claim Detail, schema inspection
- `src/repositories/DemoClaimRepository.js`: safe demo fallback
- `src/services/ValidationService.js`: assemble records and assign Ready/Warning/Blocked
- `src/services/RulesEngine.js`: generic JSON rules
- `src/rules/ucs-opd-v1.json`: UCS OPD ruleset
- `src/services/ClaimWorkflowService.js`: batch, response, appeal, payment, reconciliation simulation
- `src/services/AuthService.js`: Provider ID mock, sessions, roles, permissions
- `src/services/SystemSettingsService.js`: hospital/database settings and MySQL connection test
- `src/services/GovernanceService.js`: in-memory Auth Code resolutions and Rules approval state machine
- `public/app.js`: hash-routed SPA and escaped rendering

## HOSxP mappings currently verified

- Patient: `patient`
- Visit: `ovst`
- Diagnoses: `ovstdiag`
- Charges: `opitemrece`
- Direct Auth Code candidates: `authenhos`, `authenhosall`
- Temp Auth Code: `temp_authen_code`, with Buddhist Era service dates
- UCS pttype at the current hospital: `89`

## Security invariants

- HOSxP account must be SELECT-only.
- APIs containing patient or claim details require authentication and a server-side permission check.
- CID remains masked in browser output.
- `.env` and passwords never enter source control or tool output.
- SQL inputs remain parameterized.
- Live verification output remains aggregate and non-identifying.

## Verification expectations

- Run all Node tests after changes.
- Add repository tests with fake pools rather than requiring HOSxP in CI.
- Validate live HOSxP separately and never include raw rows in test logs.
- Check both demo and HOSxP modes when changing repository contracts.
