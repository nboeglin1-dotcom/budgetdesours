// Tests automatiques Solde des Ours — node:test + Playwright (Chromium préinstallé).
// Lancement : NODE_PATH=$(npm root -g) node --test "tests/*.test.js"
// Toutes les données sont fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);

// Dates "comme l'appli" : un <input type=date> donne AAAA-MM-JJ -> minuit UTC.
const D = (s) => new Date(s + 'T00:00:00.000Z').toISOString();
const NOW_SEPT = '2026-09-15T10:00:00+02:00';
const rule = (o) => Object.assign({ id:'r1', type:'expense', amount:15, category:'abonnements', note:'Abo test', frequency:'monthly', accountId:'main' }, o);
const tx = (o) => Object.assign({ id:Math.random().toString(36).slice(2), type:'expense', accountId:'main', note:'' }, o);

async function withApp(opts, fn){
  const app = await openApp(opts);
  try{ await fn(app); } finally { await app.close(); }
}
const remainingOf = (page) => page.evaluate(() => {
  const html = renderGaugeCard(computeMonthStats());
  const m = html.match(/data-allocate-remaining="save" data-remaining-amount="([^"]+)"/);
  return m ? Number(m[1]) : 0;
});

/* ============ 1. Enveloppes « Reste à dépenser » ============ */
test.describe('Enveloppes', () => {
  test('E1 Reste à dépenser = limites − dépenses ponctuelles du mois (récurrences et mois précédent exclus)', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      budgets: { alimentation:300, loisirs:100 },
      recurring: [ rule({ nextDate: D('2026-10-05') }) ],
      transactions: [
        tx({ amount:80, category:'alimentation', date:D('2026-09-03') }),
        tx({ amount:30, category:'loisirs', date:D('2026-09-10') }),
        tx({ amount:15, category:'abonnements', date:D('2026-09-05'), recurringId:'r1' }),
        tx({ amount:500, category:'alimentation', date:D('2026-08-20') }),
      ],
      rolloverEnabled:false, lastRolloverCheck:'2026-8',
    })}, async ({ page, errors }) => {
      assert.equal(await remainingOf(page), 290);
      assert.deepEqual(errors, []);
    }));

  test('E2 Report désactivé : remise à zéro au changement de mois, sans report', () =>
    withApp({ now:'2026-10-02T09:00:00+02:00', data: baseData({
      budgets:{ loisirs:100 }, rolloverEnabled:false, lastRolloverCheck:'2026-8',
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-09-10') }) ],
    })}, async ({ page }) => {
      const r = await page.evaluate(() => ({ roll: state.data.categoryRollover, lim: effectiveLimit('loisirs'), chk: state.data.lastRolloverCheck }));
      assert.deepEqual(r.roll, {});
      assert.equal(r.lim, 100);
      assert.equal(r.chk, '2026-9');
    }));

  test('E3 (documentation) Report activé par défaut : le surplus de septembre est ajouté à octobre', () =>
    withApp({ now:'2026-10-02T09:00:00+02:00', data: baseData({
      budgets:{ loisirs:100 }, lastRolloverCheck:'2026-8', // rolloverEnabled absent -> loadData le met à true
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-09-10') }) ],
    })}, async ({ page }) => {
      const r = await page.evaluate(() => ({ en: state.data.rolloverEnabled, lim: effectiveLimit('loisirs') }));
      assert.equal(r.en, true);
      assert.equal(r.lim, 170);
    }));

  test('E4 Un reste « mis de côté » (envelopeCommitted) ne doit pas être reporté une 2e fois', () =>
    withApp({ now:'2026-10-02T09:00:00+02:00', data: baseData({
      budgets:{ loisirs:100 }, rolloverEnabled:true, lastRolloverCheck:'2026-8',
      envelopeCommitted:{ '2026-8':70 },
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-09-10') }) ],
    })}, async ({ page }) => {
      const lim = await page.evaluate(() => effectiveLimit('loisirs'));
      assert.equal(lim, 100, 'les 70 € déjà versés sur un objectif sont reportés en plus');
    }));

  test('E5 Report désactivé : l’onglet Budgets ne doit pas afficher de report résiduel', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      budgets:{ loisirs:100 }, rolloverEnabled:false, lastRolloverCheck:'2026-8',
      categoryRollover:{ loisirs:50 },
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-09-10') }) ],
    })}, async ({ page }) => {
      const r = await page.evaluate(() => ({ lim: effectiveLimit('loisirs'), html: renderBudgets() }));
      assert.equal(r.lim, 100);
      assert.ok(!r.html.includes('reporté des mois précédents'), 'renderBudgets additionne categoryRollover sans vérifier rolloverEnabled');
    }));
});

