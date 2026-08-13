// tools-servertemplate.js.node — convert a Print*_F template to render
// SERVER-SIDE, so its PDF is not blank.
//
// THE BUG THIS FIXES:
// Utilities.newBlob(html).getAs('application/pdf') converts the RAW HTML and
// NEVER executes JavaScript. Every Print template filled its values with
//     document.getElementById('x').textContent = d.something;
// which runs only in a browser. So the stored PDF carried all the labels and
// none of the data — "GRN NO / जीआरएन क्र." with nothing after it.
//
// This rewrites each empty value element to be filled by a scriptlet, which
// runs BEFORE conversion, and wraps the client writes in setIf() so they can
// still enhance the on-screen view without blanking what the server rendered.
//
// Node-only. Never pushed to GAS (.claspignore excludes *.node).
//   node tools-servertemplate.js.node PrintIQC_F.html [...]

const fs = require('fs');

// getElementById("x") and getElementById('x') both appear across the templates.
const ASSIGN = /document\.getElementById\(["']([A-Za-z0-9_]+)["']\)\.textContent\s*=\s*([^;]+);/g;

const HELPER = `<?
/* SERVER-SIDE RENDERING — why the PDFs were blank.
   Utilities.newBlob(html).getAs('application/pdf') converts the RAW HTML and
   never executes JavaScript. This template filled every value from JS, so the
   PDF carried all the labels and none of the data.
   The scriptlets below run BEFORE conversion. The client JS is kept for the
   on-screen view and now goes through setIf(), which never blanks a field the
   server already filled. */
var D = (typeof printData !== 'undefined' && printData) ? printData : {};
function pv(v){ return (v===null||v===undefined||v==='') ? '\\u2014' : String(v); }
function pesc(v){ return pv(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
?>
`;

const GUARD = `
/* Server-rendered already; this only enhances the on-screen view. */
function setIf(id, val) {
  var el = document.getElementById(id);
  if (!el) return;
  var v = (val === null || val === undefined || val === '') ? '' : String(val);
  if (!v) return;                 // keep the server-rendered value
  el.textContent = v;
}
`;

function toServerExpr(expr) {
  return expr.replace(/\s+/g, ' ').replace(/\bd\./g, 'D.').trim();
}

function convert(path) {
  let s = fs.readFileSync(path, 'utf8');
  if (s.indexOf('SERVER-SIDE RENDERING') !== -1) return `${path}: already converted`;

  // Collect id -> first assignment expression.
  const map = new Map();
  let m;
  ASSIGN.lastIndex = 0;
  while ((m = ASSIGN.exec(s))) if (!map.has(m[1])) map.set(m[1], m[2]);
  if (!map.size) return `${path}: no textContent assignments found`;

  // Fill the matching EMPTY element for each id.
  let filled = 0, missed = [];
  for (const [id, expr] of map) {
    let done = false;
    for (const tag of ['span', 'td', 'div', 'b']) {
      const re = new RegExp(`(<${tag}\\b[^>]*id=["']${id}["'][^>]*>)\\s*</${tag}>`);
      if (re.test(s)) {
        s = s.replace(re, `$1<?= pesc(${toServerExpr(expr)}) ?></${tag}>`);
        filled++; done = true; break;
      }
    }
    if (!done) missed.push(id);
  }
  if (!filled) return `${path}: no empty targets matched`;

  s = HELPER + s;
  s = s.replace(ASSIGN, (mm, id, expr) => `setIf('${id}', ${expr.trim()});`);

  // Insert the guard right after the payload line.
  const payload = /var d = <\?!= JSON\.stringify\(printData\) \?>;\r?\n/;
  if (payload.test(s)) s = s.replace(payload, (mt) => mt + GUARD);

  fs.writeFileSync(path, s);
  return `${path}: converted ${filled} field(s)` +
         (missed.length ? `  (no empty element for: ${missed.join(', ')})` : '');
}

process.argv.slice(2).forEach(p => console.log(convert(p)));
