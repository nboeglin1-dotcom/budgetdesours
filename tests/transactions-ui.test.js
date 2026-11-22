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
    assert.match(sum, /Revenus\s*2\s000\s€/);
    assert.match(sum, /Dépenses\s*748\s€/);
    // 3e case : le solde à ce jour, comme les deux autres cases
    assert.match(sum, /Solde\s*1\s252\s€\s*à ce jour/);                // 2 000 − 748
    assert.equal(await page.$('#txSearch'), null);                   // la recherche est derrière la loupe
    assert.equal(await page.$('.tx-list-card'), null);               // la liste est repliée
    await page.click('[data-toggle-txsearch]');
    await page.click('#txSearch');
    await page.keyboard.type('Cost');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'txSearch');
    sum = await page.textContent('.tx-summary-card');
    assert.match(sum, /Selon ta recherche/);
    assert.match(sum, /Dépenses\s*688\s€/);
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
    const paid = num(tiles[1]), up = stats.up;
    assert.equal(paid, 200);                                  // l'épargne n'est pas une dépense
    assert.equal(paid + up, stats.expense);                   // payé + à venir = dépenses de l'accueil
    const chart = await page.textContent('.trend-summary');
    assert.match(chart, new RegExp(`Dépenses\\s*${stats.expense.toLocaleString('fr-FR').replace(/\s/g,'\\s')}\\s€`));
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T3 Onglet Accueil : revient toujours au mois en cours, en haut, enveloppes refermées', async () => {
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600 }, lastRolloverCheck:'2026-10',
    transactions:[{ id:'e1', type:'expense', amount:200, category:'alimentation', note:'', accountId:'main', date:D('2026-11-05') }] }) });
  const { page, errors } = app;
  try{
    await page.evaluate(() => { state.viewY = 2027; state.viewM = 2; state.envOpen = 'alimentation'; rerender(); window.scrollTo(0, 400); });
    await page.waitForTimeout(900);
    assert.ok(await page.evaluate(() => window.scrollY) > 0);            // on part bien d'une page défilée
    await page.click('.tabbar [data-tab="dashboard"]');                 // déjà sur l'accueil
    await page.waitForTimeout(50);
    let st = await page.evaluate(() => ({ y: state.viewY, m: state.viewM, env: state.envOpen, sy: window.scrollY }));
    assert.deepEqual(st, { y:2026, m:10, env:null, sy:0 });
    await page.click('.tabbar [data-tab="budgets"]');
    await page.evaluate(() => { state.viewM = 0; state.viewY = 2027; rerender(); });
    await page.click('.tabbar [data-tab="dashboard"]');
    st = await page.evaluate(() => ({ tab: state.tab, y: state.viewY, m: state.viewM }));
    assert.deepEqual(st, { tab:'dashboard', y:2026, m:10 });
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T4 Ajout depuis une enveloppe de l’accueil : la page revient où elle était', async () => {
  const many = Array.from({length:8}, (_,i)=>({ id:'x'+i, type:'expense', amount:10, category:'alimentation', note:'', accountId:'main', date:D('2026-11-0'+(i+1)) }));
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600, loisirs:100, transport:100, sante:100, shopping:100 }, lastRolloverCheck:'2026-10', transactions: many }) });
  const { page, errors } = app;
  try{
    await page.setViewportSize({ width:390, height:600 });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, 250); });
    const y0 = await page.evaluate(() => window.scrollY);
    assert.ok(y0 > 100);
    await page.evaluate(() => document.querySelector('[data-envelopes] .env-main[data-quick-tx-cat="alimentation"]').click());
    await page.evaluate(() => window.scrollTo(0, 0));                 // le clavier décale la page
    await page.fill('#quickTxAmount', '12');
    await page.click('[data-submit-quicktx]');
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => state.quickTxOpen), false);
    assert.equal(await page.evaluate(() => window.scrollY), y0);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T5 Transactions : une carte résumé, la liste s’ouvre avec les boutons du bas et se referme', async () => {
  const app = await openApp({ now:'2026-10-21T10:00:00+02:00', data: baseData({ lastRolloverCheck:'2026-9',
    recurring:[{ id:'r1', type:'expense', amount:15, category:'abonnements', note:'Abo test', frequency:'monthly', accountId:'main', nextDate:D('2026-10-25') }],
    transactions:[
      tx({ id:'s', amount:2000, type:'income', category:'salaire', note:'Salaire', date:D('2026-10-01') }),
      tx({ id:'c', amount:688, category:'alimentation', note:'Costco', date:D('2026-10-20') }),
    ] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="transactions"]');
    assert.equal(await page.$('.tx-list-card'), null);
    await page.click('[data-txlist="income"]');
    let txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Salaire/); assert.doesNotMatch(txt, /Costco/);
    await page.click('[data-txlist="upcoming"]');
    txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Abo test/); assert.doesNotMatch(txt, /Costco|Salaire/);
    await page.click('[data-txlist="all"]');
    txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Costco/); assert.match(txt, /Salaire/);
    await page.click('[data-txlist="all"]');                          // re-toucher referme
    assert.equal(await page.$('.tx-list-card'), null);
    // Toucher un mois du graphique y emmène
    await page.click('[data-trend-month="2026-8"]');
    assert.deepEqual(await page.evaluate(() => [state.viewY, state.viewM]), [2026, 8]);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T6 Accueil : changer de mois (flèches, Aujourd’hui) remet la page en haut, enveloppes refermées', async () => {
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600, loisirs:100, transport:100, sante:100, shopping:100 }, lastRolloverCheck:'2026-10',
    transactions:[{ id:'e1', type:'expense', amount:200, category:'alimentation', note:'', accountId:'main', date:D('2026-11-05') }] }) });
  const { page, errors } = app;
  try{
    await page.setViewportSize({ width:390, height:600 });
    for(const sel of ['[data-move="1"]', '[data-move="-1"]', '[data-goto-today]']){
      await page.evaluate(() => { state.envOpen = 'alimentation'; rerender(); document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, 500); });
      assert.ok(await page.evaluate(() => window.scrollY) > 0);
      if(sel === '[data-goto-today]') await page.evaluate(() => { state.viewM = 0; state.viewY = 2027; rerender(); window.scrollTo(0, 500); });
      await page.click(sel);
      await page.waitForTimeout(80);
      assert.deepEqual(await page.evaluate(() => ({ sy: window.scrollY, env: state.envOpen })), { sy:0, env:null }, sel);
    }
    // Mois futur : « tout à venir » sur une ligne, pour que « Le mois en bref » garde la même hauteur
    const brefH = () => page.evaluate(() => { const c=[...document.querySelectorAll('.card')].find(c=>/Le mois en bref/.test(c.innerText)); return [Math.round(c.getBoundingClientRect().height), c.innerText]; });
    const [hNow] = await brefH();
    await page.click('[data-move="1"]');
    const [hNext, txt] = await brefH();
    assert.match(txt, /tout à venir/);
    assert.equal(hNext, hNow);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
