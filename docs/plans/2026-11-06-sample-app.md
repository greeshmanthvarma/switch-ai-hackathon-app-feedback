# Sample Project Workspace Implementation Plan

**Goal:** Build a credible persistent project workspace that supplies a repeatable backend bug and a meaningful feature request for the feedback workflow.

**Architecture:** An independent Next.js App Router app serves a React interface and JSON/CSV routes backed by PostgreSQL. Server-only repository functions own SQL and transaction rules; UI and API share validation contracts. Freeze a deliberate export defect only after the healthy baseline passes its own checks.

**Tech stack:** Node.js 22, TypeScript, Next.js App Router, React, `pg`, Zod, plain CSS/CSS modules, Vitest, Testing Library, Playwright, and `csv-parse` for independent test parsing. Vercel/Neon hosting is wired in workflow F8.

**Spec:** [SPEC.md](../../SPEC.md), especially Sample target app, Verification and previews, and Demo and acceptance checks.

## Global constraints

- Paths are relative to the project root, including `sample-app/`; run package scripts from that directory unless stated otherwise.
- This is an independent Git repository and deployable app. Never include coordinator credentials or database in its environment or previews.
- Projects, tasks, assignees, statuses, comments, search/filtering, details, CSV export, persistent seed data, and polished failure/empty states are in scope. App login, roles, notifications, integrations, and priority are absent from the baseline.
- Use fictional seed data only. Server validation and parameterized queries apply even though this is a demo without login.
- Default status values: `todo`, `in_progress`, `done`. These are baseline app behavior, not the future priority feature's undecided values.
- The app is deliberately unauthenticated with fictional data; do not claim that ownership/access-control behavior is demonstrated.

## Review focus

1. Project/task identity and persistent relations: A1, `tasks.persistence.test.ts`.
2. Invalid or malicious API values: A2, `tasks.routes.test.ts`.
3. CSV encoding, Unicode, quoting and spreadsheet formulas: A2, `export.csv.test.ts`.
4. Visible versus exported filter results: A4, `export.contract.test.ts` red on the frozen defect and green after an agent fix.
5. Loading, failure, empty results, and real create/edit/comment interactions: A3, `workspace.spec.ts`.

## File boundaries and public API

- `sample-app/src/domain/task.ts`: Zod input schemas and public types.
- `sample-app/src/server/db.ts`: server-only pooled database client.
- `sample-app/src/server/tasks.ts`: `listTasks`, `createTask`, `updateTask`, `getTaskDetail`, `addComment`.
- `sample-app/src/server/export.ts`: `exportTaskRows`, CSV escaping; this is the future bug's bounded editing seam.
- `sample-app/src/server/http.ts`: JSON errors/status mapping shared by route handlers.
- `sample-app/src/app/api/**/route.ts`: thin route adapters, Node runtime, no SQL/UI logic.
- `sample-app/src/components/**`: task workspace, detail panel, filters, forms, and accessible feedback.
- `sample-app/db/migrations/*.sql`: numbered immutable migrations; `scripts/migrate.ts` applies with a PostgreSQL advisory lock and records migration checksums. `scripts/seed.ts` only runs explicitly against an identified demo database.

Contracts:

```ts
type TaskStatus = 'todo' | 'in_progress' | 'done';
type TaskFilters = { projectId: string; status?: TaskStatus; assigneeId?: string; q?: string };
type Task = { id: string; projectId: string; title: string; description: string;
  status: TaskStatus; assigneeId: string | null; createdAt: string; updatedAt: string };
type TaskDetail = { task: Task; comments: Array<{
  id: string; authorId: string; body: string; createdAt: string }> };
type CreateTaskInput = Pick<Task, 'projectId' | 'title' | 'description' | 'status' | 'assigneeId'>;
type UpdateTaskInput = Partial<Pick<Task, 'title' | 'description' | 'status' | 'assigneeId'>>;
type ApiError = { error: { code: 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE'; message: string } };
interface TaskRepository {
  listTasks(filters: TaskFilters): Promise<Task[]>;
  getTaskDetail(id: string): Promise<TaskDetail | null>;
  createTask(input: CreateTaskInput): Promise<Task>;
  updateTask(id: string, input: UpdateTaskInput): Promise<Task | null>;
  addComment(taskId: string, authorId: string, body: string): Promise<TaskDetail | null>;
}
```

