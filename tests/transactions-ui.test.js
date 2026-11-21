// Onglet Transactions refait au style de l'accueil. Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);
const D = (s) => new Date(s + 'T00:00:00.000Z').toISOString();
const tx = (o) => Object.assign({ id:Math.random().toString(36).slice(2), type:'expense', accountId:'main', note:'' }, o);

test('T1 Transactions : tuiles du mois justes même passées masquées, recherche qui garde le focus', async () => {
  const app = await openApp({ now:'2026-10-21T10:00:00+02:00', data: baseData({
    lastRolloverCheck:'2026-9',
    recurring:[{ id:'r1', type:'expense', amount:15, category:'abonnements', note:'Abo test', frequency:'monthly', accountId:'main', nextDate:D('2026-10-25') }],
    transactions:[
      tx({ amount:2000, type:'income', category:'salaire', note:'Salaire', date:D('2026-10-01') }),
      tx({ amount:688, category:'alimentation', note:'Costco', date:D('2026-10-20') }),
      tx({ amount:60, category:'transport', note:'Essence', date:D('2026-10-21') }),
    ],
  }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="transactions"]');
    let sum = await page.textContent('.tx-summary-card');
    assert.match(sum, /Entrées\s*2\s000\s€/);
    assert.match(sum, /Sorties\s*748\s€/);
    assert.match(sum, /À venir\s*−15\s€\s*1 prévue/);
    await page.click('#txSearch');
    await page.keyboard.type('Cost');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'txSearch');
    sum = await page.textContent('.tx-summary-card');
    assert.match(sum, /Selon ta recherche/);
    assert.match(sum, /Sorties\s*688\s€/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T2 Dépenses du mois : même total sur l’accueil, dans Transactions et sur le graphique', async () => {
  const D = (s) => new Date(s + 'T00:00:00.000Z').toISOString();
  const app = await openApp({ now:'2026-11-15T10:00:00+01:00', data: baseData({
    budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10',
    recurring:[{ id:'r1', type:'expense', amount:100, category:'abonnements', note:'Abo test', frequency:'monthly', accountId:'main', nextDate:'2026-11-25T00:00:00.000Z' }],
    transactions:[
      { id:'i1', type:'income', amount:3000, category:'salaire', note:'', accountId:'main', date:D('2026-11-01') },
      { id:'e1', type:'expense', amount:200, category:'alimentation', note:'', accountId:'main', date:D('2026-11-05') },
      { id:'s1', type:'expense', amount:500, category:'epargne', note:'Épargne', accountId:'main', date:D('2026-11-09') },
    ],
  }) });
  const { page, errors } = app;
  const num = s => Number(String(s).replace(/[^\d]/g, ''));
  try{
    const stats = await page.evaluate(() => { const s = computeMonthStats(); return { expense: Math.round(s.expense), up: Math.round(s.expenseUpcoming) }; });
    const bref = await page.evaluate(() => [...document.querySelectorAll('.card')].find(c=>/Le mois en bref/.test(c.innerText)).innerText);
    assert.match(bref, new RegExp(`dont ${stats.up.toLocaleString('fr-FR').replace(/\s/g,'\\s')}\\s€ à venir`));
    await page.click('[data-tab="transactions"]');
    const tiles = await page.$$eval('.tx-summary-card .mono', els => els.map(e => e.textContent));
    const paid = num(tiles[1]), up = num(tiles[2]);
    assert.equal(paid, 200);                                  // l'épargne n'est pas une dépense
    assert.equal(paid + up, stats.expense);                   // payé + à venir = dépenses de l'accueil
    const chart = await page.textContent('.trend-summary');
    assert.match(chart, new RegExp(`Dépenses\\s*${stats.expense.toLocaleString('fr-FR').replace(/\s/g,'\\s')}\\s€`));
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
