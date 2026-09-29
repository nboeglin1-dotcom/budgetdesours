// Harnais de test Solde des Ours : charge index.html dans Chromium (Playwright),
// avec une date figée, le fuseau Europe/Paris et des données injectées dans localStorage.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(process.env.SOLDE_HTML || path.join(ROOT, 'index.html'), 'utf8');
const ORIGIN = 'http://solde.test';
const KEY = 'solde-budget-data-v1';

let browser;
async function getBrowser(){
  if(!browser) browser = await chromium.launch();
  return browser;
}
async function closeBrowser(){ if(browser){ await browser.close(); browser = null; } }

// Données minimales : loadData() complète le reste. Aucune donnée réelle, tout est fictif.
function baseData(extra = {}){
  return Object.assign({
    transactions: [],
    budgets: {},
    goals: [],
    customCategories: [],
    recurring: [],
    security: { enabled:false, pin:null, useBiometric:false, credentialId:null },
    accounts: [{ id:'main', name:'Compte test', color:'#D4A94F' }],
    lastMonthlyRecapShown: 'skip',
  }, extra);
}

// now : chaîne ISO avec décalage (ex. '2026-09-15T10:00:00+02:00')
async function openApp({ now, data, shareCapture = false }){
  const b = await getBrowser();
  const context = await b.newContext({ timezoneId:'Europe/Paris', locale:'fr-FR' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    if(url === ORIGIN + '/' || url === ORIGIN + '/index.html'){
      return route.fulfill({ status:200, contentType:'text/html; charset=utf-8', body: HTML });
    }
    // CDN (pdf.js), polices, sw.js : neutralisés pour des tests hors réseau.
    return route.fulfill({ status:200, contentType:'text/plain', body:'' });
  });
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(({ KEY, json, shareCapture }) => {
    if(!sessionStorage.getItem('__seeded')){
      localStorage.clear();
      if(json) localStorage.setItem(KEY, json);
      sessionStorage.setItem('__seeded', '1');
    }
    // Pastille d'icône (App Badging API) : on enregistre les appels.
    window.__badge = [];
    navigator.setAppBadge = async (n) => { window.__badge.push(n); };
    navigator.clearAppBadge = async () => { window.__badge.push(0); };
    if(shareCapture){
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = async ({ files }) => { for(const f of files) window.__shared.push({ name:f.name, text: await f.text() }); };
    }
  }, { KEY, json: data ? JSON.stringify(data) : null, shareCapture });
  await page.goto(ORIGIN + '/index.html');
  await page.waitForFunction(() => document.getElementById('app') && document.getElementById('app').innerHTML.length > 0);
  return { page, context, errors, close: () => context.close() };
}

// Date locale Paris -> ISO (comme le fait l'appli avec new Date(y,m,d).toISOString())
function paris(y, m1, d, h = 12){
  // m1 = mois 1-12. Heure d'été approximée par Intl pour rester exact.
  const guess = new Date(Date.UTC(y, m1-1, d, h));
  const off = new Intl.DateTimeFormat('en-US',{ timeZone:'Europe/Paris', timeZoneName:'shortOffset' })
    .formatToParts(guess).find(p=>p.type==='timeZoneName').value; // "GMT+2"
  const hours = Number(off.replace('GMT','') || 0);
  return new Date(Date.UTC(y, m1-1, d, h - hours)).toISOString();
}

module.exports = { openApp, closeBrowser, baseData, paris, KEY };
