# Spruha

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 19.0.5.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

### Time Log Runtime Mode

- Default runtime is API-only (`npm start`).
- Emergency-only local mock scripts are kept for debugging:
  - `npm run start:timesheet-mock`
  - `npm run mock:timesheet-api`

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Admin Dashboard API Verification

The project includes automated verification scripts for `http://localhost:4200/admin/dashboard` and the embedded Fluorescence Map.

### Required Environment Variables

- `BP_TEST_USERNAME` (required)
- `BP_TEST_PASSWORD` (required)
- `BP_BASE_URL` (optional, default: `http://localhost:4200`)
- `BP_PROJECT_ID` (optional, default: `53`)

### Commands

```bash
npm run verify:admin:api
npm run verify:admin:ui
npm run verify:admin:all
npm run verify:fluorescence-map:ui
npm run verify:fluorescence-map:video
npm run verify:fluorescence-map:all
```

`verify:admin:all` runs API smoke checks first, then UI+network verification.

### What Each Verifier Checks

- `verify:admin:api`
  - Logs in via `POST /api/auth/login`.
  - Validates dashboard endpoints with bearer auth:
    - `/api/Projects?clientId=0&projectTypeId=0&locationId=0&includeClosed=true`
    - `/api/Vehicles?clientId=0&page=1&pageSize=1`
    - `/api/Clients`
    - `/api/Manufacturers`
    - `/api/Locations`
    - `/api/Projects/{projectId}/vehicles?clientId=0&userId={userId}`
    - `/api/tickets/dashboard?projectId={projectId}&userId={userId}`
  - Asserts `200` and response-shape basics (array payloads + ticket dashboard metrics).

- `verify:admin:ui`
  - Opens `/admin/dashboard` and performs login if redirected to `/custom/sign-in`.
  - Verifies:
    - Project and vehicle dropdowns render.
    - Map widget and toolbar are visible.
    - Selecting a non-`all` project enables vehicle dropdown.
    - Map fullscreen and filters overlay open.
    - `.fleet-filter-overlay-body` exists and is scrollable.
    - Selecting a client chip and clicking `Show Results` yields an active filter chip.
  - Captures API network health and fails on post-login `401`, `403`, or `5xx`.
  - Applies a bounded `/api/Projects` call-volume guard in a short post-action window.

### Interpreting Failures

- API script failure means endpoint/auth/shape regressions.
- UI script failure means functional UI regression, network health issue, or project-call churn threshold breach.

## Fluorescence Map Verification

The repo includes a dedicated Fluorescence Map verifier for the standalone dev route at `http://localhost:4200/_dev/fluorescence-map`.

### Required Environment Variables

- `BP_TEST_USERNAME` (required)
- `BP_TEST_PASSWORD` (required)
- `BP_BASE_URL` (optional, default: `http://localhost:4200`)
- `API_KEY` (required only for the TestSprite interaction video step)

### Commands

```bash
npm run verify:fluorescence-map:ui
npm run verify:fluorescence-map:video
npm run verify:fluorescence-map:all
```

### What The Fluorescence Map Verifier Checks

- Runs `npm run build` before verification.
- Starts `ng serve` on `http://localhost:4200` if it is not already running.
- Opens `/_dev/fluorescence-map` and authenticates if redirected to sign-in.
- Verifies the Fluorescence Map shell, `#war-room-map`, zoom controls, filters overlay, and table toggle behavior.
- Captures a full-page desktop screenshot to `output/playwright/verification.png`.
- Captures a full-page mobile screenshot to `output/playwright/verification-mobile.png`.
- Writes DOM, console, network, and summary artifacts under `output/playwright/`.
- Runs the existing TestSprite flow and writes the latest interaction video URL to `output/playwright/verification-video.url.txt`.

### Fluorescence Map Artifacts

- Screenshot: `output/playwright/verification.png`
- Mobile screenshot: `output/playwright/verification-mobile.png`
- DOM summary: `output/playwright/verification-dom.json`
- Console summary: `output/playwright/verification-console.json`
- Network summary: `output/playwright/verification-network.json`
- Verification summary: `output/playwright/verification-summary.json`
- Video URL: `output/playwright/verification-video.url.txt`

### Proxy Note

These verifiers expect the Angular app to use the proxied API path (`/api`) so calls route to the live backend through your local proxy configuration.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
