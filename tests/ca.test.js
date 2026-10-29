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
      assert.deepEqual(ct, { target:4100, rate:0.375, months:{}, perso:{}, floor:1500, urssaf:0.23, persoBase:153, moto:697, motoEnd:'2027-08', shine:null });
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
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData() }, async ({ page, errors }) => {
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
    withApp({ now:'2026-11-10T19:00:00+01:00', data: baseData() }, async ({ page, errors }) => {
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
      await page.fill('#shineInput', '1 409,88');
      await page.click('[data-save-shine]');
      const p = await page.evaluate(() => shineTransferPlan());
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
    withApp({ now:'2026-12-05T12:00:00+01:00', data: baseData({ caTracker:{ months:{ '2026-11':4000 }, shine:{ amount:2000, after:true, date:'2026-12-05' } } }) }, async ({ page }) => {
      const p = await page.evaluate(() => shineTransferPlan());
      assert.equal(p.payM, 11);
      assert.equal(p.perso, 850);
      assert.equal(p.commun, 0);
      assert.equal(p.short, 350);
    }));

  test('CA9 Après la fin du crédit moto (août 2027) : perso 153 €, sans remboursement moto', () =>
    withApp({ now:'2027-09-02T12:00:00+02:00', data: baseData({ caTracker:{ months:{ '2027-08':4000 }, shine:{ amount:1500, after:false, date:'2027-09-02' } } }) }, async ({ page }) => {
      const p = await page.evaluate(() => shineTransferPlan());
      assert.equal(p.motoActive, false);
      assert.equal(p.perso, 153);
      assert.equal(p.motoIn, 0);
      // 1 500 + 1 500 × 0,77 − 153 − 1 500 = 1 002 → 1 000
      assert.equal(p.commun, 1000);
    }));

  test('CA10 Ancien taux de 21,2 % enregistré : corrigé à 23 % (cotisations + versement libératoire + CFP)', () =>
    withApp({ now:'2026-10-29T09:00:00+01:00', data: baseData({ caTracker:{ urssaf:0.212 } }) }, async ({ page }) => {
      assert.equal(await page.evaluate(() => state.data.caTracker.urssaf), 0.23);
    }));

  test('CA5 Réglages : objectif et pourcentage modifiables, valeurs invalides refusées', () =>
    withApp({ now:'2026-10-28T10:00:00+01:00', data: baseData() }, async ({ page }) => {
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
});
