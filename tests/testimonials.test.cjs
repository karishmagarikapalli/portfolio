const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { approve } = require('../scripts/approve-testimonials.cjs');
const entry = { id: 'one', name: 'Alex', role: 'Colleague', quote: 'Thoughtful work.', publicationConsent: true, email: 'private@example.test' };
const portfolio = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(portfolio, 'assets/js/testimonials.js'), 'utf8');

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  set innerHTML(value) {
    throw new Error(`Renderer must not interpret HTML: ${value}`);
  }
}

function render(approved, wrapper = new Element('div')) {
  const original = new Element('div');
  if (wrapper) wrapper.append(original);
  const document = {
    querySelector(selector) {
      assert.equal(selector, '.testimonials-slider .swiper-wrapper');
      return wrapper;
    },
    createElement(tagName) {
      return new Element(tagName);
    },
  };
  vm.runInNewContext(renderer, { document, window: { APPROVED_TESTIMONIALS: approved } });
  return { wrapper, original };
}

function publisherFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-testimonials-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'assets/js'), { recursive: true });
  const script = path.join(root, 'scripts/approve-testimonials.cjs');
  fs.copyFileSync(path.join(portfolio, 'scripts/approve-testimonials.cjs'), script);
  const input = path.join(root, 'submissions.json');
  const output = path.join(root, 'assets/js/approved-testimonials.js');
  return {
    output,
    publish(candidates, ids) {
      fs.writeFileSync(input, `\uFEFF${JSON.stringify(candidates)}`);
      return spawnSync(process.execPath, [script, input, ...ids], { cwd: root, encoding: 'utf8' });
    },
    read() {
      const sandbox = { window: {} };
      vm.runInNewContext(fs.readFileSync(output, 'utf8'), sandbox);
      return JSON.parse(JSON.stringify(sandbox.window.APPROVED_TESTIMONIALS));
    },
  };
}

test('exports only selected public fields', () => {
  assert.deepEqual(approve([entry, { ...entry, id: 'two' }], ['one']), [
    { id: 'one', name: 'Alex', role: 'Colleague', quote: 'Thoughtful work.' },
  ]);
});

test('requires consent and explicit unambiguous approval', () => {
  assert.throws(() => approve([entry], []));
  assert.throws(() => approve([{ ...entry, publicationConsent: false }], ['one']));
  assert.throws(() => approve([{ ...entry, publicationConsent: 'Yes' }], ['one']));
  assert.throws(() => approve([entry], ['unknown']));
  assert.throws(() => approve([entry, entry], ['one']));
  assert.throws(() => approve([entry], ['one', 'one']));
});

test('rejects malformed or oversized public content', () => {
  assert.throws(() => approve([{ ...entry, quote: ' ' }], ['one']));
  assert.throws(() => approve([{ ...entry, quote: 'a'.repeat(3001) }], ['one']));
  assert.throws(() => approve([{ ...entry, name: {} }], ['one']));
});

test('renderer appends public content as literal text and preserves original slides', () => {
  const hostile = '<img src=x onerror="alert(1)"> & </script>';
  const { wrapper, original } = render([{ ...entry, name: hostile, role: hostile, quote: hostile }]);
  assert.equal(wrapper.children.length, 2);
  assert.equal(wrapper.children[0], original);
  const slide = wrapper.children[1];
  assert.equal(slide.className, 'swiper-slide');
  const item = slide.children[0];
  assert.equal(item.className, 'testimonial-item');
  assert.deepEqual(item.children.map(child => child.tagName), ['p', 'h3', 'h4']);
  for (const child of item.children) {
    assert.equal(child.textContent, hostile);
    assert.equal(child.children.length, 0);
  }
  assert.equal(item.children.length, 3);
});

test('renderer handles absent containers, absent data, malformed entries and optional roles', () => {
  assert.doesNotThrow(() => render([entry], null));
  for (const data of [undefined, null, {}, 'invalid', []]) {
    assert.equal(render(data).wrapper.children.length, 1);
  }
  const { wrapper } = render([null, {}, { name: 1, quote: 'text' }, { name: 'Name', quote: {} },
    { name: 'Name', quote: 'Quote' }, { name: 'Other', quote: 'Text', role: 42 }]);
  assert.equal(wrapper.children.length, 3);
  for (const slide of wrapper.children.slice(1)) {
    assert.equal(slide.children[0].children[2].textContent, '');
  }
});

test('publisher CLI escapes script-sensitive text and excludes all private and unselected data', context => {
  const fixture = publisherFixture(context);
  const hostile = '</script><script>throw "injected"</script> & "quoted" \\ \u2028 \u2029 end';
  const selected = { ...entry, name: `  ${hostile}  `, quote: hostile, role: '  Collaborator  ',
    timestamp: 'PRIVATE_TIMESTAMP', notes: 'PRIVATE_NOTES', attachment: { token: 'PRIVATE_TOKEN' } };
  const result = fixture.publish([selected, { ...entry, id: 'two', quote: 'UNSELECTED_QUOTE' }], ['one']);
  assert.equal(result.status, 0, result.stderr);
  const source = fs.readFileSync(fixture.output, 'utf8');
  assert.ok(!source.includes('<'));
  assert.ok(!source.includes('\u2028'));
  assert.ok(!source.includes('\u2029'));
  assert.ok(source.includes('\\u003c'));
  assert.ok(source.includes('\\u2028'));
  assert.ok(source.includes('\\u2029'));
  for (const privateValue of ['email', entry.email, 'publicationConsent', 'timestamp', 'PRIVATE_TIMESTAMP',
    'notes', 'PRIVATE_NOTES', 'attachment', 'PRIVATE_TOKEN', 'UNSELECTED_QUOTE']) {
    assert.ok(!source.includes(privateValue), privateValue);
  }
  const publicEntries = fixture.read();
  assert.deepEqual(publicEntries, [{ id: 'one', name: hostile, role: 'Collaborator', quote: hostile }]);
  assert.equal(render(publicEntries).wrapper.children[1].children[0].children[0].textContent, hostile);
});

test('publisher CLI rejection leaves the previous output byte-for-byte unchanged', context => {
  const fixture = publisherFixture(context);
  assert.equal(fixture.publish([entry], ['one']).status, 0);
  const before = fs.readFileSync(fixture.output);
  for (const consent of [false, 'Yes', undefined]) {
    const result = fixture.publish([entry, { ...entry, id: 'two', publicationConsent: consent }], ['one', 'two']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Publication consent missing: two/);
    assert.deepEqual(fs.readFileSync(fixture.output), before);
  }
  for (const [candidates, ids] of [[[entry], []], [[entry], ['unknown']], [[entry, entry], ['one']],
    [[entry], ['one', 'one']], [[{ ...entry, quote: ' ' }], ['one']]]) {
    assert.equal(fixture.publish(candidates, ids).status, 1);
    assert.deepEqual(fs.readFileSync(fixture.output), before);
  }
});

test('publisher CLI replaces the complete list, removes omitted IDs and updates retained entries', context => {
  const fixture = publisherFixture(context);
  const second = { ...entry, id: 'two', name: 'Second Example' };
  assert.equal(fixture.publish([entry, second], ['two', 'one']).status, 0);
  assert.deepEqual(fixture.read().map(value => value.id), ['two', 'one']);
  const replacement = { ...second, quote: 'Replacement text.' };
  assert.equal(fixture.publish([entry, replacement], ['two']).status, 0);
  assert.deepEqual(fixture.read(), [{ id: 'two', name: 'Second Example', role: 'Colleague', quote: 'Replacement text.' }]);
  assert.equal(render(fixture.read()).wrapper.children.length, 2);
});

test('the actual public approved list remains empty', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(portfolio, 'assets/js/approved-testimonials.js'), 'utf8'), sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.APPROVED_TESTIMONIALS)), []);
});