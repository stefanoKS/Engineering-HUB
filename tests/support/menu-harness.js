'use strict';

/**
 * Runs a bound sidebar template's client script against the real manager modules.
 *
 * The template markup is not parsed; the mock document creates elements on demand, which
 * is enough to verify wiring: which ids exist, what the client sends to the server, what
 * it shows after a success or a failure, and that spreadsheet text is only ever written
 * through textContent.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDocument } = require('./dom');

const ROOT = path.resolve(__dirname, '../..');
const PARTIALS = ['I18n', 'UiSafe', 'UiLang'];

function template(name) {
  return fs.readFileSync(path.join(ROOT, 'src', name + '.html'), 'utf8');
}

function scriptOf(html) {
  return Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(match => match[1]).join('\n;\n');
}

/**
 * Seeds the mock document with the form defaults declared in the markup (selected option,
 * input value, checked state, textarea text). The mock document does not parse HTML, and a
 * test that asserts a safe default must read the value the browser would show.
 */
function seedMarkup(html, document) {
  const element = id => document.getElementById(id);
  Array.from(html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)).forEach(match => {
    const select = element(match[1]);
    Array.from(match[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)).forEach(option => {
      const node = document.createElement('option');
      const value = /value="([^"]*)"/.exec(option[1]);
      node.value = value ? value[1] : option[2].trim();
      node.textContent = option[2].trim();
      select.appendChild(node);
      if (/\bselected\b/.test(option[1]) || select.value === '') select.value = node.value;
    });
  });
  Array.from(html.matchAll(/<input\b([^>]*)>/g)).forEach(match => {
    const id = /id="([^"]+)"/.exec(match[1]);
    if (!id) return;
    const input = element(id[1]);
    const value = /value="([^"]*)"/.exec(match[1]);
    if (value) input.value = value[1];
    input.type = (/type="([^"]+)"/.exec(match[1]) || [, 'text'])[1];
    if (/\bchecked\b/.test(match[1])) input.checked = true;
  });
  Array.from(html.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)).forEach(match => {
    element(match[1]).value = match[2].trim();
  });
}

function createMenu(app, options = {}) {
  const { document, elements } = createDocument();
  const calls = [];
  const confirmations = [];
  let answers = (options.confirmAnswers || []).slice();
  let pending = null;
  let success = null;
  let failure = null;

  function complete(entry) {
    let outcome;
    try {
      const fn = app.context[entry.fn];
      if (typeof fn !== 'function') throw new Error('unknown server function: ' + entry.fn);
      outcome = fn(entry.payload);
    } catch (error) {
      if (failure) failure({ message: error.message });
      return;
    }
    if (success) success(outcome);
  }

  const api = {
    withSuccessHandler(handler) { success = handler; return proxy; },
    withFailureHandler(handler) { failure = handler; return proxy; }
  };

  const proxy = new Proxy(api, {
    get(target, property) {
      if (typeof property === 'symbol' || property in target) return target[property];
      return function invoke(payload) {
        const entry = { fn: String(property), payload };
        calls.push(entry);
        if (!options.defer) complete(entry);
        else pending.push(entry);
      };
    }
  });
  const runner = proxy;
  pending = [];

  const sandbox = {
    console,
    document,
    google: { script: { run: runner } },
    window: {
      setTimeout(handler) { if (options.defer) return 0; handler(); return 0; },
      clearTimeout() {},
      confirm(message) {
        confirmations.push(message);
        if (!answers.length) return options.confirm !== false;
        return answers.shift();
      }
    },
    setTimeout(handler) { if (options.defer) return 0; handler(); return 0; },
    clearTimeout() {}
  };
  const context = vm.createContext(sandbox);

  PARTIALS.forEach(name => vm.runInContext(scriptOf(template(name)), context, { filename: name + '.html' }));
  const html = template(options.template || 'UiMenu');
  seedMarkup(html, document);
  vm.runInContext(scriptOf(html), context, { filename: (options.template || 'UiMenu') + '.html' });

  const harness = {
    context: sandbox,
    calls,
    confirmations,
    element(id) { return elements.get(id); },
    value(id) { return elements.get(id) ? elements.get(id).value : undefined; },
    set(id, value) { document.getElementById(id).value = value; return harness; },
    setChecked(id, value) { document.getElementById(id).checked = value; return harness; },
    status() { return document.getElementById('status'); },
    texts(id) {
      const node = document.getElementById(id);
      return node ? node.textContent : '';
    },
    options(id) {
      const node = document.getElementById(id);
      return (node ? node.childNodes : []).filter(child => child.nodeType === 1)
        .map(child => ({ value: child.value, label: child.textContent }));
    },
    /** Runs the next deferred server call, as google.script.run would when it answers. */
    flush() {
      const next = pending.shift();
      if (next) complete(next);
      return next;
    },
    answered() { return pending.length; }
  };
  return harness;
}

module.exports = { createMenu, template, scriptOf };