JSON routes:

- `GET /api/projects` → `{projects: {id,name,description}[]}`; `GET /api/members` → `{members: {id,name,initials}[]}`.
- `GET /api/tasks?projectId=UUID[&status=...&assigneeId=...&q=...]` → `{tasks:Task[]}`.
- `POST /api/tasks` with CreateTaskInput → 201 `{task:Task}`.
- `GET /api/tasks/:id` → 200 TaskDetail or 404 ApiError.
- `PATCH /api/tasks/:id` with nonempty UpdateTaskInput → `{task:Task}` or 404.
- `POST /api/tasks/:id/comments` with `{authorId:string,body:string}` → 201 TaskDetail or 404. The selected fictional author is not authenticated identity.
- `GET /api/export` takes the same filters; CSV columns `id,title,status,assignee,project`. Preserve deterministic task ordering by created_at then id.
- `GET /api/health` → `{ok:true,buildSha:string|null}` with a database connectivity check; unavailable database returns 503 ApiError.
- Invalid UUID, status, blank title, unknown field, empty patch, query over 200 characters, title over 200, description over 5000, or comment outside 1–2000 characters → 400 INVALID_INPUT. An unknown assignee is rejected at 400; fictional members are workspace-wide. IDs and timestamps are server-produced; JSON is camelCase; SQL is snake_case.

## Persistent schema

`0001_workspace.sql` creates:

- `projects(id uuid primary key, name text not null, description text not null)`.
- `members(id uuid primary key, name text not null, initials text not null)`.
- `tasks(id uuid primary key, project_id uuid references projects, title text, description text, status text check in allowed values, assignee_id uuid null references members, created_at timestamptz, updated_at timestamptz)`. All except assignee are not null. Index `(project_id,status,created_at,id)` and `(project_id,assignee_id)`.
- `comments(id uuid primary key, task_id uuid references tasks on delete cascade, author_id uuid references members, body text not null, created_at timestamptz not null)`.
- `_migrations(name text primary key, checksum text not null, applied_at timestamptz not null)`.

Use a PostgreSQL transaction for each task mutation and comment/detail operation that must be consistent. Seed two projects, four fictional members, and twelve tasks with all statuses represented. Include ten tasks in the main demo project, exactly three `done`, and two tasks in a second project to detect cross-project export leaks. Use stable fixture UUIDs, not fixed row order assumptions.

## Commands to supply

`npm ci`, `npm run dev` (port 3000), `npm run build`, `npm run typecheck`, `npm run format:check`, `npm test -- <file>`, `npm run test:integration`, `npm run test:e2e`, `npm run db:migrate`, `npm run db:seed`, `npm run demo:reproduce-export`.

Use a disposable local PostgreSQL 16 database for integration tests, separate from the demo database. Test setup performs migrations/seed, truncates test-owned data between tests, and refuses reset against a URL not explicitly designated as test/demo. `.env.example` documents variable names only; secrets stay in ignored `.env.local`.

### Task A1: Persistent domain and seeded workspace

**Files:**
- Create: `sample-app/package.json`, `sample-app/package-lock.json`, `sample-app/tsconfig.json`, `sample-app/vitest.config.ts`, `sample-app/.gitignore`, `sample-app/.env.example`.
- Create: `sample-app/src/domain/task.ts`, `sample-app/src/server/db.ts`, `sample-app/src/server/tasks.ts`.
- Create: `sample-app/db/migrations/0001_workspace.sql`, `sample-app/scripts/migrate.ts`, `sample-app/scripts/seed.ts`.
- Test: `sample-app/tests/integration/tasks.persistence.test.ts`, `sample-app/tests/helpers/database.ts`, `sample-app/tests/fixtures/workspace.ts`.

**Interfaces:** Consumes the schema/contracts above. Produces TaskRepository and explicit migration/seed scripts.

- [ ] **Step 1: Write the failing test**

