import {
  db, $, esc, chf, currentMonth, monthName, q, toast, messageErreur,
} from './lib.js';
import { exporterZip } from './export.js';

// Récap : une simple liste de mois. Le détail est sur la page du mois (rapport.js).
export async function render(root) {
  let resumes;
  try {
    resumes = await q(db.from('resume_mensuel').select('*'));
  } catch (e) {
    if (/resume_mensuel/.test(e.message || '')) {
      root.innerHTML = `
        <div class="page-head"><h1>Récap</h1></div>
        <p class="empty">La base doit être mise à jour : relancez <strong>schema.sql</strong> dans le SQL Editor de Supabase (voir README).</p>`;
      return;
    }
    throw e;
  }
  const produits = await q(db.from('produits').select('nom,quantite,seuil_alerte'));
  const aRacheter = produits.filter((p) => p.seuil_alerte > 0 && p.quantite <= p.seuil_alerte);

  const mois = new Map(resumes.map((r) => [r.mois, { encaisse: Number(r.encaisse), sorties: Number(r.sorties) }]));
  const actuel = currentMonth();
  if (!mois.has(actuel)) mois.set(actuel, { encaisse: 0, sorties: 0 });
  const liste = [...mois.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const parAnnee = new Map();
  liste.forEach(([ym, v]) => {
    const an = ym.slice(0, 4);
    if (!parAnnee.has(an)) parAnnee.set(an, []);
    parAnnee.get(an).push([ym, v]);
  });

  const ligne = ([ym, v]) => {
    const resultat = v.encaisse - v.sorties;
    return `
      <a class="row" href="#/mois/${ym}">
        <span class="row-main">
          <span class="row-title">${esc(monthName(ym))}</span>
          <span class="row-sub">Encaissé ${chf(v.encaisse)} · Sorties ${chf(v.sorties)}</span>
        </span>
        <span class="row-end"><span class="amount ${resultat < 0 ? 'neg' : resultat > 0 ? 'pos' : ''}">${chf(resultat)}</span></span>
        <svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
      </a>`;
  };

  root.innerHTML = `
    <div class="page-head"><h1>Récap</h1></div>
    ${aRacheter.length ? `<a class="notice" href="#/stock">À racheter : ${esc(aRacheter.map((p) => p.nom).join(', '))}</a>` : ''}
    ${[...parAnnee.entries()].map(([an, lignes]) => `
      <h2 class="year">${an}</h2>
      <div class="card">${lignes.map(ligne).join('')}</div>`).join('')}
    <p class="foot"><button class="link" id="sauvegarde">Télécharger une sauvegarde complète</button></p>`;

  const bouton = $('#sauvegarde');
  bouton.onclick = async () => {
    const label = bouton.textContent;
    bouton.disabled = true;
    try {
      await exporterZip({
        from: '1900-01-01', to: '2999-12-31',
        nom: `sauvegarde-complete-${new Date().toISOString().slice(0, 10)}.zip`,
        progression: (t) => { bouton.textContent = t; },
      });
      toast('Sauvegarde téléchargée');
    } catch (e) {
      toast(messageErreur(e), true);
    } finally {
      bouton.textContent = label;
      bouton.disabled = false;
    }
  };
}
