# Divisions (課): role, membership and work scope

This release adds administrator-managed divisions to the V2 manager application. A division is the
organisational boundary of the department: it decides **where a role may act** and **who may be
assigned**. It is not a second permission system and it is not a project-level ACL.

The V2 application is branded **シゴトモ** (Japanese) / **SHIGOTOMO** (English); the brand is a
product name only. A division named `設計・開発課` is stored data and is rendered exactly as stored,
so the product name and a division name are never the same thing. (The V1 Apps Script application
keeps its own name; see `README.md`.)

## 1. Three separate concepts

| Concept | Stored where | Decides |
| --- | --- | --- |
| Role | `MEMBERS.role` | *What* an account may do. |
| Division membership (`WORK`) | `MEMBER_DIVISIONS.access_kind = 'WORK'` | *Where* the role may create, manage, approve and be assigned. Membership implies reading. |
| Additional read access (`READ`) | `MEMBER_DIVISIONS.access_kind = 'READ'` | Where the account may **only** observe. Never an assignment, a creation, an edit or an approval. |

One resolved `DivisionScope` answers every question for one request
(`packages/domain/src/divisions.ts`):

```
DivisionScope = { manageAll, overseeAll, work, read }
```

* `manageAll` — `ADMIN`: every division, including one created later, plus unmapped work. Never an
  assignment right.
* `overseeAll` — `GENERAL_MANAGER` with `MEMBERS.all_divisions_read = true`: read every division,
  including one created later. `work` stays empty.
* `work` — divisions where this role may write.
* `read` — divisions this role may read (membership ∪ additional read access).

An empty resolved set is never "everything". Unmapped work (a blank `PROJECTS.division_id`) is
readable by `ADMIN` only, so it can be mapped deliberately.

## 2. Role and action matrix

| Action | ADMIN | MANAGER | GENERAL_MANAGER (次長) | MEMBER | VIEWER |
| --- | --- | --- | --- | --- | --- |
| Read work in an authorized division | all | `WORK ∪ READ` | all (or the selected list) | `WORK ∪ READ` | `WORK ∪ READ` |
| Read `RESTRICTED` work | yes | yes | yes, inside its authorized divisions | no | no |
| Create a project / subproject / task | yes, any division | yes, `WORK` divisions | no | own work, `WORK` divisions | no |
| Edit, archive, reassign, approve, complete | yes | yes, `WORK` divisions | no | no | no |
| Permanent removal (`DELETE <id>`) | yes | no | no | no | no |
| File a completion report / deadline request | yes | yes | no | own work | no |
| Manage divisions, memberships, oversight | yes | no | no | no | no |
| Transfer a project between divisions | yes | no | no | no | no |
| Be assigned to work | only with `WORK` membership | only with `WORK` membership | never (read-only) | only with `WORK` membership | only with `WORK` membership |

`GENERAL_MANAGER` sits **below** `MEMBER` in `ROLE_ORDER` (`{ VIEWER: 0, GENERAL_MANAGER: 1,
MEMBER: 2, MANAGER: 3, ADMIN: 4 }`). No numeric comparison can therefore grant it a write; the
oversight behaviour is an explicit capability (`isGeneralManager`, `canOverseeDivisions`), never an
ordering accident. An unknown or blank stored role resolves to `VIEWER` and `requireRole` fails
closed because an unknown role ranks `-1`.

## 3. Canonical division of work

```
DIVISIONS
  ├── RESPONSIBILITIES.division_id   (area; nullable = the documented unassigned path)
  └── PROJECTS.division_id           (the canonical division of the work; nullable = unmapped)
        ├── SUBPROJECTS              (derive through the project)
        └── TASKS                    (derive through the project)
```

* A task and a subproject never store a division. Filtering and checks join their project, so a
  child cannot drift from its project.
* A scoped responsibility and its projects can never disagree: `eh_check_project_division` and
  `eh_check_responsibility_division` raise `PROJECT_DIVISION_MISMATCH` /
  `RESPONSIBILITY_DIVISION_MISMATCH` at the database boundary.
* A retired division keeps its rows, its projects and its history; it accepts no new work and no new
  assignment.
* `MEMBERS.department` stays legacy descriptive text and is never a permission source.

## 4. Assignment eligibility

A person may be newly assigned to a project owner, a task owner, an additional assignee, a
subproject owner or a responsibility owner/member only when:

1. the person exists and is active, and
2. the person holds an active `WORK` membership in the work's division, and
3. the existing rules (hierarchy, dependency, revision, confirmation) pass.

`ADMIN` status, general-manager oversight and additional read access never qualify anybody. A mixed
valid/invalid selection is one failed operation (`DIVISION_MEMBERSHIP_REQUIRED`) and nothing is
partially saved. An existing relationship is preserved after a deactivation; only a *new* or
*changed* assignment is validated.

### 4.1 A responsibility assignment follows the area's division

`saveResponsibility` applies the same rule to the area's own relationships, inside its transaction:

* a new or changed primary owner must be an active `WORK` member of the area's division, and
  changing the primary owner stays `ADMIN`-only (`requirePrimaryOwnerChange`);
* every *newly added* additional member must satisfy the same rule, and a mixed set is refused as
  one failed operation;
* a *retained* relationship is not re-validated, so a member who was later deactivated keeps the
  historical relationship and an unrelated edit never drops it;
* when the area itself moves to another division, every retained owner and member is validated
  against the destination, because retention in a new division is a new assignment;
* an area with no division (the documented unassigned path) is `ADMIN` remediation only: a manager
  cannot create or edit one to escape the division rule.

## 5. Migration and legacy data

Migration `0012_divisions` is additive:

* new tables `DIVISIONS` and `MEMBER_DIVISIONS`;
* `MEMBERS.all_divisions_read`;
* `PROJECTS.division_id` and `RESPONSIBILITIES.division_id` (both nullable);
* the `MEMBERS.role` check extended with `GENERAL_MANAGER`;
* the two consistency triggers and the supporting indexes.

It seeds **no** division and sets **no** default: an existing operational database is not rewritten
and no historical row is guessed into a division. The approved bootstrap
(`packages/db/src/divisions-bootstrap.ts`) records the initial three divisions for a new deployment
and is never run automatically at startup:

| id | name |
| --- | --- |
| `DIV-DESIGN-DEV` | 設計・開発課 |
| `DIV-DESIGN-ENG` | 設計・技術課 |
| `DIV-PRODUCTION-ENG` | 生産・技術課 |

### Reviewed mapping procedure (existing data)

The trigger `eh_check_responsibility_division` refuses to scope an area while any of its projects
still sits in another (or no) division. The order below is therefore the **only** order that works
for the supported starting state (areas and projects both unmapped):

1. **Report** — dry run only: every project with a blank division, every responsibility with a
   blank division, every project whose division contradicts its area with a division, every member
   with no `WORK` membership, and every existing owner/assignee who would become ineligible.
2. **Decide** — an administrator supplies the mapping explicitly (project → division, area →
   division, member → membership / additional read). Nothing is inferred from a name, a free-text
   department, a role, an owner or a task assignment.
3. **Map the projects first** while their area is still unmapped. `PROJECTS.division_id` is free
   to set at this point, because the trigger only compares against a *scoped* area.
4. **Verify** that every project of one area now carries the same division, and that no project
   remains blank for an area you intend to scope.
5. **Map the area** (`RESPONSIBILITIES.division_id`) to exactly that division. The trigger now
   passes because every linked project already agrees.
6. **Apply the reviewed membership mapping** (`MEMBER_DIVISIONS`) last, so an eligibility decision
   is made against a fully mapped hierarchy.
7. **Verify preservation** and assignment consistency: row counts, identifiers, operational fields,
   assignment rows and the audit trail are unchanged apart from the mapped columns, and every
   existing owner/assignee is still eligible in its new division.
8. **Remediate** what stays unmapped: it is visible to `ADMIN` and invisible to everybody else until
   it is mapped, and the rollout is not "ready" while a mapping is unresolved.

Other starting states:

* **Area already scoped, projects blank.** Set the projects to the area's division; the area needs
  no further change.
* **Area scoped, some projects in another division.** The project must be moved first (the reviewed
  `POST /api/admin/projects/:id/transfer-division` path, or the explicit mapping on an isolated
  copy). The area cannot be "moved out of the way" to make the trigger pass.
* **Projects scoped, area blank.** Map the area to the division the projects already share. If they
  do not share one, the report step has an unresolved contradiction: decide it explicitly, one
  project at a time.

Never disable a trigger to force a mapping through, never infer a division, and never grant access
automatically. The procedure is never run unattended: steps 1-7 are performed by an administrator
through the reviewed mapping tool in §12, which performs exactly this order (projects before their
area) inside one transaction, and step 8 stays an operator report. A deployment that does not use the
tool keeps the order above as a manual procedure.

### 5.1 Membership changes compare the access kind, not only the division

`applyMemberDivisionGrants` reads the stored `(division, access_kind)` pairs and compares them with
the requested set:

| Change | Treated as | Active-work blocker |
| --- | --- | --- |
| `WORK` → absent | membership removal | yes |
| `WORK` → `READ` | membership removal (downgrade) | yes, with `reason: 'DOWNGRADE'` |
| `READ` → absent | read-access revocation | no |
| `READ` → `WORK` | new membership | only for a new assignment, not for existing work |

Removal is always a soft change: the row is stamped, never deleted, and re-adding reactivates it. A
grant that is retained for a retired division during an unrelated member edit is preserved; the
active-division picker only affects what is newly offered.

