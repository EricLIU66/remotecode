# App.vue Split Implementation Plan

> **For OpenCode:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` while implementing.

**Goal:** Split `apps/frontend/src/App.vue` into smaller Vue components (and small helper modules) while preserving all runtime behavior and existing CSS class names so `apps/frontend/src/__tests__/app-console.test.js` keeps passing.

**Architecture:** Keep state management (WebSocket, health polling, token exchange, log entry building) in `App.vue` initially. Extract presentational and modal components first. If needed later, move pure helpers into `apps/frontend/src/lib/*`.

**Tech Stack:** Vue 3 `<script setup>`, Vite, Vitest, @vue/test-utils.

## Constraints

- Preserve behavior and existing CSS class names/selectors (tests assert `.console-body`, `.diff-modal`, `.diff-close`, `.progress-title`, `.progress-chip`, etc.).
- No new dependencies.
- Keep changes frontend-only.

## Baseline Verification

Run: `npm --prefix apps/frontend test`

## Component Targets (Recommended)

- `apps/frontend/src/components/DiffModal.vue`
- `apps/frontend/src/components/TokenModal.vue`
- `apps/frontend/src/components/ConsoleCard.vue`
- `apps/frontend/src/components/ProgressCard.vue`
- `apps/frontend/src/components/RelayStatusCard.vue`
- `apps/frontend/src/components/HeaderBar.vue`

## Task 1: Extract DiffModal

**Files:**
- Create: `apps/frontend/src/components/DiffModal.vue`
- Modify: `apps/frontend/src/App.vue`
- Modify: `apps/frontend/src/__tests__/app-console.test.js`

**TDD steps:**
1. Add a test that imports `DiffModal` and asserts `.diff-modal` and that clicking `.diff-close` emits `close`. Confirm tests fail due to missing file.
2. Implement `DiffModal.vue` with props `diff` and `v-model:activeFile`, and `close` emit.
3. Wire into `App.vue` replacing inline diff modal template.
4. Run: `npm --prefix apps/frontend test` (expect PASS).

## Task 2: Extract TokenModal

**Files:**
- Create: `apps/frontend/src/components/TokenModal.vue`
- Modify: `apps/frontend/src/App.vue`
- Modify: `apps/frontend/src/__tests__/app-console.test.js`

**Component interface (suggested):**
- Props: `open`, `hasViewerToken`
- v-model: `draft`
- Emits: `save`, `cancel`, `clear`

**TDD steps:**
1. Add import-based test that mounts `TokenModal` and asserts it renders `.modal-card` when open and emits on button clicks.
2. Implement component and wire into `App.vue`.
3. Run tests.

## Task 3: Extract ConsoleCard

**Files:**
- Create: `apps/frontend/src/components/ConsoleCard.vue`
- Modify: `apps/frontend/src/App.vue`
- Modify: `apps/frontend/src/__tests__/app-console.test.js`

**Notes:**
- Keep all DOM class names unchanged.
- Pass callbacks for `toggleExpandedEntry`, `toggleConsoleSection`, and `setActiveDiff`.
- Keep `logEntries` shape unchanged.

**Verification:** run unit tests after moving template.

## Task 4: Extract ProgressCard

**Files:**
- Create: `apps/frontend/src/components/ProgressCard.vue`
- Modify: `apps/frontend/src/App.vue`

**Notes:**
- Keep `.progress-title` and `.progress-chip` structure and classes.

## Task 5: Extract RelayStatusCard + HeaderBar

**Files:**
- Create: `apps/frontend/src/components/RelayStatusCard.vue`
- Create: `apps/frontend/src/components/HeaderBar.vue`
- Modify: `apps/frontend/src/App.vue`

**Notes:**
- Keep the exact card/header markup and CSS class names.

## Final Verification

- `npm --prefix apps/frontend test`
- Optional: `npm --prefix apps/frontend run build`
