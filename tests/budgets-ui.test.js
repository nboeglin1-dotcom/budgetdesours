// Onglet Budgets refait au style de l'accueil. Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);
const D = (s) => new Date(s + 'T00:00:00.000Z').toISOString();
const tx = (o) => Object.assign({ id:Math.random().toString(36).slice(2), type:'expense', accountId:'main', note:'' }, o);

test('B1 Budgets : total avec tuiles, limite modifiable, détail et ajout rapide', async () => {
  const app = await openApp({ now:'2026-10-21T10:00:00+02:00', data: baseData({
    budgets:{ alimentation:300, loisirs:100 }, lastRolloverCheck:'2026-9',
    transactions:[
      tx({ id:'a', amount:120, category:'alimentation', date:D('2026-10-05') }),
      tx({ id:'b', amount:130, category:'loisirs', date:D('2026-10-08') }),
    ],
  }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="budgets"]');
    const total = await page.textContent('.budgets-total-card');
    assert.match(total, /250\s€/);
    assert.match(total, /sur 400\s€/);
    assert.match(total, /Reste\s*150\s€/);
    assert.match(total, /≈ 14\s€\s*11 jours/);        // 150 € sur 11 jours (21 → 31 oct.)
    assert.match(total, /1 \/ 2/);                       // loisirs dépassé
    const cards = await page.$$eval('.budget-card', els => els.map(e => e.textContent));
    assert.ok(cards.some(t => /Dépassée de 30\s€/.test(t)));
    await page.click('[data-edit-budget="alimentation"]');
    await page.fill('#budgetInput-alimentation', '350');
    await page.click('[data-save-budget="alimentation"]');
    assert.equal(await page.evaluate(() => state.data.budgets.alimentation), 350);
    await page.click('[data-toggle-budget-detail="loisirs"]');
    assert.equal(await page.evaluate(() => state.expandedBudgetCat), 'loisirs');
    await page.click('.budget-card [data-quick-tx-cat="alimentation"]');
    assert.equal(await page.evaluate(() => !!state.quickTxOpen), true);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
