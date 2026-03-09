# TestSprite (Fluorescence Map)

This folder contains **non-secret** inputs for running TestSprite against the Fluorescence Map UI:

- `testsprite_tests/standard_prd.json`: concise module PRD/context for TestSprite.
- `testsprite_tests/testsprite_frontend_test_plan.json`: small, high-signal frontend test plan.

All other TestSprite-generated artifacts (including `testsprite_tests/tmp/config.json`, reports, raw results, etc.) are ignored via `.gitignore`.

## Run

1. Ensure you have a TestSprite API key available as an environment variable:
   - `API_KEY` (preferred), or configure it via your IDE MCP setup.
2. Start the app: `npm.cmd start`
3. Execute TestSprite (requires internet): `npx.cmd -y @testsprite/testsprite-mcp@latest generateCodeAndExecute`

Notes:
- The runner reads config from `testsprite_tests/tmp/config.json`. The included PowerShell helper script writes that file at runtime without committing secrets.
- TestSprite targets `/_dev/fluorescence-map?testsprite=1` (query param enables offline-safe map style + automation-friendly fallbacks).
