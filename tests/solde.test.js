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
  const html = renderDashboard();
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

  test('E3 Aucun report, même sans réglage enregistré : le surplus de septembre n’est pas ajouté à octobre', () =>
    withApp({ now:'2026-10-02T09:00:00+02:00', data: baseData({
      budgets:{ loisirs:100 }, lastRolloverCheck:'2026-8', // rolloverEnabled absent -> loadData le met à false
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-09-10') }) ],
    })}, async ({ page }) => {
      const r = await page.evaluate(() => ({ en: state.data.rolloverEnabled, lim: effectiveLimit('loisirs') }));
      assert.equal(r.en, false);
      assert.equal(r.lim, 100);
    }));

  test('E4 Même avec rolloverEnabled:true dans une ancienne sauvegarde, la limite reste le budget de base', () =>
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

test.describe('Enveloppes sans report', () => {
  test('E6 Ancienne sauvegarde avec report activé et reste stocké : limite = budget de base, plus de « mis de côté » ni d’interrupteur', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      budgets:{ loisirs:100 }, rolloverEnabled:true, lastRolloverCheck:'2026-7',
      categoryRollover:{ loisirs:50 },
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-08-10') }) ],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ lim: effectiveLimit('loisirs'), html: renderBudgets(), chk: state.data.lastRolloverCheck, stored: state.data.categoryRollover.loisirs }));
      assert.equal(r.lim, 100);
      assert.ok(!r.html.includes('mis de côté') && !r.html.includes('reporté'));
      assert.equal(r.chk, '2026-8');
      assert.equal(r.stored, 50, 'les données enregistrées ne sont pas modifiées');
      assert.ok(!(await page.content()).includes('data-toggle-rollover'));
      assert.deepEqual(errors, []);
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

  test('R7 Échéance ignorée : plus annoncée par upcomingRecurring()', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring:[ rule({ note:'Abo ignoré', nextDate: D('2026-09-20'),
      exceptions:{ [String(new Date(D('2026-09-20')).getTime())]: { skip:true } } }) ] }) }, async ({ page }) => {
      const next = await page.evaluate(() => upcomingRecurring(365).map(x=>x.next.toISOString().slice(0,10)));
      assert.deepEqual(next, ['2026-10-20'], 'upcomingRecurring() ignore rule.exceptions');
    }));
});

test.describe('Rapprochement des récurrences (source unique)', () => {
  test('R10 isLinkedToRecurring : identifiant, catégorie + montant, montant + note ; sinon non lié', () =>
    withApp({ now: NOW_SEPT, data: baseData({
      recurring:[ rule({ id:'r1', note:'Box internet', amount:15, category:'abonnements', nextDate: D('2026-09-20') }) ],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({
        parId: isLinkedToRecurring({ recurringId:'r1', amount:1, category:'x', note:'' }),
        idInconnu: isLinkedToRecurring({ recurringId:'zz', amount:1, category:'x', note:'' }),
        catMontant: isLinkedToRecurring({ amount:15, category:'abonnements', note:'autre' }),
        montantNote: isLinkedToRecurring({ amount:15, category:'divers', note:' Box internet ' }),
        montantSeul: isLinkedToRecurring({ amount:15, category:'divers', note:'' }),
        autreMontant: isLinkedToRecurring({ amount:16, category:'divers', note:'Box internet' }),
        diagnostic: (() => { let msg = ''; window.alert = (m) => { msg = m; }; state.backupModalOpen = true; rerender();
          document.querySelector('[data-debug-banner]').click(); return msg; })(),
      }));
      assert.deepEqual([r.parId, r.idInconnu, r.catMontant, r.montantNote, r.montantSeul, r.autreMontant],
        [true, false, true, true, false, false]);
      assert.ok(r.diagnostic.includes('6 prochains'), 'l’outil de diagnostic fonctionne');
      assert.deepEqual(errors, []);
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

  test('F5 Catégories « Ancien Solde » et virements exclus des moyennes de la prévision', () =>
    withApp({ now: NOW_SEPT, data: baseData({ transactions:[
      tx({ type:'income', amount:1000, category:'salaire', date:D('2026-08-05') }),
      tx({ amount:100, category:'courses', date:D('2026-08-10') }),
      tx({ type:'income', amount:5000, category:'ln010xel', note:'Ancien Solde', date:D('2026-08-01') }),
      tx({ amount:700, category:'ygzu4bl8', note:'Ancien Solde', date:D('2026-08-02') }),
      tx({ amount:300, category:'virement', date:D('2026-08-03') }),
    ]})}, async ({ page, errors }) => {
      const f = await page.evaluate(() => { _forecastCache=null; const r = computeForecast(); return { i:r.avgIncome, e:r.avgExpense }; });
      assert.deepEqual(f, { i:1000, e:100 });
      assert.deepEqual(errors, []);
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
      const b = await page.evaluate(() => visibleTransactions().reduce((s,t)=> s + (t.type==='income'? t.amount : -t.amount), 0)); // solde (totalBalance retirée avec le score)
      assert.ok(typeof b === 'number' && b === 100 || b === 0, 'solde obtenu : ' + JSON.stringify(b));
    }));

  test('X6 Nom du fichier exporté = date locale (export à 0h30 heure de Paris)', () =>
    withApp({ now:'2026-09-16T00:30:00+02:00', data: exportData(), shareCapture:true }, async ({ page }) => {
      const f = await doExport(page);
      assert.equal(f.name, 'solde-sauvegarde-2026-09-16.json');
    }));
});

/* ============ 5. Pastille sur l'icône : retirée le 02/10/2026 ============ */
test.describe('Pastille retirée', () => {
  const data = (extra = {}) => baseData(Object.assign({
    transactions:[
      tx({ type:'income', amount:2000, category:'salaire', date:D('2026-09-01') }),
      tx({ amount:500, category:'alimentation', date:D('2026-09-03') }),
    ],
  }, extra));

  test('B1 Au démarrage, l’ancienne pastille est effacée et aucune nouvelle n’est posée', () =>
    withApp({ now: NOW_SEPT, data: data() }, async ({ page, errors }) => {
      await page.waitForTimeout(1200);
      assert.deepEqual(await page.evaluate(() => window.__badge), [0]);
      assert.deepEqual(errors, []);
    }));

  test('B2 Nouvelle dépense : toujours aucune pastille', () =>
    withApp({ now: NOW_SEPT, data: data() }, async ({ page }) => {
      await page.evaluate(() => mutateData(d => d.transactions.unshift({ id:'n', type:'expense', amount:49.6, category:'loisirs', date:new Date().toISOString(), accountId:'main' })));
      await page.waitForTimeout(1200);
      assert.deepEqual(await page.evaluate(() => window.__badge), [0]);
    }));

  test('B3 Navigateur sans API de pastille : aucune erreur', () =>
    withApp({ now: NOW_SEPT, data: data() }, async ({ page, errors }) => {
      await page.evaluate(() => { delete navigator.clearAppBadge; clearAppBadgeOnce(); });
      assert.deepEqual(errors, []);
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
      .concat(['manageCatOpen','recurringModalOpen','accountsModalOpen','gaugeCatModalOpen','pinCatModalOpen','transferModalOpen','backupModalOpen'].map(k => `state.tab='dashboard'; state.${k}=true`))
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

/* ============ 7. Démarrage (nuit du 01/10/2026) ============ */
test.describe('Démarrage', () => {
  const withLastMonth = (extra = {}) => baseData(Object.assign({
    lastMonthlyRecapShown: '2026-8', // récapitulatif de septembre déjà vu : celui d'octobre reste à afficher
    transactions: [
      tx({ id:'s1', type:'income', amount:2000, category:'salaire', date:D('2026-09-01') }),
      tx({ id:'s2', amount:300, category:'courses', date:D('2026-09-10') }),
      tx({ id:'s3', amount:80, category:'epargne', date:D('2026-09-12') }),
      tx({ id:'a1', amount:100, category:'courses', date:D('2026-08-10') }),
    ] }, extra));

  test('D1 1er du mois avec un mois précédent rempli : l’appli démarre et affiche le récapitulatif', () =>
    withApp({ now: '2026-10-01T08:00:00+02:00', data: withLastMonth() }, async ({ page, errors }) => {
      assert.deepEqual(errors, []);
      const r = await page.evaluate(() => ({ crash: !!document.getElementById('app').dataset.crashHandled, recap: state.monthlyRecapOpen, key: state.data.lastMonthlyRecapShown }));
      assert.equal(r.crash, false);
      assert.equal(r.recap, true);
      assert.equal(r.key, '2026-9');
    }));

  test('D2 Récapitulatif : virements et épargne exclus des revenus/dépenses (même liste que le tableau de bord)', () =>
    withApp({ now: '2026-10-03T08:00:00+02:00', data: withLastMonth() }, async ({ page }) => {
      const r = await page.evaluate(() => state.monthlyRecapData);
      assert.equal(r.lastIncome, 2000);
      assert.equal(r.lastExpense, 300);
    }));

  test('D4 Chaque jour du 1er au 8 : aucun écran « Un problème est survenu »', async () => {
    for(let d = 1; d <= 8; d++){
      await withApp({ now: `2026-10-0${d}T07:30:00+02:00`, data: withLastMonth() }, async ({ page, errors }) => {
        assert.deepEqual(errors, [], `jour ${d}`);
        assert.equal(await page.evaluate(() => !!document.getElementById('app').dataset.crashHandled), false, `jour ${d}`);
      });
    }
  });
});

/* ============ 8. Version allégée (fonctions secondaires retirées le 01/10/2026) ============ */
test.describe('Version allégée', () => {
  test('V1 Saisie vocale, import PDF, habitudes, score, « Et si… » et bilan : plus aucune trace dans l’appli', () =>
    withApp({ now: NOW_SEPT, data: baseData() }, async ({ page, errors }) => {
      const r = await page.evaluate(async () => {
        const html = [];
        for(const t of ['dashboard','transactions','budgets','goals']){ state.tab = t; rerender(); html.push(document.body.innerHTML); }
        state.tab = 'dashboard'; state.backupModalOpen = true; rerender(); html.push(document.body.innerHTML);
        const all = html.join('');
        return {
          traces: ['data-voice-fab','pdfImportInput','data-open-habitcalc','data-open-insights','data-open-whatif','data-open-yearly'].filter(k => all.includes(k)),
          fonctions: ['startVoiceCapture','extractPdfLines','renderHabitCalcModal','computeHealthScore','renderWhatIfModal','computeReviewStats'].filter(f => typeof window[f] === 'function'),
          cdn: !!document.querySelector('script[src*="cdnjs"]'),
          csv: !!document.getElementById('csvImportInput'),
        };
      });
      assert.deepEqual(r.traces, []);
      assert.deepEqual(r.fonctions, []);
      assert.equal(r.cdn, false);
      assert.equal(r.csv, true, 'l’import CSV reste disponible');
      assert.deepEqual(errors, []);
    }));

  test('V2 Anciennes données (historique du score, état des écrans retirés) : chargées sans erreur et conservées', () =>
    withApp({ now: NOW_SEPT, data: baseData({ healthScoreHistory:[ { monthKey:'2026-7', score:70 } ],
      transactions:[ tx({ id:'t1', amount:20, category:'courses', date:D('2026-09-03') }) ] }) }, async ({ page, errors }) => {
      assert.deepEqual(errors, []);
      const r = await page.evaluate(() => ({ n: state.data.transactions.length, hist: state.data.healthScoreHistory }));
      assert.equal(r.n, 1);
      assert.equal(r.hist.length, 1);
    }));

  test('V3 Import CSV toujours fonctionnel (aperçu puis import)', () =>
    withApp({ now: NOW_SEPT, data: baseData() }, async ({ page, errors }) => {
      await page.evaluate(() => { state.backupModalOpen = true; rerender(); });
      const csv = 'Date;Libellé;Montant\n05/09/2026;Boulangerie;-4,20\n08/09/2026;Remboursement;15,00\n';
      await page.setInputFiles('#csvImportInput', { name:'releve.csv', mimeType:'text/csv', buffer: Buffer.from(csv) });
      await page.waitForFunction(() => state.csvImport && state.csvImport.rows.length === 2, null, { timeout: 5000 });
      await page.click('[data-confirm-csv-import]');
      await page.waitForTimeout(200);
      const txs = await page.evaluate(() => state.data.transactions.map(t => [t.type, t.amount]).sort());
      assert.deepEqual(txs, [['expense', 4.2], ['income', 15]]);
      assert.deepEqual(errors, []);
    }));

  test('V4 Glisser pour fermer le récapitulatif mensuel fonctionne toujours', () =>
    withApp({ now: NOW_SEPT, data: baseData() }, async ({ page, errors }) => {
      await page.evaluate(() => { state.monthlyRecapData = { ly:2026, lm:7, ply:2026, plm:6, lastExpense:0, prevExpense:0, lastIncome:0, prevIncome:0, lastSaved:0, prevSaved:0, topCat:null, topCatDiff:0, expensePctChange:null, isBestMonth:false, overBudgets:[] }; state.monthlyRecapOpen = true; rerender(); });
      assert.equal(await page.evaluate(() => !!document.querySelector('.modal-sheet')), true);
      assert.deepEqual(errors, []);
    }));
});

/* ============ 9. Simplification (jeudi 01/10/2026) ============ */
test.describe('Modification d’une transaction', () => {
  test('M1 Dépôt sur objectif fait à 0h30 le 1er : le modifier sans rien changer le laisse au 1er (pas de glissement au mois précédent)', () =>
    withApp({ now: '2026-10-01T00:30:00+02:00', data: baseData({ goals: [{ id:'g1', name:'Objectif test', target:1000, current:0, accountId:'main' }] }) }, async ({ page, errors }) => {
      const r = await page.evaluate(async () => {
        goalContribute('g1', 50);
        const t = state.data.transactions.find(t=>t.goalId==='g1');
        const before = localYMD(new Date(t.date));
        openEditTx(t.id);
        const formDate = txFormState.date;
        document.querySelector('[data-submit-tx]').click();
        const after = state.data.transactions.find(x=>x.id===t.id);
        return { before, formDate, after: localYMD(new Date(after.date)), current: state.data.goals[0].current };
      });
      assert.deepEqual(errors, []);
      assert.equal(r.before, '2026-10-01');
      assert.equal(r.formDate, '2026-10-01');
      assert.equal(r.after, '2026-10-01');
      assert.equal(r.current, 50);
    }));
  test('M2 Transaction saisie au formulaire (minuit UTC) : la date proposée en modification est inchangée', () =>
    withApp({ now: NOW_SEPT, data: baseData({ transactions: [tx({ id:'t1', amount:12, category:'courses', date:D('2026-09-10') })] }) }, async ({ page }) => {
      const r = await page.evaluate(() => { openEditTx('t1'); const f = txFormState.date; document.querySelector('[data-submit-tx]').click(); return { f, d: state.data.transactions.find(t=>t.id==='t1').date }; });
      assert.equal(r.f, '2026-09-10');
      assert.equal(r.d, '2026-09-10T00:00:00.000Z');
    }));
});

test.describe('Code mort retiré', () => {
  test('C1 Gestionnaires orphelins retirés, appli toujours fonctionnelle sur chaque onglet', () =>
    withApp({ now: NOW_SEPT, data: baseData({ transactions: [tx({ id:'t1', amount:12, category:'courses', date:D('2026-09-10') })], goals:[{ id:'g1', name:'Objectif', target:100, current:10, accountId:'main' }] }) }, async ({ page, errors }) => {
      for(const tab of ['dashboard','transactions','budgets','goals']){
        await page.evaluate((t) => setState({ tab: t }), tab);
      }
      assert.deepEqual(errors, []);
      const src = await page.evaluate(() => document.documentElement.outerHTML);
      for(const a of ['data-budget-adjust','data-quick-contribute','data-quick-withdraw','data-hide-all-cats','data-show-all-cats','data-toggle-recent'])
        assert.ok(!src.includes('[' + a + ']'), a);
    }));
});

/* ============ 10. Dates en heure locale (validé par Nicolas le 01/10/2026) ============ */
test.describe('Dates locales', () => {
  test('L1 Boutons rapides de date : « Aujourd’hui » = date du jour (heure de Paris)', () =>
    withApp({ now: NOW_SEPT, data: baseData() }, async ({ page }) => {
      const r = await page.evaluate(() => { state.modal='addTx'; rerender();
        const o = {}; document.querySelectorAll('[data-tx-date-quick]').forEach(b=>{ o[b.textContent.trim()] = b.dataset.txDateQuick; }); return o; });
      assert.equal(r["Aujourd'hui"], '2026-09-15');
      assert.equal(r['Hier'], '2026-09-14');
      assert.equal(r['Demain'], '2026-09-16');
    }));
  test('L2 Échéance à venir modifiée depuis la liste : date proposée = jour de l’échéance (heure de Paris)', () =>
    withApp({ now: NOW_SEPT, data: baseData({ recurring: [rule({ nextDate: new Date('2026-09-19T22:30:00.000Z').toISOString(), anchorDay: 20 })] }) }, async ({ page }) => {
      const r = await page.evaluate(() => { const occ = new Date('2026-09-19T22:30:00.000Z').getTime(); openEditPreview('pv:r1:' + occ + ':t'); return txFormState.date; }).catch(e => 'ERR ' + e.message);
      assert.equal(r, '2026-09-20');
    }));
});

/* ============ Accueil : « à dépenser par jour » (commits du 02 et 04/10) ============ */
test.describe('Accueil : reste par jour', () => {
  const html = (page) => page.evaluate(() => { const s = computeMonthStats(); return { bal: s.bal, html: renderBalanceContent(s, true) }; });
  const data = (amount) => baseData({ transactions: [tx({ id:'i1', type:'income', amount, category:'salaire', date:D('2026-10-02') })] });

  test('P1 Le 6 octobre : reste ÷ 26 jours (aujourd’hui compris), arrondi à l’entier inférieur', () =>
    withApp({ now: '2026-10-06T10:00:00+02:00', data: data(2000) }, async ({ page, errors }) => {
      const r = await html(page);
      assert.deepEqual(errors, []);
      assert.equal(r.bal, 2000);
      assert.match(r.html, /d'ici le 31 octobre \(26 jours, aujourd'hui compris\)/);
      assert.match(r.html, new RegExp('<strong[^>]*>' + Math.floor(2000 / 26) + '[^<]*</strong>'));
    }));

  test('P2 Le 31 octobre : « dernier jour », reste entier', () =>
    withApp({ now: '2026-10-31T10:00:00+01:00', data: data(2000) }, async ({ page }) => {
      const r = await html(page);
      assert.match(r.html, /\(dernier jour\)/);
      assert.doesNotMatch(r.html, /jours, aujourd'hui compris/);
    }));

  test('P3 Reste nul ou négatif : message « Plus de marge », jours restants au pluriel', () =>
    withApp({ now: '2026-10-06T10:00:00+02:00', data: baseData({ transactions: [tx({ id:'e1', amount:50, category:'courses', date:D('2026-10-03') })] }) }, async ({ page }) => {
      const r = await html(page);
      assert.ok(r.bal < 0);
      assert.match(r.html, /Plus de marge ce mois-ci — 26 jours avant la fin du mois/);
      assert.doesNotMatch(r.html, /à dépenser par jour/);
    }));

  test('P4 Mois affiché ≠ mois en cours : aucune ligne « par jour »', () =>
    withApp({ now: '2026-10-06T10:00:00+02:00', data: data(2000) }, async ({ page }) => {
      const h = await page.evaluate(() => { state.viewM = 8; return renderBalanceContent(computeMonthStats(), true); });
      assert.doesNotMatch(h, /par jour|Plus de marge/);
    }));

  test('P5 Fin février d’une année non bissextile : 28 jours comptés', () =>
    withApp({ now: '2027-02-27T10:00:00+01:00', data: baseData({ transactions: [tx({ id:'i1', type:'income', amount:560, category:'salaire', date:D('2027-02-02') })] }) }, async ({ page }) => {
      const r = await html(page);
      assert.match(r.html, /d'ici le 28 février \(2 jours, aujourd'hui compris\)/);
    }));
});

test.describe('Périodes : une seule source de vérité (addPeriod / subtractPeriod)', () => {
  const NOW_OCT = '2026-10-15T12:00:00+02:00';

  test('T1 subtractPeriod : fins de mois, 29 février, hebdomadaire et annuel', () =>
    withApp({ now: NOW_OCT, data: baseData() }, async ({ page }) => {
      const r = await page.evaluate(() => {
        const s = (d, f, a) => subtractPeriod(d + 'T00:00:00.000Z', f, a).toISOString().slice(0, 10);
        return [
          s('2026-10-31', 'monthly', 31), s('2026-03-31', 'monthly', 31), s('2028-03-31', 'monthly', 31),
          s('2026-03-28', 'monthly', 31), s('2026-12-30', 'monthly', 30), s('2026-10-15', 'monthly', 15),
          s('2028-02-29', 'yearly', 29), s('2027-02-28', 'yearly', 29), s('2026-11-03', 'weekly'),
        ];
      });
      assert.deepEqual(r, ['2026-09-30', '2026-02-28', '2028-02-29', '2026-02-28', '2026-11-30', '2026-09-15',
        '2027-02-28', '2026-02-28', '2026-10-27']);
    }));

  test('T2 subtractPeriod annule exactement addPeriod (jours 1 à 31, mensuel/annuel/hebdo, sur 4 ans)', () =>
    withApp({ now: NOW_OCT, data: baseData() }, async ({ page }) => {
      const bad = await page.evaluate(() => {
        const out = [];
        for (const f of ['monthly', 'yearly', 'weekly']) for (let a = 1; a <= 31; a++) {
          let d = new Date(Date.UTC(2026, 0, Math.min(a, 31)));
          for (let i = 0; i < 48; i++) {
            const n = addPeriod(d, f, a);
            const back = subtractPeriod(n, f, a);
            if (back.getTime() !== d.getTime()) out.push([f, a, d.toISOString(), back.toISOString()]);
            d = n;
          }
        }
        return out;
      });
      assert.deepEqual(bad, []);
    }));

  test('T3 recurringOccurrencesInMonth n’a plus de calcul de date à la main', () =>
    withApp({ now: NOW_OCT, data: baseData() }, async ({ page }) => {
      const src = await page.evaluate(() => recurringOccurrencesInMonth.toString());
      assert.match(src, /subtractPeriod\(/);
      assert.doesNotMatch(src, /setUTC(Month|Date|FullYear)/);
    }));

  test('T4 Règle du 31 : prélèvement réel tombé le 29 → pas compté deux fois dans le mois', () =>
    withApp({ now: NOW_OCT, data: baseData({
      rolloverEnabled:false, lastRolloverCheck:'2026-9',
      recurring: [ rule({ nextDate: D('2026-10-31'), anchorDay: 31 }) ],
      transactions: [
        tx({ amount:15, category:'abonnements', date:D('2026-09-30'), recurringId:'r1' }),
        tx({ amount:15, category:'abonnements', date:D('2026-10-29'), recurringId:'r1' }),
      ],
    })}, async ({ page }) => {
      const r = await page.evaluate(() => [recurringOccurrencesInMonth(2026, 9).expense, recurringOccurrencesInMonth(2026, 10).expense]);
      assert.deepEqual(r, [0, 15]);
    }));

  test('T5 Règle hebdomadaire : les occurrences déjà passées du mois n’effacent pas celles à venir', () =>
    withApp({ now: NOW_OCT, data: baseData({
      rolloverEnabled:false, lastRolloverCheck:'2026-9',
      recurring: [ rule({ frequency:'weekly', amount:10, nextDate: D('2026-10-20'), anchorDay: 20 }) ],
      transactions: [6, 13].map(d => tx({ amount:10, category:'abonnements', date:D('2026-10-' + String(d).padStart(2, '0')), recurringId:'r1' })),
    })}, async ({ page }) => {
      // Restent le 20 et le 27 octobre.
      assert.equal(await page.evaluate(() => recurringOccurrencesInMonth(2026, 9).expense), 20);
    }));

  test('T6 Virement auto vers un objectif créé à 0h30 le 1er (heure de Paris) : un seul virement par mois sur 12 mois', () =>
    withApp({ now: '2026-11-01T00:30:00+01:00', data: baseData({
      rolloverEnabled:false, lastRolloverCheck:'2026-10',
      goals: [{ id:'g1', name:'Objectif test', target:5000, current:0, accountId:'main' }],
      goalTransfers: [{ id:'gt1', goalId:'g1', amount:50, frequency:'monthly', nextDate: '2026-10-31T23:30:00.000Z' }],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => {
        const rule = state.data.goalTransfers[0];
        const counts = [];
        for (let k = 1; k <= 12; k++) { const d = new Date(2026, 10 + k, 1); counts.push(ruleOccurrencesForMonth(rule, d.getFullYear(), d.getMonth()).length); }
        const nov = state.data.transactions.filter(t => t.goalId === 'g1' && sameMonth(t.date, 2026, 10)).length;
        return { nov, counts };
      });
      assert.equal(r.nov, 1);
      assert.deepEqual(r.counts, Array(12).fill(1));
      assert.deepEqual(errors, []);
    }));
});

test.describe('Dates limites : changement d’année, 29 février, prévision sur 24 mois', () => {
  test('Y1 Aucun report : décembre → janvier, la limite repart de 100', () =>
    withApp({ now:'2027-01-02T09:00:00+01:00', data: baseData({
      budgets:{ loisirs:100 }, lastRolloverCheck:'2026-11',
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-12-10') }) ],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ lim: effectiveLimit('loisirs'), chk: state.data.lastRolloverCheck }));
      assert.equal(r.lim, 100);
      assert.equal(r.chk, '2027-0');
      assert.deepEqual(errors, []);
    }));

  test('Y2 Report désactivé : décembre → janvier, remise à zéro', () =>
    withApp({ now:'2027-01-01T00:30:00+01:00', data: baseData({
      budgets:{ loisirs:100 }, rolloverEnabled:false, lastRolloverCheck:'2026-11',
      transactions:[ tx({ amount:30, category:'loisirs', date:D('2026-12-10') }) ],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ lim: effectiveLimit('loisirs'), chk: state.data.lastRolloverCheck }));
      assert.equal(r.lim, 100);
      assert.equal(r.chk, '2027-0');
      assert.deepEqual(errors, []);
    }));

  test('Y3 Échéance le 29 : 29 février 2028 (bissextile), retour au 29 en mars, 28 février en 2027', () =>
    withApp({ now:'2028-03-15T10:00:00+01:00', data: baseData({ recurring:[ rule({ nextDate: D('2027-12-29'), anchorDay: 29 }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({
        dates: state.data.transactions.filter(t=>t.recurringId==='r1').map(t=>t.date.slice(0,10)).sort(),
        next: state.data.recurring[0].nextDate.slice(0,10) }));
      assert.deepEqual(r.dates, ['2027-12-29','2028-01-29','2028-02-29']);
      assert.equal(r.next, '2028-03-29');
    }));

  test('Y4 Échéance le 29 en 2027 (non bissextile) : 28 février puis retour au 29 mars', () =>
    withApp({ now:'2027-03-15T10:00:00+01:00', data: baseData({ recurring:[ rule({ nextDate: D('2027-01-29'), anchorDay: 29 }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => ({
        dates: state.data.transactions.filter(t=>t.recurringId==='r1').map(t=>t.date.slice(0,10)).sort(),
        next: state.data.recurring[0].nextDate.slice(0,10) }));
      assert.deepEqual(r.dates, ['2027-01-29','2027-02-28']);
      assert.equal(r.next, '2027-03-29');
    }));

  test('Y5 Prévision à cheval sur deux années : au moins 12 points, aucune valeur non numérique', () =>
    withApp({ now:'2026-11-20T10:00:00+01:00', data: baseData({
      rolloverEnabled:false, lastRolloverCheck:'2026-10',
      recurring:[ rule({ nextDate: D('2026-12-31'), anchorDay: 31, amount:20 }) ],
      transactions:[
        tx({ type:'income', amount:2000, category:'salaire', date:D('2026-10-01') }),
        tx({ type:'income', amount:2000, category:'salaire', date:D('2026-11-01') }),
        tx({ amount:300, category:'alimentation', date:D('2026-10-12') }),
        tx({ amount:300, category:'alimentation', date:D('2026-11-12') }),
      ],
    })}, async ({ page, errors }) => {
      const f = await page.evaluate(() => { _forecastCache=null; const f = computeForecast(); return { n:f.points.length, ok:f.points.every(p => Number.isFinite(p.value)) }; });
      assert.ok(f.n >= 12, 'au moins 12 points');
      assert.ok(f.ok);
      assert.deepEqual(errors, []);
    }));
});

test.describe('Dates limites : fins de mois, minuit heure de Paris, en-tête', () => {
  const datesOf = (page) => page.evaluate(() => ({
    dates: state.data.transactions.filter(t=>t.recurringId==='r1').map(t=>t.date.slice(0,10)).sort(),
    next: state.data.recurring[0].nextDate.slice(0,10) }));

  test('Y6 Échéance le 31 : 30 novembre, 28 février (2027), retour au 31, sans doublon', () =>
    withApp({ now:'2027-03-02T10:00:00+01:00', data: baseData({ recurring:[ rule({ nextDate: D('2026-10-31'), anchorDay: 31 }) ] }) }, async ({ page, errors }) => {
      const r = await datesOf(page);
      assert.deepEqual(r.dates, ['2026-10-31','2026-11-30','2026-12-31','2027-01-31','2027-02-28']);
      assert.equal(r.next, '2027-03-31');
      assert.deepEqual(errors, []);
    }));

  test('Y7 Démarrage le 1er à 1h05 (heure de Paris) : échéance du 1er générée une seule fois', () =>
    withApp({ now:'2026-12-01T01:05:00+01:00', data: baseData({ recurring:[ rule({ nextDate: D('2026-11-01') }) ] }) }, async ({ page, errors }) => {
      const r = await datesOf(page);
      assert.deepEqual(r.dates, ['2026-11-01','2026-12-01']);
      assert.equal(r.next, '2027-01-01');
      assert.deepEqual(errors, []);
    }));

  test('Y8 Démarrage un 1er avec le mois précédent rempli : chargement sans erreur, remise à zéro des enveloppes', () =>
    withApp({ now:'2027-02-01T08:00:00+01:00', data: baseData({
      budgets:{ alimentation:300 }, rolloverEnabled:false, lastRolloverCheck:'2027-0',
      transactions:[
        tx({ amount:250, category:'alimentation', date:D('2027-01-12') }),
        tx({ type:'income', amount:1800, category:'salaire', date:D('2027-01-28') }),
      ],
    })}, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ lim: effectiveLimit('alimentation'), chk: state.data.lastRolloverCheck }));
      assert.equal(r.lim, 300);
      assert.equal(r.chk, '2027-1');
      assert.deepEqual(errors, []);
    }));

  test('Y9 En-tête : pas de barre d’état « black-translucent » (flou iOS 26), mode plein écran conservé', () =>
    withApp({ now:NOW_SEPT, data: baseData() }, async ({ page }) => {
      const m = await page.evaluate(() => ({
        style: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
        capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content }));
      assert.equal(m.style, null);
      assert.equal(m.capable, 'yes');
    }));

  test('Y10 En-tête : marge anti-flou Liquid Glass réservée à l’app installée iPhone, 0 ailleurs', () =>
    withApp({ now:NOW_SEPT, data: baseData() }, async ({ page, errors }) => {
      const r = await page.evaluate(() => {
        const css = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch(e){ return []; } })
          .map(x => x.cssText).join('\n');
        const header = document.querySelector('.header');
        return {
          clear: getComputedStyle(document.documentElement).getPropertyValue('--top-clear').trim(),
          backdropH: document.querySelector('.statusbar-backdrop').getBoundingClientRect().height,
          padTop: header ? getComputedStyle(header).paddingTop : null,
          hasRule: /display-mode:\s*standalone/.test(css) && /--top-clear:\s*44px/.test(css),
        };
      });
      assert.equal(r.clear, '0px');
      assert.equal(r.backdropH, 0);
      assert.equal(r.padTop, '14px');
      assert.ok(r.hasRule);
      assert.deepEqual(errors, []);
    }));
});

test.describe('Jour d’une récurrence', () => {
  const NOW_OCT = '2026-10-25T10:00:00+01:00';
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('solde-budget-data-v1')));
  const setDay = (page, id, day) => page.evaluate(({ id, day }) => {
    state.recurringModalOpen = true; rerender();
    const el = document.querySelector(`[data-recur-day="${id}"]`);
    el.value = String(day);
    el.dispatchEvent(new Event('change'));
  }, { id, day });

  test('J1 Décaler du 22 au 30 : prochaine échéance le 30 du même mois, sans transaction en plus', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-11-22'), anchorDay:22 }) ] }) }, async ({ page, errors }) => {
      await setDay(page, 'r1', 30);
      const d = await stored(page);
      assert.equal(d.recurring[0].nextDate, D('2026-11-30'));
      assert.equal(d.recurring[0].anchorDay, 30);
      assert.equal(d.transactions.length, 0);
      assert.deepEqual(errors, []);
    }));

  test('J2 Jour 31 : recalé au 30 en novembre puis 31 en décembre', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-11-22'), anchorDay:22 }) ] }) }, async ({ page }) => {
      await setDay(page, 'r1', 31);
      const r = (await stored(page)).recurring[0];
      assert.equal(r.nextDate, D('2026-11-30'));
      const dec = await page.evaluate((r) => addPeriod(r.nextDate, r.frequency, r.anchorDay).toISOString(), r);
      assert.equal(dec, D('2026-12-31'));
    }));

  test('J3 Les échéances modifiées ou ignorées suivent le nouveau jour', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-11-22'), anchorDay:22, exceptions:{
      [String(new Date(D('2026-11-22')).getTime())]: { amount:18 },
      [String(new Date(D('2026-12-22')).getTime())]: { skip:true },
    } }) ] }) }, async ({ page }) => {
      await setDay(page, 'r1', 28);
      const ex = (await stored(page)).recurring[0].exceptions;
      assert.deepEqual(Object.keys(ex).sort(), [String(new Date(D('2026-11-28')).getTime()), String(new Date(D('2026-12-28')).getTime())].sort());
      assert.equal(ex[String(new Date(D('2026-11-28')).getTime())].amount, 18);
    }));

  test('J3b Une échéance modifiée seulement en montant suit aussi le nouveau jour ; une date choisie à la main est gardée', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-11-22'), anchorDay:22, exceptions:{
      [String(new Date(D('2026-11-22')).getTime())]: { amount:18, date:D('2026-11-22') },
      [String(new Date(D('2026-12-22')).getTime())]: { amount:20, date:D('2026-12-03') },
    } }) ] }) }, async ({ page }) => {
      await setDay(page, 'r1', 15);
      const ex = (await stored(page)).recurring[0].exceptions;
      assert.equal(ex[String(new Date(D('2026-11-15')).getTime())].date, D('2026-11-15'));
      assert.equal(ex[String(new Date(D('2026-12-15')).getTime())].date, D('2026-12-03'));
    }));

  test('J5 Jour 31 avec une échéance de février 2028 (bissextile) modifiée en montant : recalée au 29, date suivie', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2028-02-15'), anchorDay:15, exceptions:{
      [String(new Date(D('2028-02-15')).getTime())]: { amount:18, date:D('2028-02-15') },
    } }) ] }) }, async ({ page }) => {
      await setDay(page, 'r1', 31);
      const r = (await stored(page)).recurring[0];
      assert.equal(r.nextDate, D('2028-02-29'));
      assert.equal(r.anchorDay, 31);
      const ex = r.exceptions[String(new Date(D('2028-02-29')).getTime())];
      assert.equal(ex.amount, 18);
      assert.equal(ex.date, D('2028-02-29'));
    }));

  test('J4 Avancer à un jour déjà passé : l’échéance du mois est générée une seule fois', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-10-26'), anchorDay:26 }) ] }) }, async ({ page, errors }) => {
      await setDay(page, 'r1', 20);
      const d = await stored(page);
      assert.equal(d.transactions.length, 1);
      assert.equal(d.transactions[0].date, D('2026-10-20'));
      assert.equal(d.recurring[0].nextDate, D('2026-11-20'));
      assert.deepEqual(errors, []);
    }));

  test('J5 « Annuler » rétablit l’ancien jour', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ nextDate:D('2026-11-22'), anchorDay:22 }) ] }) }, async ({ page }) => {
      await setDay(page, 'r1', 30);
      await page.evaluate(() => document.querySelector('[data-toast-undo]').click());
      const r = (await stored(page)).recurring[0];
      assert.equal(r.nextDate, D('2026-11-22'));
      assert.equal(r.anchorDay, 22);
    }));

  test('J6 Pas de sélecteur de jour pour une récurrence hebdomadaire', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ frequency:'weekly', nextDate:D('2026-10-30') }) ] }) }, async ({ page }) => {
      const n = await page.evaluate(() => { state.recurringModalOpen = true; rerender(); return document.querySelectorAll('[data-recur-day]').length; });
      assert.equal(n, 0);
    }));
  const setAmount = (page, id, v) => page.evaluate(({ id, v }) => {
    state.recurringModalOpen = true; rerender();
    const el = document.querySelector(`[data-recur-amount="${id}"]`);
    el.value = v;
    el.dispatchEvent(new Event('change'));
  }, { id, v });

  test('J7 Montant modifiable (virgule acceptée), passé et échéances modifiées inchangés, annulable', () =>
    withApp({ now:NOW_OCT, data: baseData({
      transactions:[ tx({ id:'t1', amount:1200, category:'salaire', type:'income', date:D('2026-10-05'), recurringId:'r1' }) ],
      recurring:[ rule({ type:'income', category:'salaire', amount:1200, nextDate:D('2026-11-05'), anchorDay:5,
        exceptions:{ [String(new Date(D('2026-12-05')).getTime())]: { amount:900 } } }) ] }) }, async ({ page, errors }) => {
      await setAmount(page, 'r1', '1 050,50');
      let d = await stored(page);
      assert.equal(d.recurring[0].amount, 1050.5);
      assert.equal(d.transactions[0].amount, 1200);
      assert.equal(Object.values(d.recurring[0].exceptions)[0].amount, 900);
      await page.evaluate(() => document.querySelector('[data-toast-undo]').click());
      d = await stored(page);
      assert.equal(d.recurring[0].amount, 1200);
      assert.deepEqual(errors, []);
    }));

  test('J8 Montant invalide refusé', () =>
    withApp({ now:NOW_OCT, data: baseData({ recurring:[ rule({ amount:65, nextDate:D('2026-11-30'), anchorDay:30 }) ] }) }, async ({ page }) => {
      await setAmount(page, 'r1', 'abc');
      await setAmount(page, 'r1', '0');
      assert.equal((await stored(page)).recurring[0].amount, 65);
    }));
});

test.describe('Solde après enveloppes', () => {
  const NOW_OCT = '2026-10-25T10:00:00+01:00';
  const data = (extra={}) => baseData(Object.assign({
    transactions:[
      tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-10-01') }),
      tx({ id:'c', amount:200, category:'alimentation', date:D('2026-10-10') }),
      tx({ id:'i', amount:100, category:'impx', date:D('2026-10-28') }),
    ],
    customCategories:[ { id:'impx', type:'expense', label:'Impôts test', color:'#8B7FD6' } ],
    budgets:{ alimentation:500, transport:100, impx:100, epargne:999 },
    recurring:[ rule({ id:'rv', type:'income', category:'salaire', amount:1000, nextDate:D('2026-11-05'), anchorDay:5 }) ],
    rolloverEnabled:false, lastRolloverCheck:'2026-9',
  }, extra));

  test('E1 Mois en cours (calcul) : Reste moins le reste des enveloppes, dépense connue non comptée deux fois', () =>
    withApp({ now:NOW_OCT, data: data() }, async ({ page, errors }) => {
      const r = await page.evaluate(() => { _forecastCache=null; const s = computeMonthStats(); return { bal:s.bal, after:s.balAfterEnv }; });
      assert.equal(r.bal, 2700);
      assert.equal(r.after, 2300);
      assert.deepEqual(errors, []);
    }));

  test('E2 Enveloppe dépassée : ne retire rien de plus', () =>
    withApp({ now:NOW_OCT, data: data({ transactions:[
      tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-10-01') }),
      tx({ id:'c', amount:700, category:'alimentation', date:D('2026-10-10') }) ] }) }, async ({ page }) => {
      const r = await page.evaluate(() => { _forecastCache=null; const s = computeMonthStats(); return { bal:s.bal, after:s.balAfterEnv }; });
      assert.equal(r.bal, 2300);
      assert.equal(r.after, 2300 - 100 - 100);
    }));

  test('E3 Prévisionnel : enveloppes de chaque mois déduites en cumul, valeur brute inchangée', () =>
    withApp({ now:NOW_OCT, data: data() }, async ({ page }) => {
      const p = await page.evaluate(() => { _forecastCache=null; const f = computeForecast(); return f.points.slice(0,2); });
      assert.equal(p[0].value, 3700);
      assert.equal(p[0].afterEnv, 3700 - 400 - 700);
      assert.equal(p[1].afterEnv, p[1].value - 400 - 700 - 700);
    }));

  test('E4 La case « Après enveloppes » n’est plus affichée sur l’accueil', () =>
    withApp({ now:NOW_OCT, data: data() }, async ({ page }) => {
      const n = await page.evaluate(() => document.querySelectorAll('[data-after-env]').length);
      assert.equal(n, 0);
    }));
});

test.describe('Catégorie d’une récurrence', () => {
  const NOW_OCT = '2026-10-26T10:00:00+01:00';
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('solde-budget-data-v1')));
  const data = () => baseData({
    customCategories:[ { id:'assur', type:'expense', label:'Assurance', color:'#7C89A6' } ],
    transactions:[ tx({ id:'t1', amount:154, category:'transport', date:D('2026-10-08'), recurringId:'r1' }) ],
    recurring:[ rule({ amount:154, category:'transport', nextDate:D('2026-11-08'), anchorDay:8 }) ],
  });
  const setCat = (page, v) => page.evaluate((v) => {
    state.recurringModalOpen = true; rerender();
    const el = document.querySelector('[data-recur-cat="r1"]');
    el.value = v; el.dispatchEvent(new Event('change'));
  }, v);

  test('K1 Changer la catégorie : la règle change, le passé non, annulable', () =>
    withApp({ now:NOW_OCT, data: data() }, async ({ page, errors }) => {
      await setCat(page, 'assur');
      let d = await stored(page);
      assert.equal(d.recurring[0].category, 'assur');
      assert.equal(d.transactions[0].category, 'transport');
      const prev = await page.evaluate(() => recurringPreviewForMonth(2026, 10).find(e=>e.ruleId==='r1').category);
      assert.equal(prev, 'assur');
      await page.evaluate(() => document.querySelector('[data-toast-undo]').click());
      d = await stored(page);
      assert.equal(d.recurring[0].category, 'transport');
      assert.deepEqual(errors, []);
    }));

  test('K2 Le sélecteur ne propose ni épargne ni virement', () =>
    withApp({ now:NOW_OCT, data: data() }, async ({ page }) => {
      const opts = await page.evaluate(() => { state.recurringModalOpen = true; rerender();
        return [...document.querySelectorAll('[data-recur-cat="r1"] option')].map(o=>o.value); });
      assert.ok(opts.includes('assur') && opts.includes('transport'));
      assert.ok(!opts.includes('epargne') && !opts.includes('virement'));
    }));
});

test.describe('Nouvelle page d’accueil', () => {
  const NOW = '2026-11-12T10:00:00+01:00';
  const data = () => baseData({
    budgets:{ alimentation:500, loisirs:100, transport:80 },
    transactions:[
      tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-11-01') }),
      tx({ id:'a', amount:200, category:'alimentation', date:D('2026-11-05') }),
      tx({ id:'t', amount:100, category:'transport', date:D('2026-11-06') }),
      tx({ id:'m', amount:154, category:'transport', date:D('2026-11-08'), recurringId:'rm' }),
    ],
    recurring:[ rule({ id:'rm', amount:154, category:'transport', nextDate:D('2026-12-08'), anchorDay:8 }),
                rule({ id:'ri', type:'income', amount:50, category:'salaire', note:'Revenu test', nextDate:D('2026-11-15'), anchorDay:15 }),
                rule({ id:'rc', amount:20, category:'abonnements', note:'Charge test', nextDate:D('2026-11-18'), anchorDay:18 }) ],
    goals:[ { id:'g1', name:'Objectif test', target:1000, current:250, color:'#6FA287', accountId:'main' } ],
  });

  test('A1 Solde de fin de mois seul (sans libellé en double) ; enveloppes sans les récurrences', () =>
    withApp({ now:NOW, data: data() }, async ({ page, errors }) => {
      const r = await page.evaluate(() => {
        const s = computeMonthStats(); const env = envelopeStatus(2026, 10);
        const app = document.getElementById('app').innerHTML;
        return { bal:s.bal, after:s.balAfterEnv, rem:env.remaining, tr:env.rows.find(x=>x.id==='transport'),
          hasReste: app.includes('Fin de mois') && !!document.getElementById('balanceNum') && !app.includes('Reste estimé'), hasAfter: !document.querySelector('[data-after-env]'),
          envCard: !!document.querySelector('[data-envelopes]'), goal: app.includes('Objectif test') };
      });
      assert.equal(r.tr.spent, 100);
      assert.equal(r.tr.over, 20);
      assert.equal(r.rem, 300 + 100);
      assert.equal(r.after, r.bal - 400);
      assert.ok(r.hasReste && r.hasAfter && r.envCard && r.goal);
      assert.deepEqual(errors, []);
    }));

  test('A4 Le mois en bref : solde au 1er = fin du mois précédent', () =>
    withApp({ now:'2026-11-27T10:00:00+01:00', data: baseData({
      budgets:{ alimentation:500 },
      transactions:[
        tx({ id:'o', type:'income', amount:1000, category:'salaire', date:D('2026-10-01') }),
        tx({ id:'oe', amount:1250, category:'alimentation', date:D('2026-10-05') }),
        tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-11-01') }),
        tx({ id:'aj', type:'income', amount:20, category:'ajustement', date:D('2026-11-20') }),
      ],
      recurring:[ rule({ id:'fin', amount:30, category:'abonnements', note:'Fin de mois', nextDate:D('2026-11-29'), anchorDay:29 }),
                  rule({ id:'dec', amount:40, category:'abonnements', note:'Debut decembre', nextDate:D('2026-12-03'), anchorDay:3 }) ],
    }) }, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ start: computeMonthStats().startBal,
        line: document.querySelector('[data-month-start]').textContent.replace(/\s+/g,' ') }));
      assert.equal(r.start, -250);
      assert.match(r.line, /Solde au 1er novembre/);
      assert.match(r.line, /ajustements \+20/);
      assert.deepEqual(errors, []);
    }));

  test('A2 Plus de cadre des échéances sur l’accueil ; alerte découvert seule si besoin', () =>
    withApp({ now:NOW, data: data() }, async ({ page, errors }) => {
      const r = await page.evaluate(() => ({ watch: !!document.querySelector('[data-watch]'), od: !!document.querySelector('[data-overdraft]') }));
      assert.equal(r.watch, false);
      assert.equal(r.od, false);
      assert.deepEqual(errors, []);
    }));

  test('A3 Le graphique 12 mois est dans l’onglet Transactions, plus sur l’accueil', () =>
    withApp({ now:NOW, data: data() }, async ({ page }) => {
      const r = await page.evaluate(() => ({ dash: renderDashboard().includes('Revenus vs dépenses'), tx: renderTransactions().includes('Revenus vs dépenses') }));
      assert.equal(r.dash, false);
      assert.equal(r.tx, true);
    }));
});

