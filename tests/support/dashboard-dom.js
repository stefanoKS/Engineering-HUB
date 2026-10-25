'use strict';

/**
 * Minimal DOM used to execute the shared dashboard client script in Node.
 *
 * It implements only what the dashboard needs and, like tests/support/dom.js, it throws if
 * any code assigns markup strings, so a test cannot pass while building HTML from data.
 */
class ShimNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.id = '';
    this.listeners = Object.create(null);
    this.text = null;
  }

  get firstChild() { return this.childNodes[0] || null; }

  appendChild(node) {
    if (!node) throw new Error('appendChild requires a node');
    node.parentNode = this;
    this.childNodes.push(node);
    if (this.text !== null) this.text = null;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild on unknown node');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  set textContent(value) {
    this.childNodes = [];
    this.text = value === null || value === undefined ? '' : String(value);
  }

  get textContent() {
    if (this.text !== null) return this.text;
    return this.childNodes.map(node => node.textContent).join('');
  }

  set innerHTML(value) { throw new Error('innerHTML is prohibited: dashboard text must use textContent'); }
  get innerHTML() { throw new Error('innerHTML is prohibited'); }
  set outerHTML(value) { throw new Error('outerHTML is prohibited'); }
  get outerHTML() { throw new Error('outerHTML is prohibited'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML is prohibited'); }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
  }

  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }

  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }

  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type, handler) {
    const list = this.listeners[type] || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }

  dispatchEvent(type, event) {
    (this.listeners[type] || []).forEach(handler => handler(event));
  }

  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }

  closest(selector) {
    const attribute = /^\[([^\]]+)\]$/.exec(selector);
    let node = this;
    while (node) {
      if (attribute) {
        if (node.hasAttribute(attribute[1])) return node;
      } else if (node.tagName === selector.toUpperCase() || `.${node.className}` === selector) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  querySelectorAll() { return []; }

  descendants() {
    return this.childNodes.reduce((all, node) => all.concat([node], node.descendants()), []);
  }

  find(predicate) {
    return this.descendants().find(predicate) || null;
  }
}

function createDashboardDocument() {
  const registry = new Map();
  const documentListeners = Object.create(null);
  const document = {
    activeElement: null,
    createElement: tagName => {
      const node = new ShimNode(tagName);
      node.ownerDocument = document;
      return node;
    },
    getElementById(id) {
      if (!registry.has(id)) {
        const node = new ShimNode('div');
        node.id = id;
        node.ownerDocument = document;
        registry.set(id, node);
      }
      return registry.get(id);
    },
    querySelectorAll: () => [],
    addEventListener(type, handler) { (documentListeners[type] = documentListeners[type] || []).push(handler); },
    removeEventListener(type, handler) {
      const list = documentListeners[type] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatchEvent(type, event) { (documentListeners[type] || []).forEach(handler => handler(event)); },
    contains(node) { return !!node; },
    listeners: documentListeners
  };
  return { document, registry };
}

module.exports = { ShimNode, createDashboardDocument };
