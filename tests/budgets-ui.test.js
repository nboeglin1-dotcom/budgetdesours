// Onglet Budgets refait au style de l'accueil. Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);
const D = (s) => new Date(s + 'T00:00:00.000Z').toISOString();
const tx = (o) => Object.assign({ id:Math.random().toString(36).slice(2), type:'expense', accountId:'main', note:'' }, o);

test('B1 Budgets : total avec tuiles, limite modifiable, détail, sans bouton Dépense', async () => {
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
    // Plus de bouton « Dépense » sur les cartes : l'ajout passe par l'accueil et le bouton +.
    assert.equal(await page.$('.budget-card [data-quick-tx-cat]'), null);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B2 Budgets : cartes = enveloppes, dépenses sans limite dans « Dépenses ponctuelles », épargne exclue', async () => {
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({
    budgets:{ alimentation:750, loisirs:150 }, lastRolloverCheck:'2026-10',
    recurring:[{ id:'tf', type:'expense', amount:178, category:'logement', note:'Taxe test', frequency:'monthly', accountId:'main', nextDate:'2026-12-15T00:00:00.000Z' }],
    transactions:[
      tx({ amount:417, category:'alimentation', date:D('2026-11-05') }),
      tx({ amount:108, category:'loisirs', date:D('2026-11-08') }),
      tx({ amount:1000, category:'epargne', date:D('2026-11-03'), note:'Virement auto' }),
      tx({ amount:228, category:'logement', date:D('2026-11-20'), note:'Impôts' }),
      tx({ amount:100, category:'shopping', date:D('2026-11-21'), note:'Cadeau' }),
    ],
  }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="budgets"]');
    const total = await page.textContent('.budgets-total-card');
    assert.match(total, /525\s€/);                 // 417 + 108, sans épargne, impôts ni cadeau hors enveloppe
    assert.match(total, /sur 900\s€/);
    assert.match(total, /Reste\s*375\s€/);
    assert.match(total, /0 \/ 2/);
    assert.equal(await page.$('[data-toggle-budget-detail="epargne"]'), null);
    assert.equal(await page.$('[data-toggle-budget-detail="logement"]'), null);
    assert.equal(await page.$('[data-toggle-budget-detail="shopping"]'), null);
    // Hors enveloppes : impôts (catégorie avec récurrence) et cadeau, sans l'épargne, non comptés dans le total.
    const off = (await page.textContent('.budgets-offenv-card')).replace(/\s+/g,' ');
    assert.match(off, /Dépenses ponctuelles 328\s€/);
    assert.match(off, /228\s€/);
    assert.match(off, /100\s€/);
    assert.doesNotMatch(off, /1\s000\s€/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B3 Nouvelle catégorie avec une limite : elle devient tout de suite une enveloppe', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10' }) });
  const { page, errors } = app;
  try{
    await page.evaluate(() => { newCatFormState = { color: COLORS.slate, type:'expense', label:'', editingId:null }; state.categoryModalOpen = true; rerender(); });
    await page.fill('#newCatLabel', 'Coiffeur');
    await page.fill('#newCatLimit', '40');
    await page.click('[data-newcat-color]');                 // changer la couleur ne perd pas la saisie
    assert.equal(await page.inputValue('#newCatLabel'), 'Coiffeur');
    assert.equal(await page.inputValue('#newCatLimit'), '40');
    await page.click('[data-submit-newcat]');
    const r = await page.evaluate(() => { const c = state.data.customCategories.find(c=>c.label==='Coiffeur'); return { limit: state.data.budgets[c.id] }; });
    assert.equal(r.limit, 40);
    // Sans limite : pas d'enveloppe
    await page.evaluate(() => { newCatFormState = { color: COLORS.slate, type:'expense', label:'', editingId:null }; state.categoryModalOpen = true; rerender(); });
    await page.fill('#newCatLabel', 'Cadeaux');
    await page.click('[data-submit-newcat]');
    const r2 = await page.evaluate(() => { const c = state.data.customCategories.find(c=>c.label==='Cadeaux'); return state.data.budgets[c.id]; });
    assert.equal(r2, undefined);
    // Revenu : pas de champ limite
    await page.evaluate(() => { newCatFormState = { color: COLORS.slate, type:'income', label:'', editingId:null }; state.categoryModalOpen = true; rerender(); });
    assert.equal(await page.$('#newCatLimit'), null);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
