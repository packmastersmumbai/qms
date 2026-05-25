async (page) => {
  const GAS = 'https://script.google.com/macros/s/AKfycbz-TYeVtSrCFLcs32IeGpNPwTFx3_rdYSd42_Y9EAu5v2h9cDCjAEgl_w75Tk8ZA90JNA/exec';
  const results = [];
  const pass = (n) => { results.push({n,ok:true}); console.log('PASS | ' + n); };
  const fail = (n, d) => { results.push({n,ok:false}); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

  const getFrame = () => page.frames().find(f => f.url().includes('googleusercontent'));
  const home = async () => { await page.goto(GAS); await page.waitForTimeout(5000); };
  const getText = async () => getFrame().evaluate(() => document.body.innerText);
  const clickBtn = async (re) => { await getFrame().locator('button').filter({hasText: re}).first().click(); await page.waitForTimeout(5000); };
  const openMore = async () => { await getFrame().locator('button').filter({hasText: /More/i}).first().click(); await page.waitForTimeout(2000); };

  await home();
  let t = await getText();
  t.includes('Pack Masters QMS') ? pass('Landing: title') : fail('Landing: title');
  /New GRN.*New IQC.*New OQC/s.test(t) ? pass('Landing: quick actions') : fail('Landing: quick actions');
  /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i.test(t) ? pass('Landing: date+shift') : fail('Landing: date+shift');
  /IQC needed|Dispatch pending|Open session/i.test(t) ? pass('Landing: live alerts') : fail('Landing: live alerts');

  await home(); await clickBtn(/New GRN/i);
  t = await getText();
  /GRN|Goods Receipt/i.test(t) ? pass('GRN: loads') : fail('GRN: loads', t.slice(0,60));
  /Supplier/i.test(t) ? pass('GRN: Supplier') : fail('GRN: Supplier');
  /Purchase Order|PO/i.test(t) ? pass('GRN: PO field') : fail('GRN: PO field');
  /Item|Material/i.test(t) ? pass('GRN: Items') : fail('GRN: Items');

  await home(); await clickBtn(/New IQC/i);
  t = await getText();
  /IQC|Incoming/i.test(t) ? pass('IQC: loads') : fail('IQC: loads', t.slice(0,60));
  /Inspector/i.test(t) ? pass('IQC: Inspector') : fail('IQC: Inspector');
  /AQL/i.test(t) ? pass('IQC: AQL') : fail('IQC: AQL');
  /GRN/i.test(t) ? pass('IQC: GRN selector') : fail('IQC: GRN selector');

  await home(); await clickBtn(/New OQC/i);
  t = await getText();
  /OQC|Outgoing/i.test(t) ? pass('OQC: loads') : fail('OQC: loads', t.slice(0,60));
  /Disposition|ACCEPT|REJECT/i.test(t) ? pass('OQC: disposition') : fail('OQC: disposition');
  /IPQC Session|Batch/i.test(t) ? pass('OQC: IPQC ref') : fail('OQC: IPQC ref');

  await home(); await clickBtn(/NCR/i);
  t = await getText();
  /NCR|Non.Conform/i.test(t) ? pass('NCR: loads') : fail('NCR: loads', t.slice(0,60));
  /PM\/NCR|Open NCR/i.test(t) ? pass('NCR: live records') : fail('NCR: live records');

  await home(); await clickBtn(/Dispatch/i);
  t = await getText();
  /Gatepass|Dispatch/i.test(t) ? pass('Gatepass: loads') : fail('Gatepass: loads', t.slice(0,60));
  /OQC|Customer|Delivery/i.test(t) ? pass('Gatepass: fields') : fail('Gatepass: fields');

  await home(); await clickBtn(/Purchase Order/i);
  t = await getText();
  /Purchase Order|PO/i.test(t) ? pass('PO: loads') : fail('PO: loads', t.slice(0,60));
  /Supplier/i.test(t) ? pass('PO: Supplier') : fail('PO: Supplier');
  /Item|Material|Add/i.test(t) ? pass('PO: line items') : fail('PO: line items');

  await home(); await clickBtn(/Records/i);
  t = await getText();
  /Records|GRN|IQC/i.test(t) ? pass('Records: loads') : fail('Records: loads', t.slice(0,60));

  await home(); await clickBtn(/KPI/i);
  t = await getText();
  /KPI|Quality|Dashboard/i.test(t) ? pass('KPI: loads') : fail('KPI: loads', t.slice(0,60));

  await home(); await openMore();
  t = await getText();
  ['IPQC','Warehouse','Masters','Returns','Control Plan'].forEach(m => t.includes(m) ? pass('More: '+m) : fail('More: '+m));

  await home(); await openMore();
  await getFrame().locator('button, a').filter({hasText: /IPQC/i}).first().click();
  await page.waitForTimeout(5000);
  t = await getText();
  /IPQC|In.Process/i.test(t) ? pass('IPQC: loads') : fail('IPQC: loads', t.slice(0,60));

  await home(); await openMore();
  await getFrame().locator('button, a').filter({hasText: /Warehouse/i}).first().click();
  await page.waitForTimeout(5000);
  t = await getText();
  /Warehouse|Stock|Location/i.test(t) ? pass('Warehouse: loads') : fail('Warehouse: loads', t.slice(0,60));

  await home(); await openMore();
  await getFrame().locator('button, a').filter({hasText: /Masters/i}).first().click();
  await page.waitForTimeout(5000);
  t = await getText();
  /Masters|Supplier|Material|Inspector/i.test(t) ? pass('Masters: loads') : fail('Masters: loads', t.slice(0,60));

  await home(); await openMore();
  await getFrame().locator('button, a').filter({hasText: /Returns/i}).first().click();
  await page.waitForTimeout(5000);
  t = await getText();
  /Returns|Customer Return|Triage/i.test(t) ? pass('CustomerReturn: loads') : fail('CustomerReturn: loads', t.slice(0,60));

  await home(); await openMore();
  await getFrame().locator('button, a').filter({hasText: /Control Plan/i}).first().click();
  await page.waitForTimeout(5000);
  t = await getText();
  /Control Plan|Parameter|FG/i.test(t) ? pass('ControlPlan: loads') : fail('ControlPlan: loads', t.slice(0,60));

  const total = results.length, passed = results.filter(r => r.ok).length;
  console.log('\n=== SUMMARY: ' + passed + '/' + total + ' ===');
  results.filter(r => !r.ok).forEach(r => console.log('  FAIL | ' + r.n));
}
