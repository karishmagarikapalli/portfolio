const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { parse } = require('parse5');
const postcss = require('postcss');
const parseValue = require('postcss-value-parser');

function checkStatic(root = path.resolve(__dirname, '..')) {
  root = path.resolve(root);
  const errors = [];
  const checked = new Set();
  const forms = [];
  const emails = [];
  const documents = new Map();
  const fail = (file, message) => errors.push(`${path.relative(root, file)}: ${message}`);

  function loadHtml(file) {
    if (documents.has(file)) return documents.get(file);
    const nodes = [];
    const ids = new Map();
    function visit(node) {
      if (node.tagName) {
        node.attributes = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]));
        nodes.push(node);
        if (node.attributes.id) {
          if (ids.has(node.attributes.id)) fail(file, `duplicate id: ${node.attributes.id}`);
          ids.set(node.attributes.id, node);
        }
      }
      for (const child of node.childNodes || []) visit(child);
    }
    visit(parse(fs.readFileSync(file, 'utf8')));
    const result = { nodes, ids };
    documents.set(file, result);
    return result;
  }

  function visibleText(node) {
    if (node.nodeName === '#text') return node.value;
    const attributes = node.attributes || {};
    if (attributes['aria-hidden'] === 'true' || 'hidden' in attributes || ['script', 'style'].includes(node.tagName)) return '';
    if (node.tagName === 'img') return attributes.alt || '';
    return (node.childNodes || []).map(visibleText).join(' ');
  }

  function actionName(node, ids) {
    const attributes = node.attributes;
    if (attributes['aria-labelledby']) {
      return attributes['aria-labelledby'].split(/\s+/).map(id => {
        const target = ids.get(id);
        return target ? visibleText(target) : '';
      }).join(' ').trim();
    }
    return (attributes['aria-label'] || visibleText(node)).trim();
  }

  function exactFile(file) {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    let directory = root;
    for (const segment of relative.split(path.sep)) {
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory() || !fs.readdirSync(directory).includes(segment)) return false;
      directory = path.join(directory, segment);
    }
    return fs.existsSync(file) && fs.statSync(file).isFile();
  }

  function reference(value, file) {
    if (!value.trim()) {
      fail(file, 'empty asset/link reference');
      return;
    }
    let url;
    try {
      url = new URL(value, pathToFileURL(file));
    } catch {
      fail(file, `invalid URL: ${value}`);
      return;
    }
    if (url.protocol === 'file:') {
      let target;
      try {
        target = fileURLToPath(url);
      } catch {
        fail(file, `invalid local URL: ${value}`);
        return;
      }
      if (!exactFile(target)) {
        fail(file, `missing, outside-root or wrong-case local file: ${value}`);
        return;
      }
      if (url.hash && /\.html?$/i.test(target)) {
        let fragment;
        try {
          fragment = decodeURIComponent(url.hash.slice(1));
        } catch {
          fail(file, `invalid fragment: ${value}`);
          return;
        }
        if (!loadHtml(target).ids.has(fragment)) fail(file, `missing fragment: ${value}`);
      }
      inspect(target);
    } else if (url.protocol === 'mailto:') {
      let address;
      try {
        address = decodeURIComponent(url.pathname);
      } catch {
        fail(file, `invalid mailto: ${value}`);
        return;
      }
      if (!/^[^\s@?,]+@[^\s@?,]+\.[^\s@?,]+$/.test(address)) fail(file, `malformed mailto: ${value}`);
      emails.push(address);
    } else if (['https:', 'http:'].includes(url.protocol)) {
      if (url.hostname === 'forms.gle' || (url.hostname === 'docs.google.com' && url.pathname.startsWith('/forms/'))) {
        forms.push(url.href);
        if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !(url.hostname === 'forms.gle' ? /^\/[A-Za-z0-9_-]+$/.test(url.pathname) :
            /^\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(url.pathname))) {
          fail(file, `not a public HTTPS Google Forms view link: ${value}`);
        }
      }
    } else if (!['data:', 'tel:'].includes(url.protocol)) {
      fail(file, `unsupported or unsafe URL scheme: ${value}`);
    }
  }

  function inspect(file) {
    if (checked.has(file)) return;
    checked.add(file);
    if (/\.html?$/i.test(file)) {
      const { nodes, ids } = loadHtml(file);
      const html = nodes.find(node => node.tagName === 'html');
      if (!html?.attributes.lang?.trim()) fail(file, 'missing document language');
      if (!nodes.some(node => node.tagName === 'title' && visibleText(node).trim())) fail(file, 'missing document title');
      if (!nodes.some(node => node.tagName === 'h1' && visibleText(node).trim())) fail(file, 'missing named h1');
      for (const node of nodes) {
        const attributes = node.attributes;
        for (const field of ['href', 'src', 'poster']) {
          if (field in attributes) reference(attributes[field], file);
        }
        if (node.tagName === 'img' && !('alt' in attributes)) fail(file, 'image missing alt attribute');
        if (node.tagName === 'button' || (node.tagName === 'a' && 'href' in attributes) ||
          ['button', 'link'].includes(attributes.role) || (attributes.class || '').split(/\s+/).includes('mobile-nav-toggle')) {
          if (!actionName(node, ids)) fail(file, `unnamed action: ${node.tagName}${attributes.class ? `.${attributes.class}` : ''}`);
          if (node.tagName !== 'button' && node.tagName !== 'a' && !('tabindex' in attributes)) fail(file, 'non-native action missing keyboard focus');
        }
        if (attributes.target === '_blank' && !(attributes.rel || '').split(/\s+/).includes('noopener')) fail(file, 'new-tab link missing noopener');
      }
    } else if (/\.css$/i.test(file)) {
      try {
        const css = postcss.parse(fs.readFileSync(file, 'utf8'), { from: file });
        function urls(value) {
          parseValue(value).walk(node => {
            if (node.type === 'function' && node.value.toLowerCase() === 'url') {
              reference(parseValue.stringify(node.nodes).replace(/^(['"])(.*)\1$/, '$2'), file);
              return false;
            }
          });
        }
        css.walkDecls(declaration => urls(declaration.value));
        css.walkAtRules('import', rule => {
          const first = parseValue(rule.params).nodes[0];
          if (first?.type === 'string') reference(first.value, file);
          else urls(rule.params);
        });
      } catch (error) {
        fail(file, `CSS parse/read failure: ${error.message}`);
      }
    }
  }

  const index = path.join(root, 'index.html');
  if (!exactFile(index)) fail(index, 'missing index.html');
  else inspect(index);
  if (!forms.length) fail(index, 'missing Google Forms link');
  if (new Set(forms).size > 1) fail(index, 'Google Forms links disagree');
  if (!emails.length) fail(index, 'missing mailto link');
  if (new Set(emails).size > 1) fail(index, 'mailto addresses disagree');
  return { errors, files: checked.size, forms: forms.length, emails: emails.length };
}

if (require.main === module) {
  try {
    const result = checkStatic();
    for (const error of result.errors) console.error(error);
    console.log(`Offline static check: ${result.files} local files, ${result.forms} Forms links, ${result.emails} mailto links, ${result.errors.length} errors.`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkStatic };