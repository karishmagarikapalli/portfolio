const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkStatic } = require('../scripts/check-static.cjs');

const form = 'https://docs.google.com/forms/d/e/FICTIONAL_ID/viewform?usp=dialog';
const markup = `<!doctype html><html lang="en"><head><title>Fixture</title>
<link rel="stylesheet" href="assets/site.css"></head><body><h1>Fixture</h1>
<a href="details.html?preview=1#detail">Details</a><a href="#contact">Contact</a>
<img src="assets/pixel.png" alt=""><script src="assets/app.js"></script>
<section id="contact"><a href="mailto:fixture@example.test">Email me</a>
<a href="${form}" target="_blank" rel="noopener noreferrer">Submit testimonial</a></section>
<a href="${form}" aria-label="Submit testimonial"><i aria-hidden="true"></i></a>
<button type="button" aria-label="Toggle navigation"></button></body></html>`;

function fixture(context, html = markup, css = '@import "nested/fonts.css"; body { background: url("pixel.png?version=1"); }') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-static-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets/nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), html);
  fs.writeFileSync(path.join(root, 'details.html'), '<html lang="en"><title>Details</title><h1 id="detail">Details</h1><a href="index.html#contact">Back</a></html>');
  fs.writeFileSync(path.join(root, 'assets/site.css'), css);
  fs.writeFileSync(path.join(root, 'assets/nested/fonts.css'), '@font-face { font-family: Fixture; src: url("../font.woff2#font"); }');
  fs.writeFileSync(path.join(root, 'assets/font.woff2'), 'fixture only');
  fs.writeFileSync(path.join(root, 'assets/pixel.png'), 'fixture only');
  fs.writeFileSync(path.join(root, 'assets/app.js'), '');
  return root;
}

test('static check follows HTML, nested CSS, font URLs and cyclic local page links offline', context => {
  const result = checkStatic(fixture(context));
  assert.deepEqual(result.errors, []);
  assert.equal(result.files, 7);
  assert.equal(result.forms, 2);
  assert.equal(result.emails, 1);
});

test('static check rejects missing and wrong-case assets and broken same/cross-page fragments', context => {
  const root = fixture(context, markup.replace('assets/app.js', 'assets/missing.js')
    .replace('assets/pixel.png', 'assets/Pixel.png').replace('#detail', '#missing-detail').replace('href="#contact"', 'href="#missing-contact"'));
  const errors = checkStatic(root).errors.join('\n');
  for (const reference of ['assets/missing.js', 'assets/Pixel.png', '#missing-detail', '#missing-contact']) {
    assert.ok(errors.includes(reference), reference);
  }
});

test('static check catches nested CSS URL and import defects and CSS parse failures', context => {
  const root = fixture(context, markup, '@import url("missing.css"); body { background: url("absent.png"); }');
  let errors = checkStatic(root).errors.join('\n');
  assert.match(errors, /missing.css/);
  assert.match(errors, /absent.png/);
  fs.writeFileSync(path.join(root, 'assets/site.css'), 'body {');
  errors = checkStatic(root).errors.join('\n');
  assert.match(errors, /CSS parse\/read failure/);
});

test('static check rejects unsafe schemes, empty references and outside-root paths', context => {
  const root = fixture(context, markup.replace('assets/app.js', '../outside.js')
    .replace('href="#contact"', 'href="javascript:alert(1)"').replace('src="assets/pixel.png"', 'src=""'));
  const errors = checkStatic(root).errors.join('\n');
  assert.match(errors, /unsupported or unsafe URL scheme/);
  assert.match(errors, /empty asset\/link reference/);
  assert.match(errors, /outside-root/);
});

test('static check validates Forms view-link structure, matching destinations and mailto syntax', context => {
  const root = fixture(context, markup.replace(form, form.replace('/viewform', '/formResponse'))
    .replace('mailto:fixture@example.test', 'mailto:not-an-address'));
  const errors = checkStatic(root).errors.join('\n');
  assert.match(errors, /not a public HTTPS Google Forms view link/);
  assert.match(errors, /Google Forms links disagree/);
  assert.match(errors, /malformed mailto/);
});

test('static check requires form/email links and accepts a consistently used short Forms link', context => {
  const root = fixture(context, markup.replaceAll(form, 'https://forms.gle/FICTIONAL123'));
  assert.deepEqual(checkStatic(root).errors, []);
  fs.writeFileSync(path.join(root, 'index.html'), '<html lang="en"><title>Fixture</title><h1>Fixture</h1></html>');
  const errors = checkStatic(root).errors.join('\n');
  assert.match(errors, /missing Google Forms link/);
  assert.match(errors, /missing mailto link/);
});

test('static check catches basic document, image and action naming/focus issues', context => {
  const broken = markup.replace('lang="en"', '').replace('<title>Fixture</title>', '')
    .replace('<h1>Fixture</h1>', '').replace(' alt=""', '')
    .replace('aria-label="Toggle navigation"', '')
    .replace('aria-label="Submit testimonial"', '')
    .replace('rel="noopener noreferrer"', '')
    .replace('</body>', '<i class="mobile-nav-toggle"></i><p id="contact">Duplicate</p></body>');
  const errors = checkStatic(fixture(context, broken)).errors.join('\n');
  for (const message of ['missing document language', 'missing document title', 'missing named h1',
    'image missing alt attribute', 'unnamed action: button', 'unnamed action: a',
    'non-native action missing keyboard focus', 'new-tab link missing noopener', 'duplicate id: contact']) {
    assert.ok(errors.includes(message), message);
  }
});

test('the actual portfolio passes the offline static check', () => {
  assert.deepEqual(checkStatic().errors, []);
});