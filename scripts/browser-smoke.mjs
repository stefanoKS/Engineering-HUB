/** Real Chromium journeys against the built app and isolated PostgreSQL fixture. */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
/**
 * @param roleFixtures optional `{ localMode, password, roles: { member, viewer } }` so each signed-in
 *   role gets a real browser journey against the same server.
 */
export async function browserSmoke(origin, email, local = null, roleFixtures = null) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  /** Blur the focused control and return to the top before capturing evidence. */
  async function capture(path) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path, fullPage: true });
  }

  /**
   * The shared Back control has to sit at the top-left of the content column: aligned with the page
   * title's left edge, above it, and never centred or right-aligned at any viewport width.
   */
  async function expectBackButtonLeftAligned(titleName) {
    const back = page.getByRole('button', { name: '← Back', exact: true });
    await expect(back).toBeVisible();
    const backBox = await back.boundingBox();
    const titleBox = await page.getByRole('heading', { name: titleName, exact: true }).boundingBox();
    expect(backBox && titleBox).toBeTruthy();
    expect(Math.abs(backBox.x - titleBox.x)).toBeLessThanOrEqual(2);
    expect(backBox.y).toBeLessThan(titleBox.y);
    const viewport = page.viewportSize();
    expect(backBox.x + backBox.width).toBeLessThan(viewport.width / 2);
    const gap = titleBox.y - (backBox.y + backBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(120);
  }

  async function signInAs(identity) {
    // A fresh language state so the Japanese login labels are deterministic; the page must be on
    // the application origin before localStorage is reachable.
    await page.goto(origin);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    if (local) {
      await page.getByLabel('社員番号', { exact: true }).fill(identity.employeeId);
      await page.getByLabel('パスワード', { exact: true }).fill(identity.password);
      await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    } else {
      await page.getByLabel('会社のメールアドレス').fill(identity.email);
      await page.getByRole('button', { name: 'Google でサインイン' }).click();
    }
    await expect(page.locator('.app-nav')).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).click();
  }

  /**
   * Read-only journey: All Work loads through the role-appropriate endpoints, the expandable task
   * is reachable, no management control is rendered, task and project detail open, and the
   * personal list stays available.
   */
  async function readOnlyJourney(roleName) {
    // The Projects entry opens the read-only explorer; the management list is never used.
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search by project name', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Responsibility', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New project', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browser edited project', exact: true })).toBeVisible();
    // The allowlisted project description reaches the card; nothing private does.
    await expect(page.getByText(/Browser verified description/).first()).toBeVisible();
    await mkdir('work/screenshots', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture(`work/screenshots/member-project-explorer-${roleName}.png`);
    await page.setViewportSize({ width: 1920, height: 1280 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(`work/screenshots/member-project-explorer-${roleName}-1920.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(`work/screenshots/member-project-explorer-${roleName}-mobile.png`);
    await page.setViewportSize({ width: 1366, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);

    // The server-side search narrows the list and the term survives navigation.
    await page.getByRole('searchbox', { name: 'Search by project name', exact: true }).fill('Edited');
    await expect(page.getByRole('link', { name: 'Browser edited project', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Browser edited project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expectBackButtonLeftAligned('Browser edited project');
    await expect(page.getByText('Project information', { exact: true })).toBeVisible();
    await expect(page.getByText(/Browser verified description/).first()).toBeVisible();
    // The subproject description is readable in place, without a separate page.
    await expect(page.getByText(/Browser subproject description/).first()).toBeVisible();
    await page.getByRole('button', { name: 'View details', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Hide details', exact: true }).first()).toBeVisible();
    await capture(`work/screenshots/member-project-detail-${roleName}.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await expectBackButtonLeftAligned('Browser edited project');
    await capture(`work/screenshots/member-project-detail-${roleName}-mobile.png`);
    await page.setViewportSize({ width: 1920, height: 1280 });
    await expectBackButtonLeftAligned('Browser edited project');
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    // A MEMBER files a subproject here straight away; a VIEWER never receives the control.
    if (roleName === 'member') {
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toHaveCount(0);
    }
    // Smart Back returns to the explorer the reader actually came from, with its search term intact.
    await page.getByRole('button', { name: '← Back', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Search by project name', exact: true })).toHaveValue('Edited');
    await page.getByRole('searchbox', { name: 'Search by project name', exact: true }).fill('');

    await page.locator('.app-nav').getByRole('link', { name: 'All work', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Browser verified task', exact: true })).toBeVisible();
    // The read-only project picker is populated (a manager-route failure would leave it empty).
    const picker = page.getByRole('combobox', { name: 'Projects', exact: true });
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).not.toHaveCount(1);
    // No management control anywhere in the list.
    await expect(page.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Include cancelled and archived', exact: true })).toHaveCount(0);

    // Task detail is readable and offers no action.
    await page.getByRole('link', { name: 'Browser verified task', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser verified task', exact: true })).toBeVisible();
    await expectBackButtonLeftAligned('Browser verified task');
    await expect(page.getByText('Task description', { exact: true })).toBeVisible();
    await expect(page.getByText(/Browser task description/).first()).toBeVisible();
    await capture(`work/screenshots/member-task-detail-${roleName}.png`);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(0);
    // Manager-only workflow sections are not part of a reader's task detail.
    await expect(page.getByText('Deadline history', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Confirm schedule', { exact: true })).toHaveCount(0);

    // Read-only project detail is reachable from the task's project link.
    await page.locator('a[href^="#/project/"]').first().click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    if (roleName === 'member') {
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toHaveCount(0);
    }
    // The project hierarchy is readable, but a MEMBER or VIEWER never receives a delete control.
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browser verified task', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: 'Show cancelled and archived', exact: true })).toHaveCount(0);

    // The personal list stays available to every role.
    await page.locator('.app-nav').getByRole('link', { name: 'My assigned work', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My assigned work', exact: true })).toBeVisible();
    if (roleName === 'member') {
      // A MEMBER files a task or a subproject straight away; both panels stay collapsed.
      await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toBeVisible();
      await expect(page.locator('.member-subproject-form')).toHaveCount(0);
      // One form at a time: opening the subproject form captures the member creation UI.
      await page.getByRole('button', { name: 'New subproject', exact: true }).click();
      await expect(page.locator('.member-subproject-form')).toHaveCount(1);
      await expect(page.getByLabel('Subproject name', { exact: true })).toBeVisible();
      await capture('work/screenshots/my-work-create-subproject-member.png');
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await expect(page.locator('.member-subproject-form')).toHaveCount(0);
      await expect(page.getByLabel('Task name', { exact: true })).toBeVisible();
      await capture('work/screenshots/my-work-create-task-member.png');
      await page.getByRole('button', { name: 'New task', exact: true }).click();
      await expect(page.getByLabel('Task name', { exact: true })).toHaveCount(0);
    } else {
      // A VIEWER may never file work or request completion.
      await expect(page.getByRole('button', { name: 'New task', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toHaveCount(0);
    }
    // The request history is collapsed until it is opened, and states its counts.
    const requestsToggle = page.getByRole('button', { name: 'Expand or collapse my requests', exact: true });
    await expect(requestsToggle).toHaveAttribute('aria-expanded', 'false');
    await mkdir('work/screenshots', { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture(`work/screenshots/my-work-${roleName}.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture(`work/screenshots/my-work-${roleName}-mobile.png`);
    await page.setViewportSize({ width: 1366, height: 768 });
    // No manager-only navigation is offered.
    await expect(page.locator('.app-nav').getByRole('link', { name: 'Automation', exact: true })).toHaveCount(0);
    await expect(page.locator('.app-nav').getByRole('link', { name: 'Accounts', exact: true })).toHaveCount(0);
    console.log(`PASS  ${roleName} journey: read-only All Work, task detail, project detail, personal list`);
  }

  /**
   * Manager journey: a MANAGER manages the hierarchy in context but has no removal
   * control anywhere, because only ADMIN may remove a record.
   */
  async function managerJourney() {
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('link', { name: 'Browser edited project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expectBackButtonLeftAligned('Browser edited project');
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Browser verified task', exact: true })).toBeVisible();
    const subprojectRow = page.locator('.hierarchy-row-subproject').filter({ hasText: 'Browser verified subproject' });
    await expect(subprojectRow.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(subprojectRow.getByRole('button', { name: 'New task', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    // A manager can still reach the completion action from a leaf task.
    await page.getByRole('link', { name: 'Browser child task', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    console.log('PASS  manager journey: hierarchy in context, edit and complete allowed, removal absent');

    // Read-only timeline: the project-detail entry point preselects the project, the hierarchy
    // expands on demand, and the legend names every visual meaning.
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('link', { name: 'Browser edited project', exact: true }).first().click();
    await page.getByRole('link', { name: 'View in timeline', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Timeline', exact: true })).toBeVisible();
    await expect(page.locator('.tl-kind-subproject').filter({ hasText: 'Browser verified subproject' })).toBeVisible();
    await expect(page.locator('.tl-kind-task').filter({ hasText: 'Browser verified task' }).first()).toBeVisible();
    await expect(page.getByText('Planned span', { exact: true })).toBeVisible();
    await expect(page.getByText('Deadline', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Child date range', { exact: true }).first()).toBeVisible();
    await mkdir('work/screenshots', { recursive: true });
    await capture('work/screenshots/timeline-project.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.tl-cell-name').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture('work/screenshots/timeline-project-mobile.png');
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The all-project view lists permitted project summaries with a real total.
    await page.getByRole('combobox', { name: 'Select a project', exact: true }).selectOption('');
    await expect(page.locator('.tl-kind-project').first()).toBeVisible();
    await expect(page.getByText(/^All permitted projects$/, { exact: true })).toHaveCount(1);
    console.log('PASS  Read-only timeline: project entry, hierarchy, legend, all-project summaries, responsive');

    // Workload: the axis states the unit and the date, and today carries its own marker.
    await page.locator('.app-nav').getByRole('link', { name: 'Workload', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workload report', exact: true })).toBeVisible();
    await expect(page.getByText('Tasks due (count)', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Date · /)).toBeVisible();
    await expect(page.locator('.timeline-bar.is-today')).toHaveCount(1);
    await expect(page.locator('.timeline-bar.is-today')).toContainText('Today');
    await expect(page.locator('.timeline-value').first()).toHaveText(/\d+ tasks?/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture('work/screenshots/workload-timeline.png');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await capture('work/screenshots/workload-timeline-mobile.png');
    await page.setViewportSize({ width: 1366, height: 768 });
    console.log('PASS  workload journey: axis labels, per-bucket counts, today marker');
  }

  try {
    await signInAs(local ? { employeeId: local.employeeId, password: local.password, email } : { email });
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Project name', { exact: true }).fill('Browser verified project');
    await dialog.getByLabel('Description', { exact: true }).fill('Browser verified description\nsecond line');
    await dialog.getByLabel(/^Responsibility/).selectOption('RSP-SMOKE');
    // Employee-visible so the MEMBER and VIEWER journeys can read this work.
    await dialog.getByLabel(/Shared dashboard visibility/).selectOption('INTERNAL');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Browser verified project', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New subproject', exact: true }).click();
    await dialog.getByLabel('Subproject name', { exact: true }).fill('Browser verified subproject');
    await dialog.getByLabel('Description', { exact: true }).fill('Browser subproject description');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Browser verified project', exact: true })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'Browser verified project' });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.getByLabel('Project name', { exact: true }).fill('Browser edited project');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browser edited project', exact: true })).toBeVisible();
    await page.locator('.app-nav').getByRole('link', { name: 'All work', exact: true }).click();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Projects', exact: true }).selectOption({ label: 'Browser edited project' });
    await dialog.getByLabel('Task name', { exact: true }).fill('Browser verified task');
    await dialog.getByLabel('Description', { exact: true }).fill('Browser task description\nsecond line');
    await dialog.getByLabel('Deadline', { exact: true }).fill('2026-11-05');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browser verified task', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Projects', exact: true }).selectOption({ label: 'Browser edited project' });
    await dialog.getByLabel('Task name', { exact: true }).fill('Browser child task');
    await dialog.getByLabel('Deadline', { exact: true }).fill('2026-11-06');
    await dialog.getByRole('combobox', { name: /^Parent task/ }).selectOption({ label: 'Browser verified task' });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browser child task', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand subtasks of Browser verified task', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Browser child task', exact: true })).toBeVisible();
    await mkdir('work/screenshots', { recursive: true });
    await page.screenshot({ path: 'work/screenshots/task-tree-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Collapse subtasks of Browser verified task', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Browser child task', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Expand subtasks of Browser verified task', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Browser child task', exact: true })).toBeVisible();
    console.log('PASS  Task tree: child creation, nested placement, collapse and reopen');

    // Project detail: one expandable hierarchy with contextual creation and the ADMIN-only
    // administrative-removal workflow.
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('link', { name: 'Browser edited project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();
    // Direct project tasks live in their own section, never inside a subproject.
    const directSection = page.locator('li.hierarchy-direct');
    await expect(directSection.getByRole('link', { name: 'Browser verified task', exact: true })).toBeVisible();
    await directSection.getByRole('link', { name: 'Browser verified task', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser verified task', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '← Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();

    // Contextual creation inside the subproject preselects it. The location is summarised until the
    // manager asks to change it, so the retained value is asserted after expanding that section.
    const subprojectRow = page.locator('.hierarchy-row-subproject').filter({ hasText: 'Browser verified subproject' });
    await subprojectRow.getByRole('button', { name: 'New task', exact: true }).click();
    await expect(dialog.getByText('Browser edited project / Browser verified subproject', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change location', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Change location', exact: true }).click();
    await expect(dialog.locator('label.field').filter({ hasText: 'Subproject' }).locator('select')).toHaveValue(/^SUB-/);
    await dialog.getByLabel('Task name', { exact: true }).fill('Subproject browser task');
    await dialog.getByLabel('Deadline', { exact: true }).fill('2026-11-07');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const subprojectBranch = page.locator('li.hierarchy-node').filter({ has: page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true }) });
    await expect(subprojectBranch.getByRole('link', { name: 'Subproject browser task', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 1920, height: 1280 });
    await mkdir('work/screenshots', { recursive: true });
    await page.screenshot({ path: 'work/screenshots/project-hierarchy-1920.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Collapse Browser verified subproject', exact: true })).toBeVisible();
    const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(narrowOverflow).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // A nested subproject is created from its parent header and keeps the stored parent link.
    await subprojectRow.getByRole('button', { name: 'Nested subproject', exact: true }).click();
    await dialog.getByRole('button', { name: 'Change location', exact: true }).click();
    await expect(dialog.locator('label.field').filter({ hasText: 'Parent subproject' }).locator('select')).toHaveValue(/^SUB-/);
    await dialog.getByLabel('Subproject name', { exact: true }).fill('Browser nested subproject');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse Browser nested subproject', exact: true })).toBeVisible();

    // A subproject that still owns a task is refused, with the reason and a route to its children.
    await subprojectRow.getByRole('button', { name: 'Delete Browser verified subproject', exact: true }).click();
    await expect(dialog.getByText('Browser verified subproject', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/Tasks remain/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Show children', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    // An empty subproject can be removed by ADMIN through the simple logical-removal confirmation.
    await page.getByRole('button', { name: 'New subproject', exact: true }).click();
    await dialog.getByLabel('Subproject name', { exact: true }).fill('Browser deletable subproject');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Collapse Browser deletable subproject', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Delete Browser deletable subproject', exact: true }).click();
    await expect(dialog.getByText('Remove this subproject?', { exact: true })).toBeVisible();
    await expect(dialog.getByText('The operation history will be retained for audit.', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Removed from active lists; audit history was retained.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Collapse Browser deletable subproject', exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    console.log('PASS  Project hierarchy: contextual creation, smart Back, blocked deletion, ADMIN-only logical removal');

    // Responsibility areas: a retired area leaves the default view, and ADMIN deletes an unused one.
    await page.locator('.app-nav').getByRole('link', { name: 'Responsibilities', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Responsibilities', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New responsibility', exact: true }).click();
    await dialog.locator('input[type="text"]').first().fill('Browser unused area');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Browser unused area', { exact: true })).toBeVisible();
    const areaRow = page.locator('tbody tr').filter({ hasText: 'Browser unused area' });
    await areaRow.getByRole('button', { name: 'Retire', exact: true }).click();
    await expect(dialog.getByText('Browser unused area', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Browser unused area', { exact: true })).toHaveCount(0);
    await page.getByLabel('Show retired', { exact: true }).check();
    await expect(page.getByText('Browser unused area', { exact: true })).toBeVisible();
    await expect(page.getByText('Retired', { exact: true })).toBeVisible();
    await page
      .locator('tbody tr')
      .filter({ hasText: 'Browser unused area' })
      .getByRole('button', { name: 'Delete responsibility', exact: true })
      .click();
    await expect(dialog.getByText('Delete "Browser unused area"? This cannot be undone.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Deleted "Browser unused area".', { exact: true })).toBeVisible();
    await expect(page.getByText('Browser unused area', { exact: true })).toHaveCount(0);
    await page.getByLabel('Show retired', { exact: true }).uncheck();
    console.log('PASS  Responsibility areas: retired hidden by default, ADMIN deletes an unused area');

    await page.locator('.app-nav').getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.locator('.kpi').first()).toBeVisible();
    await mkdir('work/screenshots', { recursive: true });
    await page.screenshot({ path: 'work/screenshots/overview-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'work/screenshots/overview-mobile.png', fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
    if(local){
      await page.setViewportSize({width:1440,height:1000});
      await page.getByRole('link',{name:'Accounts',exact:true}).click();
      await page.getByLabel('Employee ID',{exact:true}).fill('0009');
      await page.getByLabel('Name',{exact:true}).fill('Local employee');
      await page.getByLabel('Temporary password (4–128 characters)',{exact:true}).fill('1234');
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await expect(page.getByText('Saved. Deliver the temporary password securely to the employee.')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('.login-card')).toBeVisible();
    if(local){
      await page.getByLabel('Employee ID',{exact:true}).fill('0009');
      await page.getByLabel('Password',{exact:true}).fill('1234');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await expect(page.getByText('Change your temporary password before continuing. Sign in again after changing it.')).toBeVisible();
      await page.getByLabel('Current password',{exact:true}).fill('1234');
      await page.getByLabel('New password (4–128 characters)',{exact:true}).fill('5678');
      await page.getByLabel('Repeat new password',{exact:true}).fill('5678');
      await page.getByRole('button',{name:'Change password',exact:true}).click();
      await expect(page.locator('.login-card')).toBeVisible();
      await page.getByLabel('Employee ID',{exact:true}).fill('0009');
      await page.getByLabel('Password',{exact:true}).fill('5678');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await expect(page.getByRole('heading',{name:'My assigned work',exact:true})).toBeVisible();
      await expect(page.getByRole('link',{name:'Accounts',exact:true})).toHaveCount(0);
      console.log('PASS  Local accounts: administrator provisioning, forced password change, employee login and role-specific screen');
    }
    if (roleFixtures) {
      // Each role gets its own real session and read-only journey on the same server.
      for (const [roleName, identity] of Object.entries(roleFixtures.roles)) {
        const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
        if (await signOut.count()) {
          await signOut.click();
          await expect(page.locator('.login-card')).toBeVisible();
        }
        await signInAs({
          email: identity.email,
          employeeId: identity.employeeId,
          password: roleFixtures.password
        });
        if (roleName === 'manager') {
          await managerJourney();
        } else {
          await readOnlyJourney(roleName);
        }
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await expect(page.locator('.login-card')).toBeVisible();
      }
    }
    expect(errors).toEqual([]);
    console.log('PASS  Chromium: Japanese login, language switch, project create/edit, task create, list refresh, responsive layout, sign-out');
  } catch (error) {
    await mkdir('work/screenshots', { recursive: true });
    await page.screenshot({ path: 'work/screenshots/browser-failure.png', fullPage: true });
    throw error;
  } finally { await browser.close(); }
}
