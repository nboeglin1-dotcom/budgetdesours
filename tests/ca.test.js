// Tests du suivi « Objectif de chiffre d'affaires » (onglet Objectifs). Données fictives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openApp, closeBrowser, baseData } = require('./harness');

test.after(closeBrowser);

async function withApp(opts, fn){
  const app = await openApp(opts);
  try{ await fn(app); } finally { await app.close(); }
}

test.describe('Objectif de CA', () => {
  test('CA1 Jours ouvrés : fériés français (Pâques comprise), 254 jours en 2027', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData() }, async ({ page, errors }) => {
      const r = await page.evaluate(() => {
        let y2027 = 0; for(let m=0; m<12; m++) y2027 += workingDaysInMonth(2027, m);
        return { y2027, nov26: workingDaysInMonth(2026,10), dec26: workingDaysInMonth(2026,11), mai27: workingDaysInMonth(2027,4), easter27: frHolidays(2027).has('2027-03-29') };
      });
      assert.deepEqual(r, { y2027:254, nov26:20, dec26:22, mai27:19, easter27:true });
      assert.deepEqual(errors, []);
    }));

  test('CA2 Données anciennes sans réglage : objectif 4 100 € et 37,5 % par défaut', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData() }, async ({ page }) => {
      const ct = await page.evaluate(() => state.data.caTracker);
      assert.deepEqual(ct, { target:4100, rate:0.375, months:{}, perso:{}, floor:1500, urssaf:0.23, persoBase:153, moto:697, motoEnd:'2027-08', bitstackDca:450, fuelPerDay:15, bitstackFrom:'2026-12', augustReserve:150, augustReserveFrom:'2027-01', shineMonths:{} });
    }));

  test('CA3 Mois en cours : reste à faire réparti sur les jours ouvrés après aujourd’hui', () =>
    withApp({ now:'2026-11-10T19:00:00+01:00', data: baseData({ caTracker:{ target:4100, rate:0.375, months:{ '2026-11':1100 } } }) }, async ({ page }) => {
      const s = await page.evaluate(() => caMonthStatus(2026, 10));
      // Du 11 au 30 novembre : 13 jours ouvrés (le 11 est férié).
      assert.equal(s.daysLeft, 13);
      assert.equal(s.remaining, 3000);
      assert.ok(Math.abs(s.perDay - 3000/13) < 0.01);
      assert.equal(s.payout, 412.5);
      assert.equal(s.reached, false);
    }));

  test('CA4 Saisie depuis l’onglet Objectifs : virgule acceptée, versement affiché', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData({ caTracker:{ enabled:true } }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      await page.fill('#caInput', '4 048,50');
      await page.click('[data-save-ca]');
      const v = await page.evaluate(() => state.data.caTracker.months['2026-10']);
      assert.equal(v, 4048.5);
      const txt = await page.textContent('.ca-card');
      assert.match(txt, /Reste 52\s€ · 2 jours ouvrés restants/);
      assert.match(txt, /1\s518/); // 4 048,50 × 0,375 ≈ 1 518 €
      assert.match(txt, /Net encaissé\s*≈ 1\s169\s€\s*1\s518\s€ avant URSSAF/); // visible même sans courses perso
      // Champ vidé = mois effacé
      await page.fill('#caInput', '');
      await page.click('[data-save-ca]');
      assert.equal(await page.evaluate(() => '2026-10' in state.data.caTracker.months), false);
      assert.deepEqual(errors, []);
    }));

  test('CA6 Courses perso : sans commission, converties en équivalent CA Skoot', () =>
    withApp({ now:'2026-11-10T19:00:00+01:00', data: baseData({ caTracker:{ enabled:true } }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      await page.fill('#caInput', '2000');
      await page.fill('#caPersoInput', '300');
      await page.click('[data-save-ca]');
      const s = await page.evaluate(() => caMonthStatus(2026, 10));
      assert.equal(s.skoot, 2000); assert.equal(s.perso, 300);
      assert.equal(s.ca, 2800);        // 2000 + 300 / 0,375
      assert.equal(s.payout, 750);     // la commission ne porte que sur Skoot
      assert.equal(s.totalIn, 1050);
      assert.equal(s.remaining, 1300);
      const txt = await page.textContent('.ca-card');
      assert.match(txt, /Dont courses perso/);
      // Vider seulement les courses perso garde le CA Skoot
      await page.fill('#caPersoInput', '');
      await page.click('[data-save-ca]');
      const ct = await page.evaluate(() => state.data.caTracker);
      assert.equal(ct.months['2026-11'], 2000);
      assert.equal('2026-11' in ct.perso, false);
      assert.deepEqual(errors, []);
    }));

  test('CA7 Virements du 5 : avant le versement Skoot, commun = ce qui laisse 1 500 € sur Shine', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData({ caTracker:{ months:{ '2026-10':4048 } } }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      // Objectifs d'octobre : on y voit les virements du 5 novembre (payés avec le CA d'octobre).
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 9; rerender(); });
      await page.fill('#shineInput', '1 409,88');
      await page.click('[data-save-shine]');
      const p = await page.evaluate(() => shineTransferPlan(2026, 10));
      // 1 409,88 + 1 518 × (1 − 23 %) + 697 − 850 − 1 500 = 925,74 → arrondi à 920
      assert.equal(p.perso, 850);
      assert.equal(p.commun, 920);
      assert.equal(p.payM, 10); // virements du 5 novembre
      assert.ok(p.shineAfter >= 1500);
      const txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Virements du 5 novembre/);
      assert.match(txt, /920\s€/);
      assert.deepEqual(errors, []);
    }));

  test('CA8 Versement déjà reçu : rien n’est ajouté ; sous le plancher, 0 € vers le commun', () =>
    withApp({ now:'2026-12-05T12:00:00+01:00', data: baseData({ caTracker:{ months:{ '2026-11':4000 }, shineMonths:{ '2026-12':{ amount:2000, after:true, date:'2026-12-05' } } } }) }, async ({ page }) => {
      const p = await page.evaluate(() => shineTransferPlan(2026, 11));
      assert.equal(p.payM, 11);
      assert.equal(p.perso, 400); // 850 − 450 de DCA, payé depuis Shine
      assert.equal(p.commun, 0);
      // 2 000 − 400 − Bitstack (450 + 22 jours × 15 = 780) − 1 500 = −680
      assert.equal(p.short, 680);
    }));

  test('CA9 Après la fin du crédit moto (août 2027) : perso 153 €, sans remboursement moto', () =>
    withApp({ now:'2027-09-02T12:00:00+02:00', data: baseData({ caTracker:{ months:{ '2027-08':4000 }, shineMonths:{ '2027-09':{ amount:1500, after:false, date:'2027-09-02' } } } }) }, async ({ page }) => {
      const p = await page.evaluate(() => shineTransferPlan(2027, 8));
      assert.equal(p.motoActive, false);
      assert.equal(p.perso, 0); // 153 − 450 de DCA : rien à virer au perso
      assert.equal(p.motoIn, 0);
      // 1 500 + 1 500 × 0,77 − 0 − Bitstack (450 + 22 jours × 15 = 780) − 1 500 = 375 → 370
      assert.equal(p.commun, 370);
    }));

  test('CA9c Réserve d’août : +150 € gardés sur Shine par mois de janvier à août, libérés le 5 septembre', () =>
    withApp({ now:'2027-03-02T12:00:00+01:00', data: baseData({ caTracker:{ floor:1600, months:{ '2026-12':4000, '2027-02':4000, '2027-07':4000, '2027-08':0 }, shineMonths:{
      '2027-01':{ amount:1600, after:false, date:'2027-01-02' }, '2027-03':{ amount:1900, after:false, date:'2027-03-02' },
      '2027-08':{ amount:2650, after:false, date:'2027-08-02' }, '2027-09':{ amount:2800, after:false, date:'2027-09-02' } } } }) }, async ({ page, errors }) => {
      const jan = await page.evaluate(() => shineTransferPlan(2027, 0));
      assert.equal(jan.reserve, 150);
      assert.equal(jan.reserveTarget, 1200);
      const mar = await page.evaluate(() => shineTransferPlan(2027, 2));
      assert.equal(mar.reserve, 450);
      const noRes = await page.evaluate(() => { const ct = state.data.caTracker; const o = ct.augustReserve; ct.augustReserve = 0; const p = shineTransferPlan(2027, 2); ct.augustReserve = o; return p; });
      assert.equal(noRes.commun - mar.commun, 450);
      assert.ok(mar.shineAfter >= 1600 + 450);
      const aug = await page.evaluate(() => shineTransferPlan(2027, 7));
      assert.equal(aug.reserve, 1200);
      const sep = await page.evaluate(() => shineTransferPlan(2027, 8));
      assert.equal(sep.reserve, 0);
      assert.equal(sep.reserveReleased, 1200);
      // Septembre : CA d'août à 0, crédit moto fini → 2 800 − 0 − 780 (450 + 22 × 15) − 1 600 = 420
      assert.equal(sep.commun, 420);
      await page.click('[data-tab="goals"]');
      await page.evaluate(() => { state.viewY = 2027; state.viewM = 1; rerender(); });
      const txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Mis de côté pour août\s*150\s€/);
      assert.match(txt, /réserve 450\s€ sur 1\s200\s€/);
      await page.evaluate(() => { state.viewY = 2027; state.viewM = 7; rerender(); });
      assert.match(await page.textContent('.ca-shine-card'), /Réserve d'août libérée/);
      assert.deepEqual(errors, []);
    }));

  test('CA9b Virement Bitstack du 5 : DCA + essence × jours ouvrés, le perso baisse du DCA, à partir de décembre 2026', () =>
    withApp({ now:'2026-12-02T12:00:00+01:00', data: baseData({ caTracker:{ floor:1600, months:{ '2026-10':4000, '2026-11':4000 }, shineMonths:{ '2026-11':{ amount:1500, after:false, date:'2026-11-02' }, '2026-12':{ amount:1500, after:false, date:'2026-12-02' } } } }) }, async ({ page, errors }) => {
      const nov = await page.evaluate(() => shineTransferPlan(2026, 10));
      assert.equal(nov.bitstackActive, false);
      assert.equal(nov.bitstack, 0);
      const dec = await page.evaluate(() => shineTransferPlan(2026, 11));
      assert.equal(dec.fuelDays, 22); // décembre 2026 : 23 jours de semaine moins Noël
      assert.equal(dec.fuel, 330);
      assert.equal(dec.dca, 450);
      assert.equal(dec.bitstack, 780);
      assert.equal(dec.perso, 400);
      // 1 500 + 1 500 × 0,77 + 697 − 400 − 780 − 1 600 = 572 → 570
      assert.equal(dec.commun, 570);
      assert.ok(dec.shineAfter >= 1600);
      await page.click('[data-tab="goals"]');
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 10; rerender(); });
      const txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Vers le LCL perso\s*400\s€/);
      assert.match(txt, /Vers Bitstack\s*780\s€/);
      assert.match(txt, /DCA 450\s€ \+ essence 330\s€ \(22 jours × 15\s€\)/);
      // Réglages : DCA à 500 €, essence à 16 €/jour
      await page.evaluate(() => document.querySelector('.ca-card details').open = true);
      await page.fill('#caDcaInput', '500');
      await page.fill('#caFuelInput', '16');
      await page.click('[data-save-ca-transfer-settings]');
      const after = await page.evaluate(() => shineTransferPlan(2026, 11));
      assert.equal(after.bitstack, 500 + 22 * 16);
      assert.equal(after.perso, 350);
      assert.deepEqual(errors, []);
    }));

  test('CA10 Ancien taux de 21,2 % enregistré : corrigé à 23 % (cotisations + versement libératoire + CFP)', () =>
    withApp({ now:'2026-10-29T09:00:00+01:00', data: baseData({ caTracker:{ urssaf:0.212 } }) }, async ({ page }) => {
      assert.equal(await page.evaluate(() => state.data.caTracker.urssaf), 0.23);
    }));

  test('CA5 Réglages : objectif et pourcentage modifiables, valeurs invalides refusées', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData({ caTracker:{ enabled:true } }) }, async ({ page }) => {
      await page.click('[data-tab="goals"]');
      await page.click('.ca-card summary');
      await page.fill('#caTargetInput', '4200');
      await page.fill('#caRateInput', '40');
      await page.click('[data-save-ca-settings]');
      let ct = await page.evaluate(() => state.data.caTracker);
      assert.equal(ct.target, 4200); assert.equal(ct.rate, 0.4);
      await page.click('.ca-card summary');
      await page.fill('#caRateInput', '150');
      await page.click('[data-save-ca-settings]');
      ct = await page.evaluate(() => state.data.caTracker);
      assert.equal(ct.rate, 0.4);
    }));

  test('CA11 Un solde par mois : novembre et décembre gardent chacun le leur', () =>
    withApp({ now:'2026-12-05T12:00:00+01:00', data: baseData({ caTracker:{ months:{ '2026-10':4047, '2026-11':4000 }, shineMonths:{ '2026-11':{ amount:3253.3, after:true, date:'2026-11-03' } } } }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      let txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Virements du 5 janvier 2027/);
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 10; rerender(); });
      txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Virements du 5 décembre/);
      assert.equal(await page.inputValue('#shineInput'), '');
      await page.fill('#shineInput', '2 900');
      await page.click('[data-save-shine]');
      const sm = await page.evaluate(() => state.data.caTracker.shineMonths);
      assert.equal(sm['2026-11'].amount, 3253.3);
      assert.equal(sm['2026-12'].amount, 2900);
      txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Soldes gardés : déc\.? 2026/i);
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 9; rerender(); });
      assert.equal(await page.inputValue('#shineInput'), '3253,3');
      assert.match(await page.textContent('.ca-shine-card'), /Virements du 5 novembre/);
      assert.deepEqual(errors, []);
    }));

  test('CA12 Ancien solde unique : rattaché au mois de virement qu’il calculait', () =>
    withApp({ now:'2026-11-03T15:00:00+01:00', data: baseData({ caTracker:{ shine:{ amount:3253.3, after:true, date:'2026-11-03' } } }) }, async ({ page }) => {
      const ct = await page.evaluate(() => state.data.caTracker);
      assert.equal('shine' in ct, false);
      assert.deepEqual(ct.shineMonths, { '2026-11':{ amount:3253.3, after:true, date:'2026-11-03' } });
    }));

  test('CA13 Ancien solde saisi après le 5, versement pas reçu : compté pour le mois suivant', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData({ caTracker:{ shine:{ amount:1409.88, after:false, date:'2026-10-28' } } }) }, async ({ page }) => {
      assert.deepEqual(Object.keys(await page.evaluate(() => state.data.caTracker.shineMonths)), ['2026-11']);
    }));

  test('CA15 Objectifs de novembre : virements du 5 décembre, calculés avec le CA de novembre', () =>
    withApp({ now:'2026-11-04T08:00:00+01:00', data: baseData({ caTracker:{ months:{ '2026-10':4047, '2026-11':1200 } } }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      let txt = await page.textContent('.ca-shine-card');
      assert.match(txt, /Virements du 5 décembre/);
      assert.match(txt, /CA de novembre/);
      await page.fill('#shineInput', '1 500');
      await page.click('[data-save-shine]');
      assert.deepEqual(Object.keys(await page.evaluate(() => state.data.caTracker.shineMonths)), ['2026-12']);
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 11; rerender(); });
      assert.match(await page.textContent('.ca-shine-card'), /Virements du 5 janvier 2027/);
      assert.deepEqual(errors, []);
    }));

  test('CA16 Courses perso enregistrées en décembre : le virement du 5 janvier suivant est resynchronisé (changement d’année)', () =>
    withApp({ now:'2026-12-10T10:00:00+01:00', data: baseData({
      caTracker:{ months:{ '2026-12':4000 }, shineMonths:{ '2027-01':{ amount:1500, after:false, date:'2026-12-10' } } },
      recurring:[{ id:'rs', type:'income', amount:1, category:'autres', note:'Virement Shine', frequency:'monthly', accountId:'main', nextDate:'2027-01-05T00:00:00.000Z' }]
    }) }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      await page.fill('#caPersoInput', '30');
      await page.click('[data-save-ca]');
      const r = await page.evaluate(() => ({ perso: state.data.caTracker.perso['2026-12'], amount: state.data.recurring[0].amount, commun: shineTransferPlan(2027, 0).commun }));
      assert.equal(r.perso, 30);
      assert.ok(r.commun > 0);
      assert.equal(r.amount, r.commun);
      assert.deepEqual(errors, []);
    }));

  test('CA14 Vider le champ efface seulement le mois affiché', () =>
    withApp({ now:'2026-12-05T12:00:00+01:00', data: baseData({ caTracker:{ shineMonths:{ '2026-11':{ amount:3253.3, after:true, date:'2026-11-03' }, '2026-12':{ amount:2900, after:true, date:'2026-12-05' } } } }) }, async ({ page }) => {
      await page.click('[data-tab="goals"]');
      await page.evaluate(() => { state.viewY = 2026; state.viewM = 10; rerender(); });
      await page.fill('#shineInput', '');
      await page.click('[data-save-shine]');
      assert.deepEqual(Object.keys(await page.evaluate(() => state.data.caTracker.shineMonths)), ['2026-11']);
    }));

});

test.describe('Suivi d’activité optionnel', () => {
  test('CA20 Sans CA saisi : pas de cartes CA ni virements dans Objectifs, lien pour activer', () =>
    withApp({ now:'2026-11-22T10:00:00+01:00', data: baseData() }, async ({ page, errors }) => {
      await page.click('[data-tab="goals"]');
      assert.equal(await page.$('.ca-card'), null);
      assert.equal(await page.$('.ca-shine-card'), null);
      await page.click('[data-enable-ca]');
      assert.ok(await page.$('.ca-card'));
      assert.equal(await page.$('[data-enable-ca]'), null);
      assert.deepEqual(errors, []);
    }));
});