/* ============ 2. Récurrences et rapprochement ============ */
test.describe('Récurrences', () => {
  test('R1 Rattrapage : échéances passées générées avec recurringId, nextDate avancée', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ nextDate: D('2026-07-05') }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({
        dates: state.data.transactions.filter(t=>t.recurringId==='r1').map(t=>t.date.slice(0,10)).sort(),
        next: state.data.recurring[0].nextDate.slice(0,10) }));
      assert.deepEqual(r.dates, ['2026-07-05','2026-08-05','2026-09-05']);
      assert.equal(r.next, '2026-10-05');
    }));

  test('R2 Échéance le 31 : ne doit pas glisser définitivement au 28 après février', () =>
    withApp({ now:'2026-04-15T10:00:00+02:00', data: baseData({ recurring:[ rule({ nextDate: D('2026-01-31') }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({
        dates: state.data.transactions.filter(t=>t.recurringId==='r1').map(t=>t.date.slice(0,10)).sort(),
        next: state.data.recurring[0].nextDate.slice(0,10) }));
      assert.deepEqual(r.dates, ['2026-01-31','2026-02-28','2026-03-31']);
      assert.equal(r.next, '2026-04-30');
    }));

  test('R3 Échéance ignorée (skip) : aucune transaction, exception consommée', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ nextDate: D('2026-09-05'),
      exceptions:{ [String(new Date(D('2026-09-05')).getTime())]: { skip:true } } }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({ n: state.data.transactions.filter(t=>t.recurringId==='r1').length, rule: state.data.recurring[0] }));
      assert.equal(r.n, 0);
      assert.equal(r.rule.nextDate.slice(0,10), '2026-10-05');
      assert.deepEqual(r.rule.exceptions, {});
    }));

  test('R4 Échéance modifiée (montant + note) : la transaction générée reprend la modification', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ nextDate: D('2026-09-05'),
      exceptions:{ [String(new Date(D('2026-09-05')).getTime())]: { amount:22, note:'Abo modifié' } } }) ] }) }, async ({ page }) => {
      const t = await page.evaluate(() => state.data.transactions.find(t=>t.recurringId==='r1'));
      assert.equal(t.amount, 22);
      assert.equal(t.note, 'Abo modifié');
    }));

  test('R5 Pas de double comptage : prélèvement déjà saisi (recurringId) avant la date prévue', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      recurring:[ rule({ nextDate: D('2026-09-20') }) ],
      transactions:[ tx({ amount:15, category:'abonnements', date:D('2026-09-12'), recurringId:'r1' }) ],
    })}, async ({ page }) => {
      assert.equal(await page.evaluate(() => recurringOccurrencesInMonth(2026, 8).expense), 0);
    }));

  test('R5b Sans transaction liée, l’échéance à venir est bien comptée', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ nextDate: D('2026-09-20') }) ] }) }, async ({ page }) => {
      assert.equal(await page.evaluate(() => recurringOccurrencesInMonth(2026, 8).expense), 15);
    }));

  test('R6 Hebdomadaire : seules les occurrences restantes du mois sont comptées', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ amount:10, frequency:'weekly', nextDate: D('2026-09-17') }) ] }) }, async ({ page }) => {
      assert.equal(await page.evaluate(() => recurringOccurrencesInMonth(2026, 8).expense), 20);
    }));

  test('R7 Bannière : une échéance ignorée ne doit plus être annoncée', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ note:'Abo ignoré', nextDate: D('2026-09-20'),
      exceptions:{ [String(new Date(D('2026-09-20')).getTime())]: { skip:true } } }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({ html: renderDashboard(), next: upcomingRecurring(365).map(x=>x.next.toISOString().slice(0,10)) }));
      assert.deepEqual(r.next, ['2026-10-20'], 'upcomingRecurring() ignore rule.exceptions');
      assert.ok(!r.html.includes('dans 5 jours'), 'la bannière annonce l’échéance ignorée du 20/09');
    }));

  test('R8 Rapprochement catégorie + montant : transaction future manuelle et échéance fusionnées', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      recurring:[ rule({ nextDate: D('2026-09-20') }) ],
      transactions:[ tx({ amount:15, category:'abonnements', date:D('2026-09-20') }) ],
    })}, async ({ page }) => {
      const html = await page.evaluate(() => renderDashboard());
      assert.equal(html.split('data-banner-item').length - 1, 1);
    }));

  test('R9 Rapprochement montant + note : transaction future d’une autre catégorie reconnue', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      recurring:[ rule({ note:'Box internet', nextDate: D('2026-10-20') }) ],
      transactions:[ tx({ amount:15, category:'autres_d', note:'Box internet', date:D('2026-09-25') }) ],
    })}, async ({ page }) => {
      const html = await page.evaluate(() => renderDashboard());
      assert.ok(html.includes('data-banner-item="tx:'), 'la transaction future doit apparaître dans la bannière');
    }));
});

/* ============ 3. Prévisions ============ */
test.describe('Prévisions', () => {
  const fcData = (extra = {}) => baseData(Object.assign({
    recurring:[ rule({ amount:50, nextDate: D('2026-09-20') }) ],
    transactions:[
      tx({ type:'income', amount:2000, category:'salaire', date:D('2026-09-01') }),
      tx({ amount:500, category:'alimentation', date:D('2026-09-03') }),
      tx({ amount:100, category:'shopping', date:D('2026-09-28') }),
    ],
    rolloverEnabled:false, lastRolloverCheck:'2026-8',
  }, extra));

  test('F1 Solde de départ = réel à date + réel futur du mois + échéances restantes', () =>
    withApp({ now: NOW_SEPT, data: fcData() }, async ({ page }) => {
      const f = await page.evaluate(() => { _forecastCache=null; const f = computeForecast(); return { s:f.startBalance, p:f.points.slice(0,3).map(p=>p.value) }; });
      assert.equal(f.s, 1350);
      assert.deepEqual(f.p, [1300, 1250, 1200]);
    }));

  test('F2 Mois passé : solde réel à la fin du mois', () =>
    withApp({ now: NOW_SEPT, data: fcData({ transactions:[
      tx({ type:'income', amount:1000, category:'salaire', date:D('2026-08-01') }),
      tx({ amount:200, category:'loisirs', date:D('2026-08-31') }),
      tx({ amount:50, category:'loisirs', date:D('2026-09-01') }),
    ]})}, async ({ page }) => {
      assert.equal(await page.evaluate(() => balanceForViewedMonth(computeForecast(), 2026, 7)), 800);
    }));

  test('F3 Virement automatique vers un objectif déduit des mois futurs', () =>
    withApp({ now: NOW_SEPT, data: fcData({
      goals:[{ id:'g1', name:'Objectif test', target:1000, current:0, accountId:'main' }],
      goalTransfers:[{ id:'gt1', goalId:'g1', amount:100, frequency:'monthly', nextDate: D('2026-10-01') }],
    })}, async ({ page }) => {
      const p = await page.evaluate(() => { _forecastCache=null; return computeForecast().points[0].value; });
      assert.equal(p, 1200);
    }));

  test('F4 Dépôt manuel sur épargne daté d’un mois futur : doit réduire le solde prévu', () =>
    withApp({ now: NOW_SEPT, data: fcData({ transactions:[
      ...fcData().transactions,
      tx({ amount:200, category:'epargne', date:D('2026-10-10') }),
    ]})}, async ({ page }) => {
      const p = await page.evaluate(() => { _forecastCache=null; return computeForecast().points[0].value; });
      assert.equal(p, 1100, 'realExpenseFC2 exclut la catégorie epargne (mais pas le mois en cours ni les virements auto)');
    }));
});