```ts
it('persists edits and scopes filtered results to the project', async () => {
  await repo.updateTask(fixture.todoTaskId, { status: 'done' });
  const rows = await freshRepo().listTasks({ projectId: fixture.mainProjectId, status: 'done' });
  expect(rows.map(t => t.id)).toContain(fixture.todoTaskId);
  expect(rows.every(t => t.projectId === fixture.mainProjectId && t.status === 'done')).toBe(true);
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/integration/tasks.persistence.test.ts`. Expect missing repository/table failure after test connection succeeds; connection failure is test infrastructure, not the intended red state.

- [ ] **Step 3: Implement the minimal behavior**

Create the package and exact dependency lock, migration runner, schema, seed fixtures, validation, and parameterized repository. Verify referenced member/project IDs before mutations. Keep connection configuration server-only and close pools in tests.

- [ ] **Step 4: Verify the green state**

Run the narrow test; expect persisted values after a new repository connection, correct filters, comments, and deterministic ordering. Add assertions for invalid status, missing IDs, and member constraints.

- [ ] **Step 5: Run broader checks**

Run `npm run db:migrate` twice on the test DB (second invocation applies nothing), `npm run db:seed` on the explicit demo target, `npm run typecheck`, and `npm run format:check`.

### Task A2: Real API and CSV behavior

**Files:**
- Create: `sample-app/src/server/http.ts`, `sample-app/src/server/export.ts`.
- Create: `sample-app/src/app/api/projects/route.ts`, `sample-app/src/app/api/members/route.ts`, `sample-app/src/app/api/tasks/route.ts`, `sample-app/src/app/api/tasks/[id]/route.ts`, `sample-app/src/app/api/tasks/[id]/comments/route.ts`, `sample-app/src/app/api/export/route.ts`, `sample-app/src/app/api/health/route.ts`.
- Test: `sample-app/tests/integration/tasks.routes.test.ts`, `sample-app/tests/unit/export.csv.test.ts`.
- Create: `sample-app/tests/helpers/csv.ts`, exporting `parseCsv(input:string):string[][]` backed by `csv-parse/sync` (not the production writer).

**Interfaces:** Consumes TaskRepository; produces the exact HTTP contract above and `exportTaskRows(repo:TaskRepository, filters:TaskFilters):Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
it('exports only matching project tasks and safely quotes cells', async () => {
  const csv = await exportTaskRows(repo, { projectId: fixture.mainProjectId, status: 'done' });
  const rows = parseCsv(csv);
  expect(rows.slice(1).map(row => row[0]).sort()).toEqual(fixture.doneTaskIds.slice().sort());
});
```

- [ ] **Step 2: Verify the red state**

Run `npm test -- tests/unit/export.csv.test.ts tests/integration/tasks.routes.test.ts`; expect missing handlers/exporter, not an intentionally wrong fixture.

- [ ] **Step 3: Implement the minimal behavior**

Use the same filter parser for list and export. CSV must quote commas/newlines/quotes, preserve Unicode, and prefix formula-leading `=`, `+`, `-`, `@` cell content with an apostrophe for this app's export policy. Return attachment content disposition and `text/csv; charset=utf-8`. Route adapters return safe errors without SQL details. Dynamic request-backed routes use the Node runtime and avoid stale cached query results.

- [ ] **Step 4: Verify the green state**

Run the narrow tests; expect correct response schemas, 201 mutations, 400 input failures, 404 missing records, and filtered CSV with the correct exact IDs. Test an empty result with headers only and database-unavailable 503.

- [ ] **Step 5: Run broader checks**

Run `npm run test:integration`, `npm run typecheck`, `npm run build`, and `npm run format:check`.

### Task A3: Polished usable project workspace

**Files:**
- Create: `sample-app/src/app/layout.tsx`, `sample-app/src/app/page.tsx`, `sample-app/src/app/globals.css`, `sample-app/src/app/error.tsx`, `sample-app/src/app/loading.tsx`.
- Create: `sample-app/src/components/workspace.tsx`, `sample-app/src/components/task-list.tsx`, `sample-app/src/components/task-detail.tsx`, `sample-app/src/components/task-form.tsx`, `sample-app/src/components/task-filters.tsx`.
- Create: `sample-app/playwright.config.ts`, `sample-app/README.md`.
- Test: `sample-app/tests/e2e/workspace.spec.ts`, `sample-app/tests/unit/task-filters.test.tsx`.

**Interfaces:** Consumes A2 HTTP endpoints. Produces a browser-accessible app and consistent filter URLs suitable for reproductions.

