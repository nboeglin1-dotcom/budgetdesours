// Onglet Objectifs, partie « Mon épargne » : cartes refaites au style de l'accueil. Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);

const goals = [
  { id:'g1', name:'Voyage test', target:4000, current:1250, color:'#9B7FD4', accountId:'main', deadline:'2027-07-01T00:00:00.000Z' },
  { id:'g2', name:'Réserve test', target:3000, current:3000, color:'#7FB685', accountId:'main' },
];

test('G1 Cartes d’épargne : total, virements auto par mois, sans ajout ni retrait', async () => {
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
    // Plus d'ajout ni de retrait sur les cartes : ça passe par les boutons − / + de l'accueil.
    assert.equal(await page.$('#goalAmount-g1'), null);
    assert.equal(await page.$('[data-contribute="g1"]'), null);
    assert.equal(await page.$('[data-withdraw="g1"]'), null);
    assert.ok(await page.$('[data-del-goal="g1"]'));
    await page.click('[data-open-goaltransfer="g1"]');
    assert.equal(await page.evaluate(() => state.editingGoalTransferId), 'g1');
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('G2 Objectifs : une carte résumé plein écran, les boutons du bas déplient Activité / Virements / Objectifs et s’en souviennent', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', storage:{ 'solde-ui-prefs':'{}' }, data: baseData({
    caTracker:{ months:{ '2026-11':4000 }, shineMonths:{ '2026-12':{ amount:1600, after:false, date:'2026-11-21' } } },
    goals:[{ id:'g1', name:'Pérou', target:10000, current:1500, color:'#6FA287', accountId:'main' }] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="goals"]');
    const card = await page.textContent('.goals-total-card');
    assert.match(card, /Chiffre d'affaires/);
    assert.match(card, /Pérou/);
    for(const sel of ['.ca-card', '.ca-shine-card', '.goal-card']) assert.equal(await page.$(sel), null);
    await page.click('[data-objpanel="ca"]');
    assert.ok(await page.$('.ca-card #caInput'));
    assert.equal(await page.$('[data-toggle-shineplan]'), null);
    await page.click('[data-objpanel="virements"]');
    assert.ok(await page.$('.ca-shine-card'));
    await page.click('[data-objpanel="goals"]');
    assert.ok(await page.$('.goal-card'));
    await page.reload();
    await page.click('[data-tab="goals"]');
    for(const sel of ['.ca-card', '.ca-shine-card', '.goal-card']) assert.ok(await page.$(sel)); // l'appareil garde le choix
    await page.click('[data-objpanel="virements"]');
    assert.equal(await page.$('.ca-shine-card'), null);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('G3 Sans activité ni objectif : état vide, lien pour suivre une activité, pas de boutons', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', data: baseData({ goals:[] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="goals"]');
    assert.match(await page.textContent('.goals-total-card'), /Pas encore d'objectif/);
    assert.equal(await page.$('[data-objpanel]'), null);
    assert.ok(await page.$('[data-enable-ca]'));
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