/* ============ 4. Export / import ============ */
test.describe('Export / import', () => {
  const exportData = () => baseData({
    budgets:{ loisirs:100 },
    transactions:[ tx({ id:'t1', amount:30, category:'loisirs', date:D('2026-09-10'), note:'Ciné' }) ],
    rolloverEnabled:false, lastRolloverCheck:'2026-8',
  });
  async function doExport(page){
    await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
    await page.click('[data-export-backup]');
    await page.waitForFunction(() => window.__shared.length > 0);
    return page.evaluate(() => window.__shared[0]);
  }
  async function doImport(page, name, text){
    await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
    await page.setInputFiles('#backupImportInput', { name, mimeType:'application/json', buffer: Buffer.from(text) });
    await page.waitForTimeout(300);
  }

  test('X1 Export via Web Share API : fichier JSON complet, date d’export mémorisée', () =>
    withApp({ now: NOW_SEPT, data: exportData(), shareCapture:true }, async ({ page, errors }) => {
      const f = await doExport(page);
      assert.equal(f.name, 'solde-sauvegarde-2026-09-15.json');
      const parsed = JSON.parse(f.text);
      const live = await page.evaluate(() => state.data);
      assert.deepEqual(parsed.transactions, live.transactions);
      assert.deepEqual(parsed.budgets, live.budgets);
      assert.ok(live.lastExportDate);
      assert.deepEqual(errors, []);
    }));

  test('X2 Aller-retour export → import dans une appli vierge', async () => {
    let text;
    await withApp({ now: NOW_SEPT, data: exportData(), shareCapture:true }, async ({ page }) => { text = (await doExport(page)).text; });
    await withApp({ now: NOW_SEPT, data: baseData() }, async ({ page, errors }) => {
      await doImport(page, 'sauvegarde.json', text);
      const r = await page.evaluate(() => ({ tx: state.data.transactions, stored: JSON.parse(localStorage.getItem('solde-budget-data-v1')).transactions.length }));
      assert.equal(r.tx.length, 1);
      assert.equal(r.tx[0].note, 'Ciné');
      assert.equal(r.stored, 1);
      assert.deepEqual(errors, []);
    });
  });

  test('X3 Import d’une sauvegarde ancienne/minimale : pas de plantage', () =>
    withApp({ now: NOW_SEPT, data: exportData() }, async ({ page, errors }) => {
      await doImport(page, 'ancienne.json', JSON.stringify({ transactions:[ { id:'a', type:'expense', amount:10, category:'loisirs', date:D('2026-09-02') } ] }));
      assert.deepEqual(errors, [], 'erreur JS après import : ' + errors.join(' | '));
      const html = await page.evaluate(() => document.getElementById('app').innerHTML.length);
      assert.ok(html > 1000);
    }));

  test('X4 JSON illisible : données inchangées', () =>
    withApp({ now: NOW_SEPT, data: exportData() }, async ({ page }) => {
      await doImport(page, 'casse.json', '{pas du json');
      const n = await page.evaluate(() => state.data.transactions.length);
      assert.equal(n, 1);
    }));

  test('X5 Import : montants non numériques rejetés ou convertis', () =>
    withApp({ now: NOW_SEPT, data: exportData() }, async ({ page }) => {
      await doImport(page, 'texte.json', JSON.stringify(Object.assign(exportData(), { transactions:[
        { id:'a', type:'income', amount:'100', category:'salaire', date:D('2026-09-01'), accountId:'main' },
      ]})));
      const b = await page.evaluate(() => totalBalance());
      assert.ok(typeof b === 'number' && b === 100 || b === 0, 'solde obtenu : ' + JSON.stringify(b));
    }));

  test('X6 Nom du fichier exporté = date locale (export à 0h30 heure de Paris)', () =>
    withApp({ now:'2026-09-16T00:30:00+02:00', data: exportData(), shareCapture:true }, async ({ page }) => {
      const f = await doExport(page);
      assert.equal(f.name, 'solde-sauvegarde-2026-09-16.json');
    }));
});

