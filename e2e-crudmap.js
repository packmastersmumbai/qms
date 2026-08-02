/* Does MastersCrud's positional schema still line up with each real sheet header?
 * getMastersTable maps schema[i] -> cell[i] without reading the header, so any
 * drift silently mislabels data. READ-ONLY. */
const { launch, openApp, call } = require('./e2e-lib');

(async () => {
  const b = await launch();
  const { ctx, rpc } = await openApp(b);

  const schema = await call(rpc, 'getMastersSchema', []);
  for (const name of ['Suppliers', 'Materials', 'Customers', 'Personnel', 'Parameters']) {
    const t = await call(rpc, 'getMastersTable', [name]);
    console.log('\n===== ' + name + ' =====');
    if (!t || t.__err || !t.ok) { console.log('  ERR:', (t && (t.__err || t.error)) || t); continue; }
    const cols = (schema && schema[name] && schema[name].columns) || t.columns || [];
    const row = t.rows && t.rows[0];
    if (!row) { console.log('  no rows'); continue; }
    console.log('  rows: ' + t.rows.length);
    cols.forEach(c => {
      const v = String(row[c.key] == null ? '' : row[c.key]);
      // An ISO timestamp landing in a non-date field is the signature of index drift.
      const suspect = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !/modified|date/i.test(c.label);
      console.log('   ' + (suspect ? 'XX' : '  ') + ' ' + c.label.padEnd(16) + ' = ' + v.slice(0, 44));
    });
    console.log('   -- audit: _lastModified=' + String(row._lastModified).slice(0, 24) +
                ' _modifiedBy=' + String(row._modifiedBy).slice(0, 24));
  }

  await ctx.close(); await b.close();
})();
