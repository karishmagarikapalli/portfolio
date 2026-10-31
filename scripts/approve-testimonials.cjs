const fs = require('node:fs');
const path = require('node:path');

function approve(candidates, ids) {
  if (!Array.isArray(candidates) || !ids.length || new Set(ids).size !== ids.length) {
    throw new Error('Provide submissions and unique explicit approval IDs.');
  }
  return ids.map(id => {
    const matches = candidates.filter(entry => entry && entry.id === id);
    if (matches.length !== 1) throw new Error(`Missing or duplicate submission ID: ${id}`);
    const entry = matches[0];
    if (entry.publicationConsent !== true) throw new Error(`Publication consent missing: ${id}`);
    const result = {};
    for (const [field, limit] of Object.entries({ id: 100, name: 120, role: 200, quote: 3000 })) {
      const value = entry[field] ?? (field === 'role' ? '' : null);
      if (typeof value !== 'string' || value.trim().length > limit || (field !== 'role' && !value.trim())) {
        throw new Error(`Invalid ${field}: ${id}`);
      }
      result[field] = value.trim();
    }
    return result;
  });
}

if (require.main === module) {
  try {
    const [input, ...ids] = process.argv.slice(2);
    if (!input) throw new Error('Usage: node scripts/approve-testimonials.cjs private/submissions.json ID [ID ...]');
    const candidates = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    const approved = approve(candidates, ids);
    const output = path.join(__dirname, '..', 'assets', 'js', 'approved-testimonials.js');
    const json = JSON.stringify(approved, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    fs.writeFileSync(output, `window.APPROVED_TESTIMONIALS = ${json};\n`, 'utf8');
    console.log(`Exported ${approved.length} approved testimonials. Review the public diff before deploying.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { approve };