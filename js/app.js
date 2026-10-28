import { CONFIG } from '../config.js';
import { db, $, $$, esc, messageErreur } from './lib.js';
import * as dashboard from './dashboard.js';
import * as rapport from './rapport.js';
import * as entrees from './entrees.js';
import * as sorties from './sorties.js';
import * as stock from './stock.js';

const PAGES = { 'tableau-de-bord': dashboard, mois: rapport, entrees, sorties, stock };
// page affichée -> entrée de menu mise en avant
const MENU = { mois: 'tableau-de-bord' };

document.title = `Gestion – ${CONFIG.NOM_INSTITUT}`;
$('#brand').textContent = CONFIG.NOM_INSTITUT;
$('#login-titre').textContent = CONFIG.NOM_INSTITUT;

async function route() {
  const [, page, sub] = location.hash.split('/');
  const nom = PAGES[page] ? page : 'tableau-de-bord';
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.page === (MENU[nom] || nom)));
  const main = $('#main');
  try {
    await PAGES[nom].render(main, sub);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<p class="form-error">Impossible de charger la page : ${esc(messageErreur(e))}</p>`;
  }
}

function afficher(session) {
  $('#login').hidden = !!session;
  $('#app').hidden = !session;
  if (session) route();
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
window.addEventListener('refresh', route);

$('#login-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const err = $('#login-erreur');
  err.hidden = true;
  const { error } = await db.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
  if (error) {
    err.textContent = 'E-mail ou mot de passe incorrect.';
    err.hidden = false;
  }
};

$('#logout').onclick = () => db.auth.signOut();

db.auth.onAuthStateChange((_evt, session) => afficher(session));
db.auth.getSession().then(({ data }) => afficher(data.session));
