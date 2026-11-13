# V2 interface conventions

This document records the conventions the **V2** application (`apps/web`) follows today. It is
deliberately separate from the historical V1 guidance in the repository root
(`docs/UI_LOCALIZATION.md`, `ARCHITECTURE.md`, the V1 gate files): V1 is an Apps Script application
that is still deployed and must not be modernised from these notes, and V2 is the PostgreSQL
application under `apps/` and `packages/`.

If a rule here and a V1 rule disagree, the V1 rule still governs V1 code and this rule governs V2
code. Nothing here renames a stored value, an identifier or an enum.

## 1. Branding and language

- The product name is `シゴトモ` / `SHIGOTOMO` (`packages/i18n`, `brandName`). It is a brand, never a
  division: a division stored as `設計・開発課` is rendered exactly as stored.
- Japanese is the default. The `日本語 | English` switch stays available on every screen and keeps
  the route, the filters, the selected record and an open editor's input.
- Only display labels are translated. Stored text, identifiers and enum values never are.
- The language preference is the only browser-persisted preference (`localStorage`), together with
  the non-sensitive request receipt metadata the rules allow.

## 2. Query state

Every server read is presented through one of four mutually exclusive states, never a blend:

| State | Presentation |
| --- | --- |
| First read pending | one `role="status"` line, no skeleton of imagined data |
| First read failed | one alert with an explicit Retry; **never** a loading line |
| Payload shown, refresh pending | the payload plus "更新中…" |
| Payload shown, refresh failed | the payload plus a warning that the numbers are older |

A cached answer is described as "最終更新 HH:mm (Tokyo)", never as live data. Zero is never
substituted for a missing or failed total.

Empty states are distinct:

- **no readable scope** - the account may read no division, explained once;
- **no matches** - records exist for the scope but the active filter matches none, with Clear
  filters;
- **no records** - the scope is readable, unfiltered and genuinely empty.

## 3. Action availability

- Capability flags (`state/capabilities.ts`) answer "may this role do this at all".
- The record's server-computed `canWrite` answers "may it do it here". A write action is offered only
  when both agree (`canEditRecord`). Recoverable removal (`canRecoverDelete`) is a manager capability
  and follows the same per-record rule: a mixed- or all-division list never offers a removal for a
  record the server would refuse, and the shell's selected division is never evidence of a record's
  permission.
- Restoration (`canRestoreDeleted`), permanent erasure (`canPurgeRecord`) and reopening
  (`canReopenTask`) are ADMIN capabilities and are never rendered for a manager.
- Creation requires a concrete destination (`hasWritableDestination`), and an *unloaded* division
  scope is treated as unknown rather than empty.
- A record the caller may only read shows a "閲覧のみ" marker instead of a disabled-looking editor.
- These are presentation aids. The server re-checks every command; hiding a control is a usability
  decision and a forged flag grants nothing.

## 3.1 Confirming a corrective action

One component, `components/ActionConfirmDialog.tsx`, asks for a recoverable removal, a restoration, a
corrective reopening and a permanent task/subproject erasure.

- The panel names the exact record (readable name plus its project/subproject context) and states the
  real consequence in words inside a red panel; colour is decoration, never the only signal.
- There is no typed phrase and no mandatory free-text reason. The footer offers Cancel and exactly one
  action-specific button: `削除する` / `Delete`, `復元する` / `Restore`, `完了を取り消す` /
  `Reopen task`, `完全に消去する` / `Erase permanently`.
- Nothing happens before that button is activated. A second activation in the same tick never starts a
  second write, and the button shows a busy state while the write is in flight.
- Wording stays honest: a recoverable removal disappears from normal lists while the record and its
  history are retained; a restoration returns the existing record; a reopening reverses the current
  completion while historical approvals stay; a permanent erasure cannot be restored through the
  application.
- Focus lands on Cancel first, Escape closes, and focus returns to the invoker (the shared `Modal`
  owns the native `<dialog>`, the focus order and the focus return).
- A conflict keeps the dialog open and offers an explicit reload; an unobservable outcome says so and
  is never retried or presented as a failure. Project and responsibility erasure keep their typed
  `DELETE <id>` confirmation.

## 3.2 The task-list action column

The task table is `table-layout: fixed`. Its action column holds Edit and the `その他` / `More` menu
trigger side by side, so the column width must fit both controls plus the cell padding and the
`.35rem` gap (`10.5rem` in `styles.css`), and the controls wrap inside the cell rather than protrude
past the table's right border. Do not hide the overflow to conceal a misfit, and keep the menu popup
reachable when the row sits at the right or bottom edge.

## 4. Scope transitions

One policy, `state/scope.ts`:

- a division change restarts the list at page 1;
- selections, expanded branches, project focus and drilldowns that belonged to the previous scope are
  cleared (their compatibility is not known);
- independent presentation state - sort order, search text, period, granularity - survives;
- a slow or failed reference read never clears a selection;
- every scope value is part of the request **and** the cache key, so a late answer from a previous
  scope cannot paint.

## 5. Search

`components/search-input.tsx` is the one server-backed search box: visible text separate from the
applied query, 275 ms debounce, Japanese IME composition respected, a polite "検索しています…" status,
and the applied query in the cache key. Whole datasets are never loaded to filter locally.

## 6. Dialogs and mutation lifetime

- A mutation's **cache effect** belongs to the session (`state/mutation.ts`); a dialog closing, a
  route change or an unmount never suppresses it.