## 6. Route and service inventory

Every path resolves the scope from trusted server data before it answers. `undefined` in the SQL
filters below means "the administrative unrestricted scope"; an empty list matches nothing. A
client-supplied `divisionId` is narrowed by one function, `scopedDivisionIds` — an unauthorized
identifier answers `NOT_FOUND` exactly like an unknown one.

| Path | Enforcement |
| --- | --- |
| `GET /api/session`, `POST /api/session` | Returns the resolved readable/writable divisions for the shell. |
| `GET /api/work/tasks`, `/tasks/:id` | `TaskFilters.divisionIds` + `assertReadableDivision` on the project. |
| `GET /api/work/projects`, `/projects/:id` | `ProjectFilters.divisionIds` + `assertReadableDivision`. |
| `GET /api/work/overview`, `/api/manager/overview` | Scope resolved before counts, responsibilities, upcoming/overdue pages. |
| `GET /api/work/timeline`, `/api/manager/timeline` | `listProjects`/`listWorkResponsibilityOptions` are scoped; `divisionId` narrows the timeline summaries; a branch is refused by division. |
| `GET /api/work/task-assignees` | Scoped by readable divisions; an employee identifier is disclosed only to a reader who may already see one. |
| `GET /api/manager/tasks`, `/tasks/:id`, `/search/tasks`, `/task-index` | Scoped list, tree, search and compact index; detail asserts readability. |
| `GET /api/manager/projects`, `/projects/:id` | Scoped list, group totals and paging; detail asserts readability. |
| `GET /api/manager/subprojects` | Requires `projectId` to be readable, or restricts the list to the readable divisions. |
| `GET /api/manager/editor` | Entity-specific authorization before any record is returned: task/subproject through their project, project and responsibility through their own division, and **edit** capability (not only read); the member editor is ADMIN-only. |
| `GET /api/manager/references` | Responsibilities carry their `divisionId`, members carry `workDivisionIds` and division names, so a form can offer only the eligible options. |
| `GET /api/manager/reports/workload`, `/tasks` | `WorkloadFilters.divisionIds` on every figure and the drilldown. |
| `GET /api/manager/members/:id/profile` | Current and former work scoped to the caller's divisions; a former assignment elsewhere is counted (`ownership.previousHidden`), never described. |
| `GET /api/manager/requests`, `POST /requests/sync` | Queue total and page are scoped by the task's project division. |
| `POST /api/manager/projects` | `divisionId` required, active, writable; responsibility must agree; owner must be eligible; refused again inside the write. |
| `PATCH /api/manager/projects/:id` | `writableProject` (current division); the role, the division and a changed owner are re-read inside the transaction. |
| `POST /api/manager/projects/:id/archive` | Same transaction-time authorization as an edit. |
| `POST /api/manager/subprojects` | Writable, active project; owner eligibility; refused in a retired division. |
| `PATCH /api/manager/subprojects/:id` | Current and destination project authorized inside the write; a retained owner is validated against the destination division of a move. |
| `POST /api/manager/subprojects/:id/archive` | Same transaction-time authorization as an edit. |
| `POST /api/manager/subprojects/:id/reactivate` | Same transaction-time authorization as an edit. |
| `POST /api/manager/tasks` | Writable project; every new assignee eligible; a mixed set commits nothing; a creation is refused in a retired division even with no assignee. |
| `PATCH /api/manager/tasks/:id` | Writable project; the actor, the division and every newly added assignee are re-read inside the write. |
| `POST /api/manager/tasks/:id/approve` | `writableTask`; the actor's stored role and the division are re-read inside the transaction. |
| `POST /api/manager/tasks/:id/confirm-schedule` | Same protocol as approval. |
| `POST /api/manager/tasks/:id/complete` | Same protocol as approval; the direct-completion rules still apply. |
| `POST /api/manager/tasks/:id/override-complete` | ADMIN; same protocol as approval. |
| `POST /api/manager/tasks/:id/reopen` | ADMIN; same protocol as approval. |
| `POST /api/manager/responsibilities` | Writable, active division; owner and members must be `WORK` members there; an unassigned area is ADMIN-only; all re-checked inside the write. |
| `PATCH /api/manager/responsibilities/:id` | Current and destination division authorized inside the write; changed relationships validated, retained ones preserved. |
| `PATCH /api/manager/responsibilities/:id/order` | Reorder is scoped to one division and one status group; both affected revisions are checked. |
| `POST /api/manager/responsibilities/:id/retire` | Same protocol as an edit; the record is never deleted. |
| `POST /api/manager/responsibilities/:id/reactivate` | Same protocol as an edit. |
| `POST /api/employee/my-work` | Writable, active division + the member's own `WORK` membership; the stored role and membership are re-read inside the write. |
| `POST /api/employee/projects` | Same protocol as member task creation. |
| `POST /api/employee/subprojects` | Same protocol as member task creation. |
| `POST /api/employee/requests` | `assertReadableDivision` for the task's project, re-checked inside the write. |
| `GET /api/employee/snapshot` | `INTERNAL` work scoped to the caller's readable divisions on the server. |
| `PATCH /api/manager/members/:id` | Division grants, oversight flag, membership preflight and audit (ADMIN); the actor's role and the retained-grant lifecycle are re-read inside the transaction. |
| `POST /api/admin/divisions` | ADMIN; the initial sort order is allocated inside the write; retry-safe through the idempotency key. |
| `PATCH /api/admin/divisions/:id` | ADMIN; the revision is re-read inside the transaction. |
| `PATCH /api/admin/divisions/:id/order` | ADMIN; neighbours come from the one canonical order inside its status group; both revisions are checked. |
| `POST /api/admin/divisions/:id/retire` | ADMIN; takes the membership lock so a concurrent assignment is serialized. |
| `POST /api/admin/divisions/:id/reactivate` | ADMIN; same lock as retirement. |
| `POST /api/admin/projects/:id/transfer-division` | ADMIN only; the lock is taken first and the **complete** assignment set is re-queried inside the transaction. |
| `GET /api/public-config`, `POST /api/session` | Session- and division-independent by design; see §7.1. |
| Publication (`publishNow`) | **Blocked at execution** while the snapshot cannot enforce per-division isolation (see §8). |

