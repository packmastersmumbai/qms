// One-shot helper: replace Tailwind CDN + inline config in each *_F.html (+ Landing.html)
// with a single Apps-Script include of TailwindBundle.html.
//
// Run once with:  node _swap-tailwind.js
// Safe to re-run — it detects already-converted files.

const fs = require('fs');
const path = require('path');

const FILES = [
  'Landing.html',
  'GRN_F.html', 'IQC_F.html', 'OQC_F.html', 'IPQC_F.html',
  'KPI_F.html', 'NCR_F.html', 'CustomerReturn_F.html', 'ControlPlan_F.html',
  'Masters_F.html', 'Records_F.html', 'Warehouse_F.html', 'POP_F.html',
  'Gatepass_F.html'
];

const INCLUDE = `  <?!= HtmlService.createHtmlOutputFromFile('TailwindBundle').getContent(); ?>`;

// Matches Tailwind CDN script (optionally with `?plugins=…` querystring)
const CDN_RE = /<script\s+src="https:\/\/cdn\.tailwindcss\.com[^"]*"\s*><\/script>\s*/m;

// Matches the inline `<script id="tailwind-config">` block (greedy single block)
const CONFIG_RE = /<script\s+id="tailwind-config">[\s\S]*?<\/script>\s*/m;

// Some files use a plain `<script> tailwind.config = …</script>` without id
const CONFIG_PLAIN_RE = /<script>\s*tailwind\.config\s*=\s*\{[\s\S]*?\}\s*\}\s*<\/script>\s*/m;

let changed = 0;
let skipped = 0;
for (const f of FILES) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) { console.log(`MISS  ${f}`); continue; }
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes("HtmlService.createHtmlOutputFromFile('TailwindBundle')")) {
    console.log(`SKIP  ${f}  (already converted)`);
    skipped++;
    continue;
  }
  const before = src;

  // Strip CDN script
  src = src.replace(CDN_RE, '');
  // Strip config block (id'd version first, then plain)
  src = src.replace(CONFIG_RE, '');
  src = src.replace(CONFIG_PLAIN_RE, '');

  // Inject include right before </head>
  if (/<\/head>/i.test(src)) {
    src = src.replace(/<\/head>/i, INCLUDE + '\n</head>');
  } else {
    // Fallback: inject after <html…>
    src = src.replace(/<html[^>]*>/i, m => m + '\n' + INCLUDE);
  }

  if (src === before) {
    console.log(`NOOP  ${f}  (no CDN/config found)`);
    continue;
  }

  fs.writeFileSync(p, src, 'utf8');
  console.log(`OK    ${f}`);
  changed++;
}
console.log(`\nChanged: ${changed}  Skipped: ${skipped}`);