- A mutation's **local state** (save badge, inline error, close action) belongs to the dialog and
  disappears with it.
- A request submission is tracked at session level (`state/submissions.ts`); the shell reports the
  outcome even when the form is gone, and an unobservable outcome stays unknown and is never retried.
- Only a genuine authorization denial revokes the client. A timeout, a conflict, a validation
  failure or an ambiguous write keeps the existing safe error handling.

## 7. Keyboard and focus

- Modals use the native `<dialog>` (focus trap, Escape, inert background).
- The mobile drawer moves focus into itself, contains Tab, closes on Escape, returns focus to its
  trigger and drops its state when the layout becomes the desktop sidebar.
- Menus implement `role="menu"` semantics: ArrowUp/ArrowDown wrap across enabled items, Home/End
  jump to the ends, Escape closes and returns focus, and Tab leaves.
- Sortable headers carry `aria-sort` on the header cell.
- Long stored text renders through React as text (`DescriptionText` preserves line breaks). No
  `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`.

## 8. Layout and density

- One canonical width rule per table. In the task table the name takes the remaining space, and the
  project, owner, status, deadline and action columns keep fixed widths that shrink at 1100px and
  become automatic below 900px.
- Secondary row actions live in the row's その他 menu; only the primary action stays a button, so the
  name, deadline and status keep their width.
- Text wraps (`overflow-wrap: anywhere`) rather than being clipped. Overflow is never hidden to
  conceal content.
- No density preference exists. It would need browser evidence, and it would have to stay in memory
  and keep accessible target sizes.

## 9. Session-owned browser state

- Nothing but the language and non-sensitive request receipts is persisted.
- Sign-out and a lost session clear the query cache, the division selection, the submission tracker,
  the route memory and every open form.
- Route memory (`state/navigation.tsx`) is cleared on sign-out, and a write that belongs to an ended
  session is ignored.

## 10. Localization of time

- An **instant** (`submittedAt`, `decidedAt`, `updatedAt`) is displayed as an Asia/Tokyo wall-clock
  value through `state/format.ts`.
- A **date only** value (`Due_Date`, `plannedStart`) is displayed exactly as stored, so a deadline
  never shifts by a day because of the browser's timezone.
- Raw ISO slicing (`string.slice(0, 16)`) is not used for display.

## 11. Corrections to §6 (2026-11-11)

The section above described the intent; the implementation had four defects, now fixed. Read §6 with
these corrections:

- **A submission is an attempt.** A dialog owns `submissionId`; each attempt owns `attemptId` (the
  `clientRequestId`). A definite refusal keeps the draft and a deliberate correction starts a **new**
  attempt with a **new** identity. `SENDING`, `RECEIVED` and `UNKNOWN` are never resubmitted.
- **Success requires a validated acknowledgement.** `RECEIVED` is shown only when the payload
  matches `RequestSubmissionReceipt`. An empty payload, a missing/invalid `requestId` or an unknown
  state is `UNKNOWN` with `INVALID_RESPONSE`.
- **Dismissal hides, it does not forget.** The notice can be dismissed; the attempt (and therefore
  the duplicate/uncertainty guard) is retained.
- **Notification surfaces.** While an open dialog reports its own attempt the shell stays quiet. A
  `RECEIVED` or `REFUSED` outcome is marked as reported by the host page; an `UNKNOWN` outcome is
  deliberately **not**, so it remains visible in the shell after the dialog or the page is gone. A
  host page that shows the same message therefore shows it once; an unknown outcome can appear both
  in the form and in the shell, which is intentional for the one state a person must not ignore.
- **A conflict reload re-reads the record.** "Load the latest version" reads the selected record by
  id and replaces the revision the dialog submits; it is not a refresh of the list behind the dialog.
  The entered note/reason is kept, a new confirmation is required, an unusable record disables the
  action, and a failed reload claims nothing.
- **Cache retention exempts what is on screen.** Trimming evicts only inactive, settled entries; the
  retention target is not a hard total bound while screens are mounted.

Still not implemented, and stated as a limitation: no field-by-field conflict comparison (a reload
shows the whole current record), no universal polling, no autosave.


## Member collaboration and manager recovery — 2026-11-13

This user-approved policy supersedes earlier statements that members cannot edit/remove existing
tasks or subprojects, and that restoration is ADMIN-only. MEMBER may edit ordinary task and
subproject fields and recoverably delete either record regardless of owner, within a WORK division
and an INTERNAL, non-archived project they may see. READ-only grants never allow a write.
MANAGER may restore tasks/subprojects in WORK divisions; ADMIN retains cross-division recovery.
Projects/responsibilities, approvals, direct completion, notification settings, permanent erasure
and completed-task reopening retain their existing separate permissions. Members do not restore.

The member opens a task detail to edit/delete it, or a project hierarchy to edit/delete a
subproject. Editors fetch fresh narrow records and revisions; saves are partial patches. A red
confirmation panel requires one explicit button and no typing. Deletion retains the row/history,
children/dependencies and existing blockers; recovery restores the same ID and status. Completed
work stays completed. Managers reach Deleted Items through the management navigation.

Server authorization is repeated under the existing division/role advisory locks. Deleted Items
filters both records and totals by writable divisions before pagination. Member edit APIs retain
project visibility and field allowlists and do not expose manager-only history or settings.
No schema change, operational migration, deployment or outbound activation is required or performed.
