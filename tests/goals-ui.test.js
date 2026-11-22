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
    assert.match(total, /Auto 500\s€\/mois/);
    assert.match(total, /juil\. 2027 · dans les temps · \+1\s250\s€/);   // 1 250 + 8 virements de 500
    assert.match(total, /Atteint/);
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

test('G4 Prévision : versements prévus comptés, retard en €/mois, surplus de CA', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', data: baseData({
    caTracker:{ months:{ '2026-11':6920 }, shineMonths:{ '2026-12':{ amount:1600, after:false, date:'2026-11-22' } } },
    goalTransfers:[{ goalId:'g1', amount:500, frequency:'monthly', nextDate:'2026-12-09T00:00:00.000Z' }],
    goals:[{ id:'g1', name:'Pérou', target:10000, current:1515, color:'#6FA287', accountId:'main', deadline:'2027-08-01T00:00:00.000Z' }] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="goals"]');
    // 1 515 + 8 × 500 (déc. → juil.) = 5 515 → manque 4 485 sur 9 mois ≈ 500 €/mois
    let card = await page.textContent('.goals-total-card');
    assert.match(card, /manque 4\s485\s€ · ≈ 500\s€\/mois de plus/);
    // Surplus = virement du 5 vers le commun − besoin du commun (370 € par défaut)
    assert.match(card, /Atteint · \+2\s820\s€/);
    const commun = await page.evaluate(() => shineTransferPlan(2026, 11).commun);
    const fr = n => new Intl.NumberFormat('fr-FR').format(n).replace(/\s/g, '\\s');
    assert.match(card, new RegExp(`Surplus ${fr(Math.floor((commun - 370) / 10) * 10)}\\s€ le 5 déc\\. : le commun reçoit ${fr(commun)}\\s€ pour un besoin de 370\\s€`));
    // Verser le surplus : l'objectif monte, une dépense « épargne » sur le commun, l'encadré passe à « versé »
    const surplus = Math.floor((commun - 370) / 10) * 10;
    await page.click('[data-pay-surplus="2026-12"]');
    assert.equal(await page.evaluate(() => state.data.goals[0].current), 1515 + surplus);
    assert.match(await page.textContent('.surplus-box'), /Surplus versé/);
    await page.click('[data-undo-surplus="2026-12"]');               // annuler : tout revient
    assert.equal(await page.evaluate(() => state.data.goals[0].current), 1515);
    assert.ok(await page.$('[data-pay-surplus="2026-12"]'));
    await page.evaluate(() => setState({ toast:null }));
    await page.evaluate(() => setState({ goalDeadlineModalId:'g1' }));
    await page.fill('#goalPlanLabel', '13e mois');
    await page.fill('#goalPlanAmount', '800');
    await page.fill('#goalPlanMonth', '2027-01');
    await page.click('[data-add-goalplan="g1"]');
    await page.fill('#goalPlanAmount', '800');
    await page.fill('#goalPlanMonth', '2027-07');
    await page.click('[data-add-goalplan="g1"]');
    assert.equal(await page.evaluate(() => state.data.goals[0].planned.length), 2);
    assert.match(await page.textContent('#goalDeadlinePreview'), /auto 4\s000\s€ \+ prévus 1\s600\s€/);
    await page.evaluate(() => setState({ goalDeadlineModalId:null }));
    card = await page.textContent('.goals-total-card');
    assert.match(card, /manque 2\s885\s€/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('G5 Versements prévus arrivés : rappel sur l’accueil, « C’est fait » fait monter l’objectif (bascule depuis un autre objectif)', async () => {
  const app = await openApp({ now:'2027-06-03T10:00:00+02:00', data: baseData({
    goals:[
      { id:'g1', name:'Voyage au Pérou', target:10000, current:6000, color:'#6FA287', accountId:'main', deadline:'2027-08-31T00:00:00.000Z',
        planned:[{ ym:'2027-06', amount:447, label:'Bascule de précaution' }, { ym:'2027-07', amount:800, label:'13e mois' }] },
      { id:'g2', name:'Épargne de Précaution', target:5000, current:5447, color:'#9B7FD4', accountId:'main' } ] }) });
  const { page, errors } = app;
  try{
    const card = await page.textContent('.planned-due-card');
    assert.match(card, /Bascule de précaution/);
    assert.doesNotMatch(card, /13e mois/);                     // juillet : pas encore
    assert.equal(await page.inputValue('#plannedSrc-g1-0'), 'goal:g2');
    const txBefore = await page.evaluate(() => state.data.transactions.length);
    await page.click('[data-planned-done="g1"]');
    const r = await page.evaluate(() => ({ p: state.data.goals[0].current, c: state.data.goals[1].current, n: state.data.goals[0].planned.length, tx: state.data.transactions.length }));
    assert.deepEqual(r, { p: 6447, c: 5000, n: 1, tx: txBefore });
    assert.equal(await page.$('.planned-due-card'), null);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
