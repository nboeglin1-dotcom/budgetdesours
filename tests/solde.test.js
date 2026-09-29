// Tests automatiques Solde des Ours — node:test + Playwright (Chromium préinstallé).
// Lancement : NODE_PATH=$(npm root -g) node --test tests/
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