/* ============ 5. Pastille sur l'icône (reste estimé) ============ */
test.describe('Pastille', () => {
  const data = (extra = {}) => baseData(Object.assign({
    recurring:[ rule({ amount:50, nextDate: D('2026-09-20') }) ],
    transactions:[
      tx({ type:'income', amount:2000, category:'salaire', date:D('2026-09-01') }),
      tx({ amount:500, category:'alimentation', date:D('2026-09-03') }),
      tx({ amount:100, category:'shopping', date:D('2026-09-28') }),
    ],
    rolloverEnabled:false, lastRolloverCheck:'2026-8',
  }, extra));
  const lastBadge = async (page) => { await page.waitForTimeout(1200); return page.evaluate(() => window.__badge.slice(-1)[0]); };

  test('B1 Pastille = reste estimé affiché sur le tableau de bord (arrondi)', () =>
    withApp({ now: NOW_SEPT, data: data() }, async ({ page, errors }) => {
      assert.equal(await lastBadge(page), 1350);
      const shown = await page.evaluate(() => document.getElementById('balanceNum').textContent);
      assert.match(shown.replace(/\s/g,''), /1350/);
      assert.deepEqual(errors, []);
    }));

  test('B2 Mise à jour après une nouvelle dépense', () =>
    withApp({ now: NOW_SEPT, data: data() }, async ({ page }) => {
      await lastBadge(page);
      await page.evaluate(() => mutateData(d => d.transactions.unshift({ id:'n', type:'expense', amount:49.6, category:'loisirs', date:new Date().toISOString(), accountId:'main' })));
      assert.equal(await lastBadge(page), 1300);
    }));

  test('B3 Reste négatif : pas de pastille', () =>
    withApp({ now: NOW_SEPT, data: data({ transactions:[ tx({ amount:300, category:'loisirs', date:D('2026-09-03') }) ] }) }, async ({ page }) => {
      assert.equal(await lastBadge(page), 0);
    }));

  test('B4 Code PIN actif : pas de pastille (montant non visible sans déverrouiller)', () =>
    withApp({ now: NOW_SEPT, data: data({ security:{ enabled:true, pin:'x', useBiometric:false, credentialId:null } }) }, async ({ page }) => {
      assert.equal(await lastBadge(page), 0);
    }));

  test('B5 Un autre compte consulté ne change pas la pastille', () =>
    withApp({ now: NOW_SEPT, data: data({ accounts:[{ id:'main', name:'Compte test', color:'#D4A94F' }, { id:'b', name:'Livret test', color:'#6FA287' }] }) }, async ({ page }) => {
      await lastBadge(page);
      await page.evaluate(() => { state.activeAccountFilter = 'b'; rerender(); });
      assert.equal(await lastBadge(page), 1350);
    }));
});

