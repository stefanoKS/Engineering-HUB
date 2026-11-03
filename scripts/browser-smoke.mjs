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
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(0);

    // Read-only project detail is reachable from the task's project link.
    await page.locator('a[href^="#/project/"]').first().click();
    await expect(page.getByRole('heading', { name: 'Browser edited project', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New subproject', exact: true })).toHaveCount(0);

    // The personal list stays available to every role.
    await page.locator('.app-nav').getByRole('link', { name: 'My assigned work', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My assigned work', exact: true })).toBeVisible();
    if (roleName !== 'member') {
      // A VIEWER may never file work or request completion.
      await expect(page.getByRole('button', { name: 'Create task', exact: true })).toHaveCount(0);
    }
    // No manager-only navigation is offered.
    await expect(page.locator('.app-nav').getByRole('link', { name: 'Automation', exact: true })).toHaveCount(0);
    await expect(page.locator('.app-nav').getByRole('link', { name: 'Accounts', exact: true })).toHaveCount(0);
    console.log(`PASS  ${roleName} journey: read-only All Work, task detail, project detail, personal list`);
  }

  try {
    await signInAs(local ? { employeeId: local.employeeId, password: local.password, email } : { email });
    await page.locator('.app-nav').getByRole('link', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Project name', { exact: true }).fill('Browser verified project');
    await dialog.getByLabel(/^Responsibility/).selectOption('RSP-SMOKE');
    // Employee-visible so the MEMBER and VIEWER journeys can read this work.
    await dialog.getByLabel(/Shared dashboard visibility/).selectOption('INTERNAL');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Browser verified project', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New subproject', exact: true }).click();
    await dialog.getByLabel('Subproject name', { exact: true }).fill('Browser verified subproject');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Browser verified subproject', exact: true })).toBeVisible();
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
        await readOnlyJourney(roleName);
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