test.describe('Mois en bref : épargne prévue', () => {
  test('B1 Virement auto vers un objectif pas encore passé : compté en épargne prévue, pas en dépense ; Reste inchangé', () =>
    withApp({ now:'2026-11-03T10:00:00+01:00', data: baseData({
      transactions:[ tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-11-01') }) ],
      goals:[ { id:'g1', name:'Objectif test', target:5000, current:0, color:'#6FA287', accountId:'main' } ],
      goalTransfers:[ { id:'gt', goalId:'g1', amount:500, frequency:'monthly', nextDate:D('2026-11-09'), anchorDay:9 } ],
    }) }, async ({ page, errors }) => {
      const r = await page.evaluate(() => { const s = computeMonthStats(); return { exp:s.expense, saved:s.savedThisMonth, bal:s.bal }; });
      assert.equal(r.exp, 0);
      assert.equal(r.saved, 500);
      assert.equal(r.bal, 2500);
      assert.deepEqual(errors, []);
    }));

  test('B2 Virement auto déjà passé : compté une seule fois en épargne, jamais en dépense ; un retrait d’épargne le réduit', () =>
    withApp({ now:'2026-11-12T10:00:00+01:00', data: baseData({
      transactions:[
        tx({ id:'s', type:'income', amount:3000, category:'salaire', date:D('2026-11-01') }),
        tx({ id:'e', amount:500, category:'epargne', date:D('2026-11-09') }),
        tx({ id:'r', type:'income', amount:100, category:'epargne_retour', date:D('2026-11-10') }),
      ],
      goals:[ { id:'g1', name:'Objectif test', target:5000, current:400, color:'#6FA287', accountId:'main' } ],
      goalTransfers:[ { id:'gt', goalId:'g1', amount:500, frequency:'monthly', nextDate:D('2026-12-09'), anchorDay:9 } ],
    }) }, async ({ page, errors }) => {
      const r = await page.evaluate(() => { const s = computeMonthStats(); return { exp:s.expense, saved:s.savedThisMonth, planned:s.plannedSaving }; });
      assert.equal(r.planned, 0);
      assert.equal(r.exp, 0);
      assert.equal(r.saved, 400);
      assert.deepEqual(errors, []);
    }));

  test('B3 Mois futur : le virement auto est de l’épargne prévue, les dépenses ne contiennent que les vraies charges', () =>
    withApp({ now:'2026-11-12T10:00:00+01:00', data: baseData({
      recurring:[ rule({ amount:20, category:'abonnements', nextDate:D('2026-12-18'), anchorDay:18 }) ],
      goals:[ { id:'g1', name:'Objectif test', target:5000, current:0, color:'#6FA287', accountId:'main' } ],
      goalTransfers:[ { id:'gt', goalId:'g1', amount:300, frequency:'monthly', nextDate:D('2026-12-09'), anchorDay:9 } ],
    }) }, async ({ page, errors }) => {
      const r = await page.evaluate(() => { state.viewY = 2026; state.viewM = 11; const s = computeMonthStats(); return { exp:s.expense, saved:s.savedThisMonth, fut:s.isFuture }; });
      assert.equal(r.fut, true);
      assert.equal(r.exp, 20);
      assert.equal(r.saved, 300);
      assert.deepEqual(errors, []);
    }));
});
