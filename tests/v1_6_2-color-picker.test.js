'use strict';
/**
 * V1.6.2 responsibility colour picker.
 *
 * Choosing a responsibility colour must be a visual act: twelve muted presets as swatches, the
 * browser's native colour input for a custom value and an optional HEX field for advanced use.
 * The stored value stays `Color_Hex`, the server validates it again, an edit stays a partial
 * patch and an existing colour is never rewritten by merely opening the form.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixtures = require('./fixtures');
const {harness, flush} = require('./support/manager-web-harness');

const MANAGER_WEB = {MANAGER_WEB_ALLOWED_DOMAINS: 'example.test'};
const CLIENT = fs.readFileSync(path.join(__dirname, '..', 'src', 'ManagerWebClient.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function managerApp(actor = 'admin@example.test') {
  return fixtures.base({actor, properties: MANAGER_WEB});
}

function clientOf(app) {
  return harness((write, op, payload) => write
    ? app.context.managerWebWrite(op, payload)
    : app.context.managerWebRead(op, payload));
}

function swatches(h) {
  return h.nodes('formHost').filter(node => String(node.className).split(' ')[0] === 'color-swatch');
}

function pressed(h) {
  return swatches(h).filter(node => node.getAttribute('aria-pressed') === 'true')
    .map(node => node.getAttribute('data-color'));
}

function nodeOfClass(h, className) {
  return h.nodes('formHost').filter(node => node.className === className)[0];
}

async function openNewResponsibility(h) {
  await flush();
  h.click('nav', '管理');
  h.click('content', '担当領域');
  await flush();
  h.click('content', '新規作成');
  await flush();
}

async function openEditResponsibility(h) {
  await flush();
  h.click('nav', '管理');
  h.click('content', '担当領域');
  await flush();
  h.click('content', '編集');
  await flush();
}

function saves(h) {
  return h.calls.filter(call => call.write && call.operation === 'responsibilitySave');
}

test('the twelve presets are muted, unique and identical on both sides', () => {
  const app = managerApp();
  const palette = plain(app.context.Responsibilities.PALETTE).map(color => color.toUpperCase());
  assert.equal(palette.length, 12, 'exactly twelve predefined colours');
  assert.equal(new Set(palette).size, 12, 'no duplicated preset');
  palette.forEach(color => assert.match(color, /^#[0-9A-F]{6}$/));

  // The browser renders the same list, so a swatch and the server default can never disagree.
  const declared = /var COLOR_PRESETS = \[([\s\S]*?)\];/.exec(CLIENT);
  assert.ok(declared, 'the client declares its offline preset list');
  const clientPresets = declared[1].match(/#[0-9A-Fa-f]{6}/g).map(color => color.toUpperCase());
  assert.deepEqual(clientPresets, palette);
});

test('a new responsibility preselects a deterministic default that is not the HEX field', async () => {
  const app = managerApp();
  const h = clientOf(app);
  await openNewResponsibility(h);

  const preset = app.context.Responsibilities.PALETTE[0];
  assert.equal(swatches(h).length, 12, 'every preset is a clickable swatch');
  assert.deepEqual(pressed(h), [preset], 'the first unused preset is selected by default');
  // The same default the server would assign, so the preview never promises another colour.
  assert.equal(app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR'}).Color_Hex, preset);

  const preview = nodeOfClass(h, 'color-preview');
  assert.match(preview.getAttribute('style'), new RegExp('border-left-color:' + preset));
  assert.match(preview.textContent, new RegExp(preset));

  // The HEX input is an advanced control inside a collapsed details element, not the default UI.
  const hex = h.nodes('formHost').find(node => node.name === 'colorHex');
  let ancestor = hex.parentNode, insideAdvanced = false;
  while (ancestor) { if (ancestor.tagName === 'DETAILS') insideAdvanced = true; ancestor = ancestor.parentNode; }
  assert.equal(insideAdvanced, true, 'the HEX field lives in the advanced section');
  assert.ok(!hex.required, 'the HEX field is never required');
});

test('selecting a preset swatch stores that colour on the responsibility', async () => {
  const app = managerApp();
  const h = clientOf(app);
  await openNewResponsibility(h);
  const chosen = app.context.Responsibilities.PALETTE[2];

  h.fill('name', '工程設計');
  swatches(h).filter(node => node.getAttribute('data-color') === chosen)[0].dispatchEvent('click', {});
  assert.deepEqual(pressed(h), [chosen], 'exactly one swatch stays selected');
  assert.match(nodeOfClass(h, 'color-preview').getAttribute('style'), new RegExp(chosen));

  h.submit();
  await flush();
  assert.equal(saves(h).length, 1);
  assert.equal(saves(h)[0].payload.color, chosen);
  const stored = app.context.Database.read('RESPONSIBILITIES').filter(row => row.Name === '工程設計')[0];
  assert.ok(stored, 'the responsibility was created');
  assert.equal(stored.Color_Hex, chosen, 'Color_Hex remains the stored value');
});

test('the custom colour control stores any valid colour and clears the preset selection', async () => {
  const app = managerApp();
  const h = clientOf(app);
  await openNewResponsibility(h);

  const custom = h.nodes('formHost').find(node => node.name === 'color');
  assert.equal(custom.type, 'color', 'the custom control is the native colour input');
  h.fill('name', '自動化・工程設計');
  h.fill('color', '#123abc');
  assert.deepEqual(pressed(h), [], 'a custom colour matches no preset');
  assert.match(nodeOfClass(h, 'color-preview').getAttribute('style'), /#123ABC/);

  h.submit();
  await flush();
  const stored = app.context.Database.read('RESPONSIBILITIES').filter(row => row.Name === '自動化・工程設計')[0];
  assert.equal(stored.Color_Hex, '#123ABC', 'the server normalizes and stores the chosen colour');
});

test('editing an existing responsibility shows and changes only the colour it is given', async () => {
  const app = managerApp();
  app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#6A65A8'});
  const area = app.context.Database.read('RESPONSIBILITIES')[0];
  const h = clientOf(app);
  await openEditResponsibility(h);

  assert.deepEqual(pressed(h), ['#6A65A8'], 'the stored colour is the selected swatch');
  const chosen = app.context.Responsibilities.PALETTE[4];
  swatches(h).filter(node => node.getAttribute('data-color') === chosen)[0].dispatchEvent('click', {});
  h.fill('name', '製品設計（改名）');
  h.submit();
  await flush();

  const stored = app.context.Database.find('RESPONSIBILITIES', area.Responsibility_ID);
  assert.equal(stored.Color_Hex, chosen);
  assert.equal(stored.Name, '製品設計（改名）');
  assert.equal(stored.Owner_Member_ID, 'M-MGR', 'an untouched field keeps its stored value');
  assert.equal(stored.Status, 'Active');
  assert.equal(stored.Sort_Order, area.Sort_Order);
});

test('an invalid colour is refused in the form and again on the server', async () => {
  const app = managerApp();
  const created = plain(app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#357C9B'}));
  const h = clientOf(app);
  await openEditResponsibility(h);

  h.fill('colorHex', '#12345');
  assert.equal(h.nodes('formHost').find(node => node.name === 'colorHex').getAttribute('aria-invalid'), 'true');
  assert.match(nodeOfClass(h, 'color-error').textContent, /#RRGGBB/);
  assert.deepEqual(pressed(h), ['#357C9B'], 'an invalid value never replaces the selection');
  assert.match(nodeOfClass(h, 'color-preview').getAttribute('style'), /#357C9B/);

  h.fill('colorHex', '#0f0f0f');
  assert.equal(nodeOfClass(h, 'color-error').textContent, '');
  assert.deepEqual(pressed(h), [], 'a valid custom HEX value is applied');

  // The browser is not trusted: the domain service keeps validating the stored value.
  const refused = app.context.Ui.saveResponsibility({responsibilityId: created.Responsibility_ID, color: 'red'});
  assert.equal(refused.ok, false);
  assert.match(refused.error, /#RRGGBB/);
  const revision = app.context.managerWebRead('responsibilities').data.items[0]._revision;
  const web = app.context.managerWebWrite('responsibilitySave', {
    responsibilityId: created.Responsibility_ID, color: 'blue', revision: revision
  });
  assert.equal(web.ok, false, 'the manager web endpoint refuses an invalid colour too');
  assert.equal(app.context.Database.find('RESPONSIBILITIES', created.Responsibility_ID).Color_Hex, '#357C9B');
});

test('closing the form writes nothing and discarding restores the stored colour', async () => {
  const app = managerApp();
  app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#357C9B'});
  const area = app.context.Database.read('RESPONSIBILITIES')[0];
  const h = clientOf(app);
  await openEditResponsibility(h);

  swatches(h).filter(node => node.getAttribute('data-color') === '#A74646')[0].dispatchEvent('click', {});
  h.click('formHost', '閉じる（下書きを保持）');
  await flush();
  assert.equal(saves(h).length, 0, 'closing the form never saves');
  assert.equal(app.context.Database.find('RESPONSIBILITIES', area.Responsibility_ID).Color_Hex, '#357C9B');
  assert.deepEqual(pressed(h), ['#A74646'], 'the unsaved draft stays exactly as it was');

  h.click('formHost', '下書きを破棄');
  await flush();
  h.click('content', '編集');
  await flush();
  assert.deepEqual(pressed(h), ['#357C9B'], 'after discarding, the stored colour is shown again');
  assert.equal(app.context.Database.find('RESPONSIBILITIES', area.Responsibility_ID).Color_Hex, '#357C9B');
});

test('existing colours survive an unrelated edit, including a legacy blank value', async () => {
  const app = managerApp();
  app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#328568'});
  const second = plain(app.context.Responsibilities.create({Name: '工程設計', Owner_Member_ID: 'M-MGR'}));
  app.context.Database.update('RESPONSIBILITIES', second.Responsibility_ID, {Color_Hex: ''});
  const h = clientOf(app);

  await openEditResponsibility(h);
  const first = app.context.Database.read('RESPONSIBILITIES').filter(row => row.Name === '製品設計')[0];
  h.fill('name', '製品設計（改名）');
  h.submit();
  await flush();

  assert.equal(saves(h).length, 1);
  assert.equal(saves(h)[0].payload.color, undefined, 'an untouched colour is not part of the patch');
  assert.equal(app.context.Database.find('RESPONSIBILITIES', first.Responsibility_ID).Color_Hex, '#328568');
  assert.equal(app.context.Database.find('RESPONSIBILITIES', second.Responsibility_ID).Color_Hex, '');
});

test('the picker is keyboard operable and exposes its selection state', async () => {
  const app = managerApp();
  const h = clientOf(app);
  await openNewResponsibility(h);
  const palette = app.context.Responsibilities.PALETTE;

  const group = h.nodes('formHost').filter(node => node.getAttribute('role') === 'group')[0];
  assert.ok(group, 'the swatches form one labelled group');
  assert.equal(group.getAttribute('aria-label'), '色を選択');

  swatches(h).forEach(node => {
    assert.equal(node.tagName, 'BUTTON', 'each swatch is a real button');
    assert.equal(node.type, 'button');
    assert.match(node.getAttribute('aria-label'), /^#[0-9A-F]{6}$/);
    assert.ok(node.getAttribute('style').indexOf('background-color:') >= 0);
    const check = node.childNodes.find(child => child.className === 'color-check');
    assert.ok(check, 'a selected swatch is also marked with a check mark');
    assert.equal(check.getAttribute('aria-hidden'), 'true');
  });

  const first = swatches(h)[0];
  first.dispatchEvent('keydown', {key: 'ArrowRight', preventDefault() {}});
  assert.deepEqual(pressed(h), [palette[1]], 'arrow keys move the selection');
  swatches(h)[1].dispatchEvent('keydown', {key: 'End', preventDefault() {}});
  assert.deepEqual(pressed(h), [palette[palette.length - 1]]);
  swatches(h)[palette.length - 1].dispatchEvent('keydown', {key: 'Home', preventDefault() {}});
  assert.deepEqual(pressed(h), [palette[0]]);
  swatches(h)[0].dispatchEvent('keydown', {key: 'ArrowLeft', preventDefault() {}});
  assert.deepEqual(pressed(h), [palette[palette.length - 1]], 'the selection wraps around');
  swatches(h)[palette.length - 1].dispatchEvent('keydown', {key: 'Tab', preventDefault() {}});
  assert.deepEqual(pressed(h), [palette[palette.length - 1]], 'other keys keep the current selection');
});

test('the selected colour is reused by cards, filters and project indicators', async () => {
  const app = managerApp();
  const area = plain(app.context.Responsibilities.create({Name: '製品設計', Owner_Member_ID: 'M-MGR', Color_Hex: '#8A5A7A'}));
  app.context.Projects.update('P1', {Responsibility_ID: area.Responsibility_ID});
  const h = clientOf(app);
  await flush();

  // The area card that filters the dashboard carries the stored colour.
  const cards = h.nodes('content').filter(node => node.className.indexOf('area-card') === 0);
  assert.ok(cards.some(node => /border-left-color:#8A5A7A/.test(node.getAttribute('style') || '')),
    'the filter card uses the responsibility colour');

  const list = app.context.managerWebRead('responsibilities').data.items;
  assert.equal(list[0]._color, '#8A5A7A', 'the list reuses the same display colour');

  const project = app.context.managerWebRead('projects', {}).data.items.filter(row => row.id === 'P1')[0];
  assert.equal(project.responsibilityColor, '#8A5A7A', 'the project indicator publishes the colour');

  h.click('nav', '案件');
  await flush();
  const projectCards = h.nodes('content').filter(node => node.className === 'card');
  assert.ok(projectCards.some(node => node.descendants().some(child =>
    String(child.className).indexOf('color-dot') >= 0 && /#8A5A7A/.test(child.getAttribute('style') || ''))),
  'the project card shows a matching colour dot');
});