/* ============ 6. Sauvegardes et protection contre la perte de données ============ */
test.describe('Sauvegardes', () => {
  const SNAP = 'solde-autobackup-';
  const realData = () => baseData({
    transactions:[ tx({ id:'reel1', amount:42, category:'loisirs', date:D('2026-09-12'), note:'Donnée réelle' }) ],
    goals:[ { id:'g1', name:'Objectif test', target:1000, current:250, color:'#6FA287', accountId:'main' } ],
    customCategories:[ { id:'c1', type:'expense', label:'Catégorie test', color:'#8B7FD6' } ],
    recurring:[ rule({ id:'r1', nextDate:D('2026-09-25') }) ],
    accounts:[ { id:'main', name:'Compte test', color:'#D4A94F' }, { id:'b', name:'Compte B', color:'#5FB4C4' } ],
    rolloverEnabled:false, lastRolloverCheck:'2026-8',
  });
  const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('solde-budget-data-v1')));

  test('S1 Suppression d’un objectif : « Annuler » le rétablit avec son montant épargné', () =>
    withApp({ now: NOW_SEPT, data: realData() }, async ({ page, errors }) => {
      await page.evaluate(() => { state.tab = 'goals'; rerender(); });
      await click(page, '[data-del-goal="g1"]');
      assert.equal((await stored(page)).goals.length, 0);
      await click(page, '[data-toast-undo]');
      const g = (await stored(page)).goals;
      assert.equal(g.length, 1);
      assert.equal(g[0].current, 250);
      assert.deepEqual(errors, []);
    }));

  test('S2 Suppression d’une catégorie, d’une récurrence ou d’un compte : « Annuler » disponible', async () => {
    const cases = [
      { open: () => { state.manageCatOpen = true; rerender(); }, sel:'[data-del-cat="c1"]', check: d => d.customCategories.length === 1 },
      { open: () => { state.recurringModalOpen = true; rerender(); }, sel:'[data-del-recur="r1"]', check: d => d.recurring.length === 1 },
      { open: () => { state.accountsModalOpen = true; state.editingAccountId = 'b'; rerender(); }, sel:'[data-del-account="b"]',
        check: d => d.accounts.length === 2 },
    ];
    for(const c of cases){
      await withApp({ now: NOW_SEPT, data: realData() }, async ({ page, errors }) => {
        await page.evaluate(c.open);
        const present = await page.evaluate((s) => !!document.querySelector(s), c.sel);
        assert.ok(present, 'bouton introuvable : ' + c.sel);
        await click(page, c.sel);
        assert.ok(!c.check(await stored(page)), 'suppression non effectuée : ' + c.sel);
        await click(page, '[data-toast-undo]');
        assert.ok(c.check(await stored(page)), 'annulation sans effet : ' + c.sel);
        assert.deepEqual(errors, []);
      });
    }
  });

  test('S3 Restauration d’un fichier : « Annuler » revient aux données d’avant', () =>
    withApp({ now: NOW_SEPT, data: realData() }, async ({ page, errors }) => {
      await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
      const other = JSON.stringify(baseData({ transactions:[ tx({ id:'vieux', amount:1, category:'loisirs', date:D('2026-01-01') }) ] }));
      await page.setInputFiles('#backupImportInput', { name:'vieux.json', mimeType:'application/json', buffer: Buffer.from(other) });
      await page.waitForFunction(() => state.data.transactions[0] && state.data.transactions[0].id === 'vieux');
      await click(page, '[data-toast-undo]');
      assert.equal((await stored(page)).transactions[0].id, 'reel1');
      assert.equal(await page.evaluate(() => state.data.transactions[0].id), 'reel1');
      assert.deepEqual(errors, []);
    }));

  test('S4 Restauration d’un instantané ancien (champs récents absents) : complété, sans erreur, annulable', () =>
    withApp({ now: NOW_SEPT, data: realData(),
      storage: { [SNAP + '2026-09-10']: JSON.stringify({ transactions:[ tx({ id:'snap', amount:5, category:'loisirs', date:D('2026-09-09') }) ], budgets:{} }) } },
    async ({ page, errors }) => {
      await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
      await click(page, '[data-restore-autobackup="2026-09-10"]');
      const d = await page.evaluate(() => state.data);
      assert.equal(d.transactions[0].id, 'snap');
      assert.ok(d.envelopeCommitted && d.dashboardSettings && Array.isArray(d.accounts) && d.accounts.length, 'données non normalisées');
      for(const t of ['dashboard','transactions','budgets','goals']) await page.evaluate((t) => { state.tab = t; rerender(); }, t);
      assert.deepEqual(errors, []);
      await page.evaluate(() => { state.tab = 'dashboard'; rerender(); });
      await click(page, '[data-toast-undo]');
      assert.equal((await stored(page)).transactions[0].id, 'reel1');
    }));

  test('S5 Données principales illisibles : le dernier instantané est rechargé (pas les données d’exemple)', () =>
    withApp({ now: NOW_SEPT, raw: '{"transactions":[{"id":', storage: {
      [SNAP + '2026-09-13']: JSON.stringify(baseData({ transactions:[ tx({ id:'avant', amount:1, category:'loisirs', date:D('2026-09-01') }) ] })),
      [SNAP + '2026-09-14']: JSON.stringify(realData()),
      [SNAP + 'last']: '2026-09-14',
    } }, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({
        ids: state.data.transactions.map(t => t.id),
        stored: JSON.parse(localStorage.getItem('solde-budget-data-v1')).transactions.map(t => t.id),
        technique: !!localStorage.getItem('solde-budget-data-v1-corrupted-backup'),
      }));
      assert.deepEqual(r.ids, ['reel1']);
      assert.deepEqual(r.stored, ['reel1']);
      assert.ok(r.technique, 'copie technique des données illisibles absente');
      assert.deepEqual(errors, []);
    }));

  test('S6 Clé principale absente mais instantanés présents : instantané rechargé', () =>
    withApp({ now: NOW_SEPT, data: null, storage: { [SNAP + '2026-09-14']: JSON.stringify(realData()) } }, async ({ page }) => {
      assert.deepEqual(await page.evaluate(() => state.data.transactions.map(t => t.id)), ['reel1']);
    }));

  test('S7 Premier lancement (aucune donnée, aucun instantané) : données d’exemple comme avant', () =>
    withApp({ now: NOW_SEPT, data: null }, async ({ page, errors }) => {
      assert.ok(await page.evaluate(() => state.data.transactions.length) > 0);
      assert.deepEqual(errors, []);
    }));

  test('S8 Import d’un fichier minimal : mêmes valeurs par défaut qu’au chargement (normalizeData seule source)', async () => {
    const minimal = { transactions:[ tx({ id:'m', amount:3, category:'loisirs', date:D('2026-09-02') }) ] };
    let viaLoad, viaImport;
    await withApp({ now: NOW_SEPT, data: minimal }, async ({ page }) => {
      viaLoad = await page.evaluate(() => ({ p: state.data.pinnedCategories, g: state.data.gaugeAlwaysShow, d: state.data.dashboardSettings, th: state.data.theme }));
    });
    await withApp({ now: NOW_SEPT, data: realData() }, async ({ page }) => {
      await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
      await page.setInputFiles('#backupImportInput', { name:'min.json', mimeType:'application/json', buffer: Buffer.from(JSON.stringify(Object.assign({ theme:'inconnu' }, minimal))) });
      await page.waitForFunction(() => state.data.transactions[0].id === 'm');
      viaImport = await page.evaluate(() => ({ p: state.data.pinnedCategories, g: state.data.gaugeAlwaysShow, d: state.data.dashboardSettings, th: state.data.theme }));
    });
    assert.deepEqual(viaImport, viaLoad);
    assert.equal(viaImport.th, 'ledger');
  });

  test('S9 Instantané du jour daté en heure de Paris (ouverture à 0h30)', () =>
    withApp({ now:'2026-09-16T00:30:00+02:00', data: realData() }, async ({ page }) => {
      const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('solde-autobackup-')));
      assert.ok(keys.includes('solde-autobackup-2026-09-16'), 'clés : ' + keys.join(', '));
    }));

  // Charge HTML : si elle s'exécute, window.__xss est défini.
  const EVIL = (id) => `"'><img src=x onerror="window.__xss=(window.__xss||[]).concat('${id}')">`;
  const visitAll = async (page) => {
    const views = ['dashboard','transactions','budgets','goals'].map(t => `state.tab='${t}'`)
      .concat(['manageCatOpen','recurringModalOpen','accountsModalOpen','gaugeCatModalOpen','pinCatModalOpen','insightsModalOpen','yearlyReviewOpen','transferModalOpen'].map(k => `state.tab='dashboard'; state.${k}=true`))
      .concat(["state.modal='addTx'", "openEditTx('t1')", "state.accountsModalOpen=true; state.editingAccountId='main'"]);
    for(const v of views){
      await page.evaluate(`state.modal=null; for(const k in state){ if(/Open$/.test(k)) state[k]=false; } state.editingAccountId=null; ${v}; rerender();`);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => { showToast('Limite ' + catInfo('c1').label); });
    await page.waitForTimeout(80);
    return page.evaluate(() => window.__xss);
  };

  test('S10 Noms, libellés, notes et couleurs contenant du HTML : aucun code exécuté (onglets, modales, messages)', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      accounts:[ { id:'main', name:EVIL('compte'), color:'#D4A94F' }, { id:'b', name:'B', color:'#5FB4C4' } ],
      customCategories:[ { id:'c1', type:'expense', label:EVIL('categorie'), color:'red"><img src=x onerror="window.__xss=[\'couleur\']">' } ],
      budgets:{ c1:50 }, pinnedCategories:['c1'], gaugeAlwaysShow:['c1'],
      goals:[ { id:'g1', name:EVIL('objectif'), target:100, current:10, color:'#6FA287', accountId:'main' } ],
      recurring:[ rule({ id:'r1', category:'c1', note:EVIL('recurrence'), nextDate:D('2026-09-20') }) ],
      transactions:[ tx({ id:'t1', amount:80, category:'c1', note:EVIL('note'), date:D('2026-09-10') }) ] }) }, async ({ page, errors }) => {
      assert.equal(await visitAll(page), undefined);
      assert.deepEqual(errors, []);
    }));

  test('S11 Couleurs : seules les couleurs #hex sont conservées au chargement', () =>
    withApp({ now: NOW_SEPT, data: baseData({ customCategories:[ { id:'c1', type:'expense', label:'A', color:'#8B7FD6' }, { id:'c2', type:'expense', label:'B', color:'url(x)' } ] }) }, async ({ page }) => {
      const cols = await page.evaluate(() => state.data.customCategories.map(c => c.color));
      assert.equal(cols[0], '#8B7FD6');
      assert.match(cols[1], /^#[0-9a-fA-F]{3,8}$/);
    }));

  test('S12 Import : un fichier avec des identifiants anormaux est refusé, données inchangées', () =>
    withApp({ now: NOW_SEPT, data: realData() }, async ({ page }) => {
      await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
      const bad = JSON.stringify(baseData({ transactions:[ tx({ id:'x"><img src=x>', amount:1, category:'loisirs', date:D('2026-09-01') }) ] }));
      await page.setInputFiles('#backupImportInput', { name:'piege.json', mimeType:'application/json', buffer: Buffer.from(bad) });
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => state.data.transactions[0].id), 'reel1');
    }));
});
