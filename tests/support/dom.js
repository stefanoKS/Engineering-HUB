'use strict';

/**
 * Minimal DOM used to execute the sidebar templates' client scripts.
 *
 * It intentionally throws if any code assigns innerHTML/outerHTML or calls insertAdjacentHTML,
 * so a test cannot accidentally "pass" while building markup from spreadsheet text.
 */
class MockTextNode {
  constructor(value) {
    this.nodeType = 3;
    this.textContent = String(value);
    this.parentNode = null;
  }
}

class MockElement {
  constructor(tagName) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.attributes = {};
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(node) {
    if (!node) throw new Error('appendChild requires a node');
    node.parentNode = this;
    this.childNodes.push(node);
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
    if (value !== '' && value !== null && value !== undefined) this.appendChild(new MockTextNode(value));
  }
  get textContent() {
    return this.childNodes.map(node => node.textContent).join('');
  }
  set innerHTML(value) { throw new Error('innerHTML is prohibited: operational text must use textContent'); }
  get innerHTML() { throw new Error('innerHTML is prohibited'); }
  set outerHTML(value) { throw new Error('outerHTML is prohibited'); }
  get outerHTML() { throw new Error('outerHTML is prohibited'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML is prohibited'); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener() { return this; }
  getElementsByTagName() { return []; }
  descend() {
    return this.childNodes.flatMap(node => (node.nodeType === 1 ? [node, ...node.descend()] : []));
  }
}

function createDocument() {
  const elements = new Map();
  const document = {
    createElement: tagName => new MockElement(tagName),
    createTextNode: value => new MockTextNode(value),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new MockElement('div'));
      return elements.get(id);
    },
    querySelectorAll: () => [],
    write() { throw new Error('document.write is prohibited'); }
  };
  return { document, elements };
}

module.exports = { createDocument, MockElement, MockTextNode };