- [ ] **Step 1: Write the failing test**

```ts
test('a user filters, edits a task and adds a persistent comment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('done');
  await expect(page.getByTestId('task-row')).toHaveCount(3);
  await page.getByRole('button', { name: fixture.doneTaskTitle }).click();
  await page.getByRole('textbox', { name: 'Comment' }).fill('Checked in the demo.');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.reload();
  await expect(page.getByText('Checked in the demo.')).toBeVisible();
});
```

- [ ] **Step 2: Verify the red state**

Run `npm run test:e2e -- tests/e2e/workspace.spec.ts`. Expect missing UI controls; the seeded app server and DB must be reachable first.

- [ ] **Step 3: Implement the minimal behavior**

Use a restrained project-tool visual design: left project navigation, clear page title and task count, search/status/assignee filters, task list, and task detail side panel. Forms create/edit existing fields and comments; assignee/author selectors use fictional members. Persist filter state in URL query parameters. Export passes the active filters to the API. Provide keyboard navigation, associated labels, visible focus, narrow-screen layout, actionable errors, loading indicators, and empty states. Do not add charts, boards, calendars, animations, login, or priority.

- [ ] **Step 4: Verify the green state**

Run the narrow e2e test. Add scenarios for creation/editing, assignee search, no matches, network failure/retry, Escape closing the detail panel, and filter-preserving export download. Confirm persistence across reloads.

- [ ] **Step 5: Run broader checks**

Run `npm run test:e2e`, `npm test`, `npm run typecheck`, `npm run build`, and `npm run format:check`. Inspect desktop and narrow-width screenshots; fix observed layout/accessibility failures without expanding product scope.

### Task A4: Repeatable demo bug and independent verification

**Files:**
- Modify: `sample-app/src/server/export.ts`, `sample-app/package.json`, `sample-app/README.md`.
- Create: `sample-app/vitest.known-issues.config.ts`, `sample-app/tests/known-issues/export.contract.test.ts`.
- Modify: `sample-app/vitest.config.ts` to keep known-failure checks explicitly separate.
- Create: `docs/demo-baseline.md` (automation repository), `tests/fixtures/export-expectations.json` (automation repository).

**Interfaces:** Consumes the healthy A1–A3 app. Produces `sample-app` tag `demo-baseline`, deterministic reproduction commands, and independently recorded expected export IDs.

- [ ] **Step 1: Write the regression contract**

The HTTP contract test compares the list API's exact filtered IDs with parsed CSV IDs for the same query. It must also assert project scoping. First run it against the healthy app and confirm PASS; this proves the oracle before intentionally introducing the defect.

- [ ] **Step 2: Verify the intentional red state**

Introduce the documented demo defect in `exportTaskRows`: keep project scoping, but omit status from the export's repository filter. With the seeded app running on port 3000, run `npm run demo:reproduce-export`; expect nonzero with `visible=3, exported=10` and the extra IDs. Define that script exactly as `vitest run --config vitest.known-issues.config.ts`; the dedicated config includes only `tests/known-issues/**`, overrides the default exclusion, and reads `BASE_URL` with localhost:3000 as the demo default.

- [ ] **Step 3: Implement the demo packaging**

Keep all healthy filters/CSV safety tests in the default suite. Move only the status-export regression to the explicitly named known-issues suite. Record the defect transparently in README and `docs/demo-baseline.md`; never claim the deliberately broken app is regression-clean. Normal tests must not assert incorrect behavior. Set the default Vitest config to exclude `tests/known-issues/**`; `demo:reproduce-export` is the one authoritative known-defect command and exits nonzero on the baseline.

- [ ] **Step 4: Verify both expected outcomes**

Default app checks pass, and `npm run demo:reproduce-export` fails for the known reason. A temporary scratch branch with the missing filter restored makes that same command pass; discard only the owned scratch branch after recording the result, preserve the defect on `demo-baseline`, and do not prebuild the priority feature.

- [ ] **Step 5: Run broader checks**

Run the default tests/build/e2e, seed a fresh database, reproduce the exact defect, and document the baseline Git SHA. Freeze app scope. Later implementation-agent PRs must promote their new regression tests into the default suite; the coordinator's independent expected IDs remain outside the worker-editable app checkout.
