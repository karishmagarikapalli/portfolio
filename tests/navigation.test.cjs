const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element(initialClasses = []) {
  const classes = new Set(initialClasses);
  const attributes = {};
  const listeners = {};
  return {
    classList: {
      contains: value => classes.has(value),
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      toggle(value) {
        if (classes.has(value)) classes.delete(value);
        else classes.add(value);
      },
    },
    setAttribute: (name, value) => { attributes[name] = value; },
    getAttribute: name => attributes[name],
    addEventListener: (name, listener) => { listeners[name] = listener; },
    click(event = {}) { listeners.click.call(this, event); },
  };
}

test('mobile menu click handler synchronizes expanded state on toggle and link selection', () => {
  const navbar = element();
  const toggle = element(['bi-list']);
  const header = element();
  const link = element(['active']);
  link.hash = '#header';
  toggle.setAttribute('aria-expanded', 'false');
  const elements = { '#navbar': navbar, '.mobile-nav-toggle': toggle, '#header': header };
  const document = {
    querySelector: selector => elements[selector] || null,
    querySelectorAll: selector => selector === '#navbar .nav-link' ? [link] : [],
  };
  const source = fs.readFileSync(path.join(__dirname, '../assets/js/main.js'), 'utf8');
  vm.runInNewContext(source, {
    document,
    window: { addEventListener() {} },
    Swiper: function() {},
    GLightbox() {},
  });
  toggle.click();
  assert.equal(navbar.classList.contains('navbar-mobile'), true);
  assert.equal(toggle.classList.contains('bi-x'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(navbar.classList.contains('navbar-mobile'), false);
  assert.equal(toggle.classList.contains('bi-list'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  let prevented = false;
  link.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(navbar.classList.contains('navbar-mobile'), false);
  assert.equal(toggle.classList.contains('bi-list'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});