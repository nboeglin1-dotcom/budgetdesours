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
    assert.match(bref, new RegExp(`${stats.up.toLocaleString('fr-FR').replace(/\s/g,'\\s')}\\s€ à venir`));
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
    await page.evaluate(() => { state.viewY = 2027; state.viewM = 2; state.envOpen = 'alimentation'; rerender(); });
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

test('T4 Ajout depuis une enveloppe de l’accueil : la page reste en place', async () => {
  const many = Array.from({length:8}, (_,i)=>({ id:'x'+i, type:'expense', amount:10, category:'alimentation', note:'', accountId:'main', date:D('2026-11-0'+(i+1)) }));
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({ budgets:{ alimentation:600, loisirs:100, transport:100, sante:100, shopping:100 }, lastRolloverCheck:'2026-10', transactions: many }) });
  const { page, errors } = app;
  try{
    await page.setViewportSize({ width:390, height:600 });
    const y0 = 0;                                                     // page fixe : rien ne défile
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

test('T5 Transactions : une carte résumé, la liste s’ouvre dans une feuille par-dessus et se referme', async () => {
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
    assert.ok(await page.$('.panel-sheet.panel-tx'));                  // feuille par-dessus la carte
    await page.click('.panel-sheet [data-txlist="upcoming"]');
    txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Abo test/); assert.doesNotMatch(txt, /Costco|Salaire/);
    await page.click('.panel-sheet [data-txlist="all"]');
    txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Costco/); assert.match(txt, /Salaire/);
    await page.click('[data-close-x-panel="tx"]');                    // la croix referme
    assert.equal(await page.$('.tx-list-card'), null);
    // La loupe ouvre la feuille avec la recherche
    await page.click('[data-toggle-txsearch]');
    await page.fill('#txSearch', 'Costco');
    txt = await page.textContent('.tx-list-card');
    assert.match(txt, /Costco/); assert.doesNotMatch(txt, /Salaire/);
    await page.click('[data-close-x-panel="tx"]');
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
      await page.evaluate(() => { state.envOpen = 'alimentation'; rerender(); });
      if(sel === '[data-goto-today]') await page.evaluate(() => { state.viewM = 0; state.viewY = 2027; rerender(); });
      await page.click(sel);
      await page.waitForTimeout(80);
      assert.deepEqual(await page.evaluate(() => ({ sy: window.scrollY, env: state.envOpen })), { sy:0, env:null }, sel);
    }
    // Mois futur : « tout à venir » sur une ligne, pour que « Le mois en bref » garde la même hauteur
    const brefH = () => page.evaluate(() => { const c=[...document.querySelectorAll('.card')].find(c=>/Le mois en bref/.test(c.innerText)); return [Math.round(c.getBoundingClientRect().height), c.innerText]; });
    await page.setViewportSize({ width:430, height:1100 }); await page.evaluate(() => rerender());   // assez haut pour ne pas resserrer
    const [hNow] = await brefH();
    await page.click('[data-move="1"]');
    const [hNext, txt] = await brefH();
    assert.match(txt, /tout à venir/);
    assert.equal(hNext, hNow);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T7 Clavier ouvert : la fenêtre de saisie se colle en haut de la zone visible', async () => {
  const app = await openApp({ now:'2026-11-21T10:00:00+01:00', data: baseData({}) });
  const { page, errors } = app;
  try{
    await page.setViewportSize({ width:390, height:844 });
    await page.waitForTimeout(200);   // laisse passer le « resize » de la zone visible avant de simuler le clavier
    await page.evaluate(() => setState({ recalOpen:true, recalInput:'' }));
    const pos = await page.evaluate(() => { const o=document.querySelector('.modal-overlay'); return getComputedStyle(o).alignItems; });
    assert.equal(pos, 'flex-end');                                     // sans clavier : en bas
    await page.evaluate(() => { const h=document.documentElement; h.classList.add('kb-open'); h.style.setProperty('--vvh','480px'); h.style.setProperty('--vvt','0px'); });
    const r = await page.evaluate(() => { const o=document.querySelector('.modal-overlay'), sh=document.querySelector('.modal-sheet'); return { a:getComputedStyle(o).alignItems, h:Math.round(o.getBoundingClientRect().height), top:Math.round(sh.getBoundingClientRect().top), bottom:Math.round(sh.getBoundingClientRect().bottom) }; });
    assert.equal(r.a, 'flex-start');
    assert.equal(r.h, 480);
    assert.equal(r.top, 0);
    assert.ok(r.bottom <= 480, JSON.stringify(r));                     // rien sous le clavier
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T8 Récurrence créée avec une 1re date future : PRÉVU jusqu’à sa date ; anciennes données remises en PRÉVU', async () => {
  const app = await openApp({ now:'2026-11-22T21:00:00+01:00', data: baseData({
    recurring:[{ id:'rr', type:'expense', amount:15, category:'epargne', note:'', frequency:'monthly', accountId:'main', nextDate:'2026-12-30T00:00:00.000Z', anchorDay:30 }],
    transactions:[{ id:'tf', type:'expense', amount:15, category:'epargne', note:'', accountId:'main', date:'2026-11-30T00:00:00.000Z', recurringId:'rr' }] }) });
  const { page, errors } = app;
  try{
    const r = await page.evaluate(() => ({ n: state.data.transactions.filter(t=>t.recurringId==='rr').length, next: state.data.recurring[0].nextDate.slice(0,10) }));
    assert.deepEqual(r, { n:0, next:'2026-11-30' });
    await page.click('[data-tab="transactions"]');
    await page.click('[data-txlist="upcoming"]');
    assert.match(await page.textContent('.tx-list-card'), /PRÉVU/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});

test('T9 Import du relevé LCL : montants arrondis corrigés, saisies groupées retrouvées, manquantes ajoutées, ré-import sans doublon', async () => {
  const csv = [
    '﻿01/11/2026;1000,00;;00594 691922P',
    '02/11/2026;-21,67;Carte;;CB  LIDL     3940    30/10/26;;0;Divers',
    '03/11/2026;1815;Virement;;;VIREMENT MONSIEUR NICOLAS BOEGL;;',
    '03/11/2026;-1000;Virement;;VIR SEPA M NICOLAS BOEGLIN OU M;;;',
    '10/11/2026;-81,39;Virement;;PRLV SEPA FRANCILIANE;;;',
    '10/11/2026;-192,66;;;PRET IMMOBILIER ECH 10/11/26;;;',
    '10/11/2026;-1133,46;;;PRET IMMOBILIER ECH 10/11/26;;;',
    '16/11/2026;-138,42;Carte;;CB  AUX VENDANGES    14/11/26;;0;Divers',
    '19/11/2026;-4,2;;;ASSURANCE MOYEN DE PAIEMENT;;;',
    '21/11/2026;243,2;;00594 691922P',
  ].join('\r\n');
  const fs = require('fs'), path = require('path'), os = require('os');
  const file = path.join(os.tmpdir(), 'releve-test.csv'); fs.writeFileSync(file, csv, 'utf8');
  const tx = (id, amount, note, date, type='expense') => ({ id, type, amount, category:'autres_d', note, accountId:'main', date:D(date) });
  const app = await openApp({ now:'2026-11-23T09:00:00+01:00', data: baseData({ transactions:[
    { id:'start', type:'income', amount:1000, category:'ajustement', note:'', accountId:'main', date:D('2026-10-31') },
    tx('lidl', 22, 'Lidl', '2026-10-30'), tx('sal', 1815, 'Salaire', '2026-11-03', 'income'),
    tx('e1', 500, 'Épargne 1', '2026-11-03'), tx('e2', 500, 'Épargne 2', '2026-11-03'),
    tx('veo', 83, 'Veolia', '2026-11-09'), tx('pret', 1326, 'Prêt', '2026-11-10'),
    tx('vin', 90, 'Vin', '2026-11-14'), tx('cad', 50, 'Cadeau', '2026-11-14') ] }) });
  const { page, errors } = app;
  try{
    await page.click('[data-tab="transactions"]');
    await page.click('[data-open-bankimport]');
    await page.setInputFiles('#bankImportFile', file);
    await page.waitForSelector('[data-apply-bankimport]');
    const txt = (await page.textContent('.bank-import')).replace(/\s+/g,' ');
    assert.match(txt, /Retrouvées 6 À corriger 4 Manquantes 1/);
    assert.match(txt, /Assurance Moyen De Paiement/);
    await page.check('[data-bankadd="7"]');
    await page.click('[data-apply-bankimport]');
    const r = await page.evaluate(() => ({ lidl: state.data.transactions.find(t=>t.id==='lidl').amount, veo: state.data.transactions.find(t=>t.id==='veo').amount,
      pret: state.data.transactions.find(t=>t.id==='pret').amount, vinCad: ['vin','cad'].map(id=>state.data.transactions.find(t=>t.id===id).amount),
      added: state.data.transactions.filter(t=>t.bankRef && !['lidl','sal','e1','e2','veo','pret','vin','cad'].includes(t.id)).map(t=>[t.note, t.amount, t.category]),
      bal: Math.round(appBalanceAt('2026-11-21T00:00:00.000Z','main')*100)/100 }));
    assert.equal(r.lidl, 21.67); assert.equal(r.veo, 81.39); assert.equal(r.pret, 1326.12);
    assert.deepEqual(r.vinCad, [88.42, 50]);                                         // l'écart va sur la plus grosse saisie
    assert.deepEqual(r.added, [['Assurance Moyen De Paiement', 4.2, 'autres_d']]);
    assert.equal(r.bal, 243.2);                                                     // = solde de clôture du relevé
    // Ré-import : tout est déjà là
    await page.click('[data-open-bankimport]');
    await page.setInputFiles('#bankImportFile', file);
    await page.waitForSelector('.bank-import');
    assert.match((await page.textContent('.bank-import')).replace(/\s+/g,' '), /Tout est déjà importé.*Les 8 opérations/);
    assert.deepEqual(errors, []);
  } finally { await app.close(); }
});
