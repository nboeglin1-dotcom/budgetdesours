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