## 7. Client behaviour

* The header shows the division switch (`DivisionScopeBar`). One readable division is shown as a
  name; several offer a selector plus `すべての閲覧可能な課`. A division the caller may not read is
  never offered, and selecting one is ignored.
* The selection lives in page memory only (`apps/web/src/state/division.ts`), is included in the
  affected cache keys, survives a language switch, and is cleared on sign-out or a lost session.
* Projects (`Projects.tsx`), the employee project explorer, the timeline summaries and the task
  list send the selection with their request. The cache key carries it, so a late response from an
  older selection cannot repaint, and a change of selection resets the page position.
* Both overview variants (manager and member) subscribe to the same selection, include it in the
  request and the cache key, offer only the areas of that division, clear an area the new division
  does not contain, and carry the division into the open/overdue/upcoming drilldowns. Cards, lists
  and a drilldown therefore always describe the same scope, and "all readable divisions" remains a
  read-only aggregate.
* Division administration orders by the one canonical list (active/retired group, sort order, name,
  identifier). The move buttons use the neighbour inside the *same* status group, so a retired
  division is never dragged into the active ordering, and equal sort orders still move.
* The aggregate "all readable divisions" view is never a creation destination: a creation form needs
  one concrete division, and a task or subproject derives it from the selected project.
* Both project creation forms show the division. The options after it follow it: only the areas of
  that division and only the people holding a `WORK` membership there are offered, an incompatible
  choice is cleared, and an existing responsibility or owner is preserved so an unrelated edit never
  drops a relationship. An existing project's division is shown read-only; moving it stays the
  separate ADMIN transfer.
* The task form's assignee picker stays disabled until the selected project's division is known, and
  offers nothing for a project without a division. It never falls back to "every employee".
* An assignee option label is the name plus division names and, only for a reader who may already
  see it, the employee identifier. A raw `MEM-…` identifier is never the label; while the selected
  label is loading or unavailable a localized placeholder is shown instead.
* `GENERAL_MANAGER` receives no write capability from `capabilitiesOf`.

### 7.1 Sign-in configuration is independent of the session

`GET /api/public-config` and `POST /api/session` are answered without resolving a session or a
division scope. A stale or unknown cookie, an expired session, a reader with no division grant and a
database that still needs migration 0012 therefore all reach the sign-in screen. When the division
payload cannot be built the sign-in call fails with `DATABASE_MIGRATION_REQUIRED` and issues no
cookie, and the screen names the readiness problem instead of implying a wrong password — it never
falls back to the Google wording when the configuration did not load.

## 8. Publication, reports and background work — honest boundary

* `/api/employee/snapshot` (this application) is scoped on the server, per §6.
* The V1 shared-dashboard workbook (`dashboard-app/` + `publishNow`) is a deliberately company-wide,
  allowlisted `INTERNAL` portfolio with no per-viewer identity, so it **cannot** filter by the
  reader's divisions. **Per-division isolation of that workbook is BLOCKED in this release.**
  Publication therefore now **fails closed at execution**: `publishNow` refuses with
  `NOT_CONFIGURED` (503) before any slot is written, and `publicationStatus` reports
  `divisionIsolationSupported: false`. Publication stays OFF by default and requires ADMIN plus
  `ENABLE SHARED DASHBOARD PUBLICATION` on top of that.
