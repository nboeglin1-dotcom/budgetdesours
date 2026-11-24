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
    assert.equal(await page.$('.budget-card'), null);                 // détail replié par défaut
    await page.click('[data-envlist="all"]');
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

test('B2 Budgets : cartes = enveloppes, rien d’autre, onglet « Enveloppes »', async () => {
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
    await page.click('[data-envlist="all"]');
    assert.equal(await page.$$eval('.budget-card', els => els.length), 2);
    assert.equal(await page.$('[data-toggle-budget-detail="epargne"]'), null);
    assert.equal(await page.$('[data-toggle-budget-detail="logement"]'), null);
    assert.equal(await page.$('[data-toggle-budget-detail="shopping"]'), null);
    assert.equal(await page.$('.budgets-offenv-card'), null);              // plus de carte « Dépenses ponctuelles »
    assert.match(await page.textContent('.tabbar'), /Enveloppes/);
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
    await page.click('.tabbar [data-tab="budgets"]');
    assert.match(await page.textContent('#app'), /Coiffeur/);   // nouvelle enveloppe visible, même sans dépense
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

test('B4 Bouton + flottant : nouvelle transaction dans Transactions, nouvelle catégorie dans Enveloppes, aucun dans Objectifs', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10' }) });
  const { page, errors } = app;
  try{
    await page.click('.tabbar [data-tab="transactions"]');
    await page.click('.fab-add');
    assert.equal(await page.evaluate(() => state.modal), 'addTx');
    await page.evaluate(() => { state.modal = null; rerender(); });
    await page.click('.tabbar [data-tab="budgets"]');
    await page.click('.fab-add');
    assert.equal(await page.evaluate(() => state.categoryModalOpen), true);
    assert.ok(await page.$('#newCatLimit'));               // catégorie de dépense, avec le champ limite
    await page.evaluate(() => { state.categoryModalOpen = false; rerender(); });
    await page.click('.tabbar [data-tab="goals"]');
    assert.equal(await page.$('.fab-add'), null);           // pas de + flottant dans Objectifs
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B5 Fenêtre Catégories : Dépenses / Revenus, toucher une ligne pour la modifier (limite, couleur, suppression)', async () => {
  const app = await openApp({ now:'2026-11-22T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10',
    customCategories:[{ id:'cad', label:'Cadeaux', color:'#7C89A6', type:'expense' }, { id:'rem', label:'Remboursement', color:'#8B7FD6', type:'income' }] }) });
  const { page, errors } = app;
  try{
    await page.click('.tabbar [data-tab="budgets"]');
    await page.click('[data-open-managecat]');
    let txt = await page.textContent('.modal-sheet');
    assert.match(txt, /Alimentation\s*Enveloppe\s*600\s€/);
    assert.match(txt, /Cadeaux/);
    assert.doesNotMatch(txt, /Remboursement|Dépôt sur épargne|Virement entre comptes/);
    await page.click('[data-managecat-type="income"]');
    assert.match(await page.textContent('.modal-sheet'), /Remboursement/);
    await page.click('[data-managecat-type="expense"]');
    // Catégorie de base : nom non modifiable, limite modifiable
    await page.click('[data-open-catedit="alimentation"]');
    assert.equal(await page.$('#newCatLabel[type="hidden"]') !== null, true);
    assert.equal(await page.$('[data-del-cat]'), null);
    await page.fill('#newCatLimit', '800');
    await page.click('[data-submit-newcat]');
    assert.equal(await page.evaluate(() => state.data.budgets.alimentation), 800);
    // Catégorie perso : bouton supprimer
    await page.click('[data-open-catedit="cad"]');
    await page.click('[data-del-cat="cad"]');
    assert.equal(await page.evaluate(() => state.data.customCategories.some(c=>c.id==='cad')), false);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B6 Enveloppes : Toutes / À surveiller / Dépassées s’ouvrent dans une feuille par-dessus la carte', async () => {
  const app = await openApp({ now:'2026-10-21T10:00:00+02:00', data: baseData({
    budgets:{ alimentation:300, loisirs:100, transport:100 }, lastRolloverCheck:'2026-9',
    transactions:[
      tx({ amount:120, category:'alimentation', date:D('2026-10-05') }),   // 40 %
      tx({ amount:130, category:'loisirs', date:D('2026-10-08') }),        // dépassée
      tx({ amount:85, category:'transport', date:D('2026-10-09') }),       // 85 % : à surveiller
    ] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="budgets"]');
    const ids = () => page.$$eval('[data-toggle-budget-detail]', els => els.map(e => e.dataset.toggleBudgetDetail).sort());
    await page.click('[data-envlist="over"]');                        // ouvre la feuille par-dessus
    assert.ok(await page.$('.panel-sheet.panel-env'));
    assert.deepEqual(await ids(), ['loisirs']);
    await page.click('.panel-sheet [data-envlist="watch"]');
    assert.deepEqual(await ids(), ['loisirs', 'transport']);
    await page.click('.panel-sheet [data-envlist="all"]');
    assert.equal((await ids()).length, 3);
    assert.ok(await page.evaluate(() => document.body.classList.contains('panel-open')));   // la page derrière ne défile plus
    await page.click('[data-close-x-panel="env"]');
    assert.equal(await page.$('.panel-sheet'), null);
    assert.deepEqual(await ids(), []);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B7 Rappel de sauvegarde : après 25 modifications ou un import de relevé, sans attendre le jour prévu ; remis à zéro à la sauvegarde', async () => {
  // Mardi 24/11 : pas un jour de sauvegarde, dernière sauvegarde la veille
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ lastExportDate:'2026-11-23T08:00:00.000Z',
    transactions: Array.from({length:6}, (_,i)=>tx({ amount:10, category:'alimentation', date:D('2026-11-1'+i) })) }) });
  const { page, errors } = app;
  try{
    assert.equal(await page.$('[data-export-backup]'), null);
    await page.evaluate(() => { for(let i=0;i<25;i++) mutateData(d=>{ d.transactions[0].amount += 1; }); rerender(); });
    assert.match(await page.textContent('#app'), /25 modifications depuis ta dernière sauvegarde/);
    await page.evaluate(() => { mutateData(d=>{ d.lastExportDate = new Date().toISOString(); }); rerender(); });
    assert.equal(await page.evaluate(() => state.data.changesSinceExport), 0);
    assert.equal(await page.$('[data-export-backup]'), null);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B8 Ours de l’accueil : humeur selon la fin de mois et le coussin, avec une phrase', async () => {
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ caTracker:{ enabled:true }, transactions:[tx({ type:'income', amount:100, category:'salaire', date:D('2026-11-02') }), tx({ amount:151, category:'autres_d', date:D('2026-11-03') })] }) });
  const { page, errors } = app;
  try{
    const r = await page.evaluate(() => [-51, 0, 300, 500, 900].map(e => [bearMoodFromEnd(e), bearLineFromEnd(e, false)]));
    assert.deepEqual(r.map(x=>x[0]), ['worried','neutral','neutral','content','happy']);
    assert.match(r[0][1], /51\s€ à trouver d'ici le 30/);
    assert.match(r[2][1], /200\s€ sous ton coussin de 500\s€/);
    assert.match(await page.textContent('.bear-line'), /51\s€ à trouver/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B9 Accueil : toucher la fin de mois affiche le solde d’aujourd’hui, puis revient', async () => {
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ budgets:{ alimentation:300 }, lastRolloverCheck:'2026-10',
    transactions:[tx({ type:'income', amount:1000, category:'salaire', date:D('2026-11-02') }), tx({ amount:100, category:'alimentation', date:D('2026-11-03') })] }) });
  const { page, errors } = app;
  try{
    const txt = () => page.evaluate(() => document.querySelector('.card').innerText.replace(/\s+/g,' '));
    assert.match(await txt(), /Fin de mois · estimé/);
    await page.click('[data-toggle-baltoday]'); await page.waitForTimeout(800);
    let t = await txt();
    assert.match(t, /Solde · aujourd'hui 900\s€/);                      // 1 000 − 100
    assert.match(t, /Fin de mois estimée : 700\s€/);                    // − 200 restant dans l'enveloppe
    await page.click('[data-toggle-baltoday]'); await page.waitForTimeout(800);
    assert.match(await txt(), /Fin de mois · estimé 700\s€/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B10 Ours sans activité suivie (budget d’un enfant) : pas de coussin, il sourit dès qu’on est dans le vert', async () => {
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ transactions:[tx({ type:'income', amount:300, category:'salaire', date:D('2026-11-02') }), tx({ amount:240, category:'autres_d', date:D('2026-11-03') })] }) });
  const { page, errors } = app;
  try{
    const r = await page.evaluate(() => [-20, 60, 250].map(e => [bearMoodFromEnd(e), bearLineFromEnd(e, false)]));
    assert.deepEqual(r.map(x=>x[0]), ['worried','content','happy']);
    assert.match(r[1][1], /Dans le vert : \+60\s€ de marge/);
    assert.doesNotMatch(await page.textContent('.bear-line'), /coussin/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B11 Accueil : sur un écran court, les cartes se resserrent pour que « Le mois en bref » tienne au-dessus des onglets', async () => {
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ budgets:{ alimentation:600, loisirs:150, transport:100, sante:100, shopping:100, autres_d:150 }, lastRolloverCheck:'2026-10',
    transactions:[tx({ type:'income', amount:2000, category:'salaire', date:D('2026-11-02') }), tx({ amount:100, category:'alimentation', date:D('2026-11-03') })] }) });
  const { page, errors } = app;
  try{
    for(const h of [932, 800, 740]){
      await page.setViewportSize({ width:430, height:h }); await page.evaluate(() => rerender()); await page.waitForTimeout(150);
      const r = await page.evaluate(() => { const c = document.querySelector('[data-bref-title]').closest('.card'); return { bottom: c.getBoundingClientRect().bottom, top: document.querySelector('.tabbar').getBoundingClientRect().top, cls: document.querySelector('#app .page').className }; });
      assert.ok(r.bottom <= r.top, `${h} : ${JSON.stringify(r)}`);
    }
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('B12 Accueil : « Mes objectifs » ne dépasse pas sous « Le mois en bref », on la voit en faisant défiler', async () => {
  const app = await openApp({ now:'2026-11-24T12:00:00+01:00', data: baseData({ budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10',
    goals:[{ id:'g1', name:'Pérou', target:10000, current:1500, color:'#6FA287', accountId:'main' }],
    transactions:[tx({ type:'income', amount:2000, category:'salaire', date:D('2026-11-02') })] }) });
  const { page, errors } = app;
  try{
    await page.setViewportSize({ width:430, height:932 }); await page.evaluate(() => rerender()); await page.waitForTimeout(150);
    const r = await page.evaluate(() => { const c = document.querySelector('[data-bref-title]').closest('.card'); const n = c.nextElementSibling; return { next: n ? n.getBoundingClientRect().top : 9999, tab: document.querySelector('.tabbar').getBoundingClientRect().top }; });
    assert.ok(r.next >= r.tab, JSON.stringify(r));
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
