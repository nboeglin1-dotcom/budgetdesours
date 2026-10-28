// Onglet Objectifs, partie « Mon épargne » : cartes refaites au style de l'accueil. Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);

const goals = [
  { id:'g1', name:'Voyage test', target:4000, current:1250, color:'#9B7FD4', accountId:'main', deadline:'2027-07-01T00:00:00.000Z' },
  { id:'g2', name:'Réserve test', target:3000, current:3000, color:'#7FB685', accountId:'main' },
];

test('G1 Cartes d’épargne : total, virements auto par mois, ajout et retrait', async () => {
  const app = await openApp({ now:'2026-10-28T10:00:00+01:00', data: baseData({
    goals, goalTransfers:[{ goalId:'g1', amount:500, frequency:'monthly', nextDate:'2026-11-09T00:00:00.000Z' }],
  }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="goals"]');
    const total = await page.textContent('.goals-total-card');
    assert.match(total, /4\s250\s€/);
    assert.match(total, /Auto \/ mois\s*500\s€/);
    assert.match(total, /1 \/ 2/);
    await page.fill('#goalAmount-g1', '100');
    await page.click('[data-contribute="g1"]');
    assert.equal(await page.evaluate(() => state.data.goals.find(g=>g.id==='g1').current), 1350);
    await page.fill('#goalAmount-g1', '50');
    await page.click('[data-withdraw="g1"]');
    assert.equal(await page.evaluate(() => state.data.goals.find(g=>g.id==='g1').current), 1300);
    await page.click('[data-open-goaltransfer="g1"]');
    assert.equal(await page.evaluate(() => state.editingGoalTransferId), 'g1');
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