* A snapshot committed by an earlier build is **not** revoked by this change. Removing or replacing
  a previously published snapshot is a separate rollout decision for the operator (delete or
  replace the snapshot workbook by hand, with the record that the old rows remain readable until
  then). Blocking a new publication is not evidence that old published data is gone; nothing here
  claims that.
* Reports and exports are scoped on the server for the endpoints listed in §6. Worker jobs and the
  publication pipeline were **not** re-examined by this release, so nothing here claims that a
  background job resolves a recipient's division scope. No outbound feature is enabled by this
  change.
* `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**; nothing here is live
  Workspace verification.

## 9. Deployment order and rollback

Nothing in this release deploys, migrates, initializes, installs a trigger or activates mail,
Calendar or publication on its own.

1. Build and verify locally (`npm ci` if a manifest changed, `npm run lint`, `npm run typecheck`,
   `npm test`, `npm run validate`, `npm run build`, `npm run smoke:prod`).
2. On the target environment: verify the backup first, then apply `0012_divisions` as an explicit
   one-shot step (`npm run db:migrate`). It is additive and seeds no data.
3. Record the initial divisions once (`bootstrapDivisions`) and run the reviewed mapping.
4. Start the rebuilt API and worker, then reload browsers.
5. Verify: `/healthz`, `/readyz` reports schema 12, an ADMIN sees `課の管理`, a single-division
   manager sees only its own division, an assignment to a person outside the division is refused,
   and a membership with active work cannot be removed.

**Rollback.** Schema compatibility is **not** authorization compatibility.

The migration is additive, so an older application starts against the schema-12 database without a
schema rollback. That does not make the rollback safe on its own: an older build ignores
`DIVISIONS`, `MEMBER_DIVISIONS` and the two division columns, so it does **not** enforce the
division boundary and can restore broad access to work that the division rules had narrowed.
Treat a code rollback as an authorization regression and follow this controlled procedure:

1. **Stop the rollback before it widens access.** Either keep the rebuilt application running, or
   keep the previous deployment stopped until the decision below is recorded. Never leave an older
   build serving traffic while division-scoped work is present, unless the operator has explicitly
   accepted the widened access with a written record (who, when, why, for how long).
2. **Preserve the data and the history.** `DIVISIONS`, `MEMBER_DIVISIONS`, `PROJECTS.division_id`,
   `RESPONSIBILITIES.division_id`, `MEMBERS.all_divisions_read` and every audit row stay exactly as
   they are. Do not drop a table, a column, a trigger or a row, and never reset the database; doing
   so destroys the mapping, the membership history and the trail that explains it.
3. **If the rollback must proceed**, restrict exposure while the older build runs: limit who can
   reach the application (network or proxy allowlist), keep publication OFF, keep mail and Calendar
   OFF, and record the accepted risk in the operating log.
4. **Revert forward.** The correct correction is a new build (a new migration if a schema change is
   genuinely required) that restores the division enforcement. An applied migration file is
   immutable: fix it with a new file, never by editing history.
5. **Restore from a verified backup only as a last resort**, and only as an explicit, reviewed
   operator decision — it discards work recorded after the backup.

Nothing in this repository performs a rollback, a migration or a restore automatically.

## 10. Verification

Local evidence (see `docs/v2/ACCEPTANCE.md` for the recorded results and timestamps):

* `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run validate`, `npm run build`,
  `npm run smoke:prod`.
* Real PostgreSQL coverage: `apps/api/test/divisions.test.ts` (authorization, query-scope
  narrowing, editor boundary, history withholding, assignment, administration and migration
  constraints), `apps/api/test/division-writes.test.ts` (responsibility assignment, responsibility
  ordering, a real transfer interleaving, role/activation demotion while `WORK` membership remains,
  division creation and ordering, retained grants and retired-division history),
  `apps/api/test/division-concurrency.test.ts` (barrier-based interleavings, including a real
  read-grant revocation and a cross-division transfer), `apps/api/test/sign-in.test.ts` (sign-in
  configuration and readiness), `packages/domain/test/divisions.test.ts` (policy),
  `apps/web/test/division-ui.test.tsx`, `apps/web/test/overview-division.test.tsx`,
  `apps/web/test/branding.test.tsx` and `apps/web/test/task-assignee-filter.test.tsx` (client).

Live Workspace behaviour, a real production database, browser screenshots of the desktop and narrow
layouts and the V1 shared-dashboard reader remain **BLOCKED / NOT_RUN** until recorded evidence
exists. No local result in this document is presented as live verification.

## 11. Corrective release, 2026-11-11

This section is current. It records the work that made the rules above true for the paths that still
bypassed them, plus the V2 branding change. It supersedes any earlier wording in this document that
implied those paths were already covered.

### 11.1 Branding

* The V2 application name is `シゴトモ` / `SHIGOTOMO`, from `APP_BRAND` in `packages/i18n` and the
  `app.name` label in `apps/web/src/i18n.tsx`. `packages/i18n/src/dictionary.json` is generated from
  the V1 source and keeps the V1 product name; the brand is a separate value, so regenerating the
  dictionary cannot silently revert the branding.
* The authenticated header `<h1>`, the sign-in `<h1>`, the navigation `aria-label`, the browser
  `document.title` and the static `<meta name="application-name">` all follow the selected language.
  Switching language sets the title in the same render and never navigates, so the route, the
  filters, an open editor and a selection survive.
* `industrialName.png` stays the authenticated header image and `companyLogo.png` stays the sign-in
  logo with its own alternative text; neither `alt` is replaced with the product name.
* A division record is never renamed: `設計・開発課` remains a valid stored division name, and
  tables, identifiers, packages, APIs, environment variables, migrations, stored roles and
  historical audit text are untouched.

### 11.2 Transaction-time authorization and the lock order

* `lockDivisionMutation(tx)` acquires `member-divisions` and then `members:role-and-activation`.
  Every division-scoped write, membership change, role/activation change and account mutation takes
  that order and only that order. Earlier wording in `ARCHITECTURE.md` that said a division write
  takes "no second advisory lock" is superseded: the second lock is the role/activation lock, taken
  after the division lock, and no path takes the pair in the opposite order.
* `authorizeMutation(tx, ctx, { role, divisionId, acceptsNewWork })` is the one transaction-time
  gate: it re-reads the actor's stored role and activation, re-applies the canonical role
  capability, re-checks division authority, and only then lets the caller mutate.
* `authorizeMutation` / `lockDivisionMutation` now cover: project create, edit and archive;
  subproject create, edit, move, archive and reactivate; task create, edit and reassign; assignment
  approval; schedule confirmation; direct completion; ADMIN completion override; reopening; request
  decisions and submission; responsibility create, edit, reorder, retire and reactivate; division
  create, rename, reorder, retire, reactivate and transfer; member create/edit (including role,
  activation and grants) and the account routes.
* A `MEMBER` or `VIEWER` that keeps a `WORK` membership does not pass a manager mutation after a
  downgrade: the role check is the first thing the transaction re-applies. An idempotent replay is
  answered only after the same authorization, and a replay never re-executes the mutation:
  `runIdempotent` takes an `authorize` guard that runs before the stored answer is returned.

### 11.3 Responsibility assignment and ordering

* See §4.1 for the assignment rules, and §5.1 for the grant comparison.
* `moveResponsibility` resolves the neighbours inside the same **division** and the same status
  group, in the one order `listResponsibilities` returns (status, sort order, name, identifier),
  refuses a foreign `expectedNeighborId`, checks both affected revisions, and writes only the sort
  orders that change (`resequencedSortOrders`). An unmapped area is ordered only among unmapped
  areas, so ADMIN remediation never disturbs a mapped division's order.

### 11.4 Project transfer

`transferProjectDivision` now does all authoritative work inside one transaction that takes the
lock first: it re-authorizes the ADMIN, re-reads the project's revision and division, re-checks the
destination division's lifecycle and the responsibility agreement, and re-queries the **complete**
assignment set (`currentAssignmentSet`: project owner, task owners, active additional assignees,
subproject owners) through the transaction handle. A transfer that is already waiting for the lock
sees an assignment committed while it waited, and refuses the whole move instead of writing a
division that makes that assignment ineligible. History, identifiers, owners and responsibilities
are never changed by the refusal.

### 11.5 Retired divisions and retained grants

* `loadScope` and `reauthorizeInTransaction` read divisions **including retired ones**, so a mapped
  retired division stays in a scope that may already read it; unmapped work stays invisible to
  oversight because only `manageAll` receives the unrestricted filter.
* `divisionReferences` keeps a retired division in `readable` for a caller who may read it (retained
  relationship or documented oversight) and never in `writable`, so it can be named in a filter and
  selected for history but never offered as a new-work destination.
* `applyMemberDivisionGrants` validates a submitted grant against the full division list: a
  *retained* grant to a retired division is preserved, and a *new* grant in a retired division is
  refused (`INVALID_TRANSITION`). A member edit that does not mention a retired division keeps it.

### 11.6 Division creation and ordering

* `createDivision` allocates the next free sort order inside its status group inside the write, and
  is retry-safe through the established idempotency mechanism (a repeated name replays the stored
  answer instead of inserting a duplicate).
* `moveDivision` reads its neighbours from the one canonical order inside the same status group,
  refuses a stale revision or an unexpected neighbour, and writes only the rows whose order changes
  with their revisions. Equal sort orders are separated deterministically instead of being
  un-movable.
* No migration is required: `0012_divisions` is unchanged and the runtime allocates the order it
  needs. Nothing rewrites existing equal-order rows until an administrator moves one of them.

### 11.7 Overview, requests and workload follow the division switch

Both overview variants (`apps/web/src/screens/Overview.tsx`) subscribe to
`apps/web/src/state/division.ts`, include the selection in the request **and** the cache key, filter
the responsibility options to that division, clear an incompatible responsibility, and carry the
division into the KPI, overdue and upcoming drilldowns. Rapid switching cannot show a stale result:
the newer selection owns a different cache key, so the older answer paints nothing.

The same selection is now sent by the two other division-sensitive screens this release audited:

* 申請一覧 (`Requests.tsx`) sends `divisionId` on the queue read and on the single page-entry import
  and keys the queue by it, so the total and the page describe one division.
* The workload report and its drilldown (`Workload.tsx`) send `divisionId` in the shared base
  parameters, so every figure and the drilldown behind it use the same scope.

On the server, `RequestQueueQuery` and the workload filters accept `divisionId` and resolve it
through `scopedDivisionIds`: an unauthorized division is `404 NOT_FOUND`, exactly like an unknown
one. Screens that do not read a division (administration, diagnostics) are unchanged, and no claim
is made that every screen was re-examined.

### 11.8 Not verified here

Browser rendering of the desktop and narrow layouts, keyboard navigation and focus, live Workspace
behaviour, a production database and the V1 shared-dashboard reader are **NOT_RUN**. Nothing in this
section is a live-verification claim.

## 12. Unmapped work mapping (reviewed apply)

Legacy work that carries no division is invisible to every scoped reader: `readableDivisionIds` is
unrestricted only for `ADMIN`, and `divisionScopeSql` never matches a blank column for anybody else.
That is the intended behaviour - unmapped work belongs to nobody - but it also means the remediation
cannot wait for "the right person to notice it in a list". This section describes the `ADMIN` tool
that performs §5 steps 1-7 against the **stored** rows, with a backup gate and an all-or-nothing
apply. It adds no migration, no table and no column; `0012_divisions` is unchanged.

### 12.1 Routes

| method | route | role | purpose |
| --- | --- | --- | --- |
| `GET` | `/api/admin/divisions/unmapped` | ADMIN | bounded read model + counts (also used by the overview hint) |
| `POST` | `/api/admin/divisions/mapping/preview` | ADMIN | the same read model with an explicit selection, `pageSize` ≤ 50 |
| `POST` | `/api/admin/divisions/mapping/apply` | ADMIN | the reviewed, backup-gated, all-or-nothing apply |

All three re-check the role on the server (`requireRoleOf(request, 'ADMIN')`), and `apply` re-checks
it **inside** the transaction after `lockDivisionMutation`, so a demotion that commits while the
apply waits for the lock cannot be bypassed. The read model is bounded and paginated; it never loads
the whole table. `apps/api/src/services/division-mapping.ts` holds the rules,
`packages/db/src/repo/division-mapping.ts` the bounded queries.

### 12.2 Proposal rules

For every unmapped project and every unmapped responsibility the preview reports one state:

| state | meaning |
| --- | --- |
| `SUGGESTED` | exactly one target remains after the rules below |
| `AMBIGUOUS` | several plausible targets; the administrator must choose |
| `CONFLICT` | the evidence contradicts itself (for example the area names one division and its projects another) |
| `UNRESOLVED` | no evidence at all: no active assignment, no scoped area |

The rules are applied in order and the first match wins:

* **A - explicit** (`explicitDivisionId` in the preview body). Only when the record is eligible; an
  explicit target never bypasses eligibility.
* **B - the area's division.** For a project whose responsibility is already scoped, the area names
  the division; a project that already carries a different division is a `CONFLICT`, not a
  suggestion.
* **C - the intersection of the active assignees' `WORK` memberships.** One surviving division is
  `SUGGESTED`, several are `AMBIGUOUS`, none is `CONFLICT`.

Evidence is reported per record: every active assignment with its eligible flag, and every
**historical** assignment (an inactive former owner, or a removed assignment). A historical
assignment is retained as evidence and is never a blocker, so mapping a project whose only current
owner is inactive stays possible - the inactive owner is reported, not silently dropped and not
"repaired".

Archived records are excluded by default and listed only with `includeArchived`, unchanged in
lifecycle; a mapped archived record is not un-archived, and mapping never changes a status.

### 12.3 Apply contract

`POST /api/admin/divisions/mapping/apply` takes the records the administrator actually reviewed:

```json
{
  "idempotencyKey": "map-<generated>",
  "confirmed": true,
  "confirmation": "MAP 2 RECORDS",
  "reason": "Reviewed legacy mapping",
  "batch": [
    { "entityType": "PROJECT", "entityId": "PRJ-1", "divisionId": "DIV-DESIGN-DEV", "revision": 7 },
    { "entityType": "RESPONSIBILITY", "entityId": "RSP-1", "divisionId": "DIV-DESIGN-DEV", "revision": 2 }
  ]
}
```

* The **confirmation phrase is derived from the batch size** (`MAP <n> RECORD` / `MAP <n> RECORDS`;
  `mappingConfirmationText`). A wrong phrase, a missing `confirmed`, a duplicate entity in one batch
  or a batch above `MAPPING_BATCH_LIMIT` (100) is refused before anything is written. The transport
  schema caps the array at 200 as a guard; the business limit is 100.
* Every record carries the `revision` the screen displayed. A mismatch is refused; a record that is
  no longer unmapped is refused rather than re-mapped.
* A responsibility target validates the **whole area scope** first: every project of that area must
  end in the same division after the batch, otherwise the trigger `eh_check_responsibility_division`
  would refuse the row anyway and the batch is refused as `INVALID_TRANSITION`.
* Order inside the transaction is fixed: **projects first, responsibilities second** - the trigger
  compares a scoped area against its projects, so the reverse order fails for the documented
  starting state.
* Everything is one transaction under `lockDivisionMutation` (then the role/activation lock when a
  role or activation is re-read). One ineligible record, one stale revision or one scope violation
  commits **nothing**.
* Success writes one audit row per mapped record (`PROJECT_DIVISION_MAPPED`,
  `RESPONSIBILITY_DIVISION_MAPPED`) and one batch row (`DIVISION_MAPPING_APPLIED`) carrying the
  batch identifier, the reason when supplied, the backup and the actor. The batch identifier is
  deterministic, and a replay of the same `idempotencyKey` returns the stored answer after the
  authorization re-check instead of applying twice.

### 12.4 The backup gate

An apply requires a **verified backup**: the newest `backup_log` row with `result = 'OK'` and a
non-empty `checksum`, no older than 24 hours (`MAPPING_BACKUP_MAX_AGE_MINUTES`). Otherwise the
request fails with `409 MAPPING_BACKUP_REQUIRED` and nothing is written; the response names the
`backup-now` command. The same status is shown in the panel and in the API answer, so an operator
cannot mistake the gate for a UI bug. Restoring a backup stays an explicit, documented operator step
(`BACKUP_RESTORE.md`); the tool never restores anything.

### 12.5 Failure handling in the panel

`apps/web/src/components/division-mapping-panel.tsx` renders the counts, one page of records with
their state, rule, blockers and evidence, the verified-backup banner, an explicit target filter, an
archived toggle and pagination. It is read-only until the phrase is typed, and it sends the record
IDs, target IDs and revisions it displayed. A visible failure is never rendered as "nothing is
unmapped": the panel shows an error with a retry and the empty state only for a successful empty
answer. A conflict (`EDIT_CONFLICT`, a stale record, a backup that appeared or disappeared) keeps the
page and asks for a re-read; the pending selection is kept with the record it was made for, and the
phrase bounds the batch, so a refresh cannot silently apply a different set.

### 12.6 What the tool never does

* It never invents a division, a member, an owner or a responsibility, and it never maps a record
  automatically: every write names the target itself.
* It never grants a membership. Mapping the work makes it visible to the members who already hold
  that division; granting a division stays the reviewed membership path (§5.1).
* It never changes an owner, an assignee, a deadline, a status, a progress value or a schedule, and it
  never rescopes an area whose projects disagree.
* It never deletes, archives or restores anything, never sends mail, never publishes and never
  triggers an automatic retry.
* It never touches the operational database on its own: there is no boot-time migration, no seed and
  no scheduled mapping.

### 12.7 Verification

`apps/api/test/division-mapping.test.ts` (22 cases, real PostgreSQL) covers the proposal rules, the
preview counts and archived split, the historical-assignment case, the ADMIN-only refusals, the
audit rows, the backup gate, a stale revision, the atomic refusal of one ineligible record in a
batch, the preserved inactive owner, the exact phrase and duplicate record, the idempotent replay,
the already-mapped refusal, the whole-scope validation, the batch limit, two lock-timing races
(demotion and removed membership) and the end-to-end visibility rule: unmapped work is invisible to
both a scoped manager and an all-division manager, and visible to the division after the mapping
without a new grant or a new session.

`apps/web/test/division-mapping-ui.test.tsx` (8 cases) covers the read-only start, the exact phrase,
the payload actually sent, the English labels, a successful empty answer versus a failed read, and
the new-work default rules. `apps/web/test/overview-division.test.tsx` covers the ADMIN-only overview
hint (count, zero, non-ADMIN, invalid payload).

Browser rendering, keyboard behaviour and live Workspace behaviour remain **NOT_RUN** here; the local
suite is not live verification and `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR
PRODUCTION**.
