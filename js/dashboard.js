import { CONFIG } from '../config.js';
import {
  db, $, esc, chf, sum, fmtDate, monthRange, monthLabel, state, monthBarHtml, bindMonthBar, numero,
  MOYENS, MOYENS_ENCAISSES, CATEGORIES_SORTIE, TYPES_ENTREE_LABELS, libelleEntree, q, toast, messageErreur,
} from './lib.js';
import { exporterZip } from './export.js';

const TYPES_ENCAISSES = ['service', 'produit', 'bon_cadeau'];

export async function render(root) {
  const ym = state.mois;
  const [from, to] = monthRange(ym);

  const [payees, attente, sorties, bons, produits] = await Promise.all([
    q(db.from('entrees').select('*').gte('paye_le', from).lte('paye_le', to).order('paye_le').order('numero')),
    q(db.from('entrees').select('*').is('paye_le', null).lte('date_service', to).order('date_service')),
    q(db.from('sorties').select('*, pieces(id)').gte('date', from).lte('date', to).order('date').order('numero')),
    q(db.from('bons_cadeaux').select('solde')),
    q(db.from('produits').select('nom,type,quantite,seuil_alerte')),
  ]);

  // Argent réellement encaissé = tout sauf ce qui est payé avec un bon (déjà encaissé à la vente du bon)
  const encaisse = payees.filter((e) => e.moyen !== 'bon_cadeau');
  const parBon = payees.filter((e) => e.moyen === 'bon_cadeau');
  const totalEncaisse = sum(encaisse);
  const sortiesPayees = sorties.filter((s) => s.statut === 'paye');
  const sortiesPrevues = sorties.filter((s) => s.statut === 'prevu');
  const totalSorties = sum(sortiesPayees);
  const resultat = totalEncaisse - totalSorties;
  const bonsEnCirculation = sum(bons, (b) => b.solde);
  const stockBas = produits.filter((p) => p.seuil_alerte > 0 && p.quantite <= p.seuil_alerte);

  const ligneTotal = (label, valeur, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${chf(valeur)}</td></tr>`;

  root.innerHTML = `
    <div class="page-head no-print"><h1>Tableau de bord</h1></div>
    ${monthBarHtml()}

    <div class="toolbar no-print">
      <button class="btn primary" id="imprimer">🖨 Imprimer / PDF</button>
      <button class="btn" id="zip-mois">⬇ Export du mois (ZIP)</button>
      <button class="btn" id="zip-tout">⬇ Sauvegarde complète</button>
    </div>

    ${stockBas.length ? `
      <div class="alerte no-print">
        <strong>Stock bas :</strong> ${stockBas.map((p) => `${esc(p.nom)} (${p.quantite})`).join(', ')}
        — <a href="#/stock">voir le stock</a>
      </div>` : ''}

    <article class="rapport">
      <header class="rapport-head">
        <h1>Rapport mensuel – ${esc(monthLabel(ym))}</h1>
        <p>${esc(CONFIG.NOM_INSTITUT)}</p>
      </header>

      <section class="kpis">
        <div class="kpi"><span>Encaissé</span><strong>${chf(totalEncaisse)}</strong></div>
        <div class="kpi"><span>Sorties</span><strong>${chf(totalSorties)}</strong></div>
        <div class="kpi ${resultat < 0 ? 'neg' : 'pos'}"><span>Résultat</span><strong>${chf(resultat)}</strong></div>
      </section>

      <section>
        <h2>Encaissé par moyen de paiement</h2>
        <table class="resume">
          ${MOYENS_ENCAISSES.map((m) => ligneTotal(MOYENS[m], sum(encaisse.filter((e) => e.moyen === m)))).join('')}
          ${ligneTotal('Total encaissé', totalEncaisse, 'total')}
          ${ligneTotal('Payé par bon cadeau (information, déjà encaissé à la vente du bon)', sum(parBon), 'info')}
        </table>
      </section>

      <section>
        <h2>Entrées par type</h2>
        <table class="resume">
          ${TYPES_ENCAISSES.map((t) => ligneTotal(t === 'bon_cadeau' ? 'Bons cadeaux vendus' : `${TYPES_ENTREE_LABELS[t]}s`, sum(encaisse.filter((e) => e.type === t)))).join('')}
          ${ligneTotal('Total', totalEncaisse, 'total')}
        </table>
      </section>

      <section>
        <h2>Sorties par catégorie</h2>
        <table class="resume">
          ${Object.entries(CATEGORIES_SORTIE).map(([k, l]) => ligneTotal(l, sum(sortiesPayees.filter((s) => s.categorie === k)))).join('')}
          ${ligneTotal('Total sorties', totalSorties, 'total')}
        </table>
      </section>

      <section>
        <h2>Historique des entrées</h2>
        ${payees.length ? `
        <table class="histo">
          <thead><tr><th>Payé le</th><th>Date</th><th>Libellé</th><th>Moyen</th><th class="num">CHF</th><th>N°</th></tr></thead>
          <tbody>${payees.map((e) => `
            <tr>
              <td>${fmtDate(e.paye_le)}</td><td>${fmtDate(e.date_service)}</td><td>${esc(libelleEntree(e))}</td>
              <td>${MOYENS[e.moyen]}</td><td class="num">${chf(e.montant)}</td><td>${numero('E', e.numero)}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Aucune entrée payée ce mois.</p>'}
      </section>

      ${attente.length ? `
      <section>
        <h2>À encaisser (en attente de paiement) – ${chf(sum(attente))} CHF</h2>
        <table class="histo">
          <thead><tr><th>Date</th><th>Libellé</th><th>Moyen prévu</th><th class="num">CHF</th></tr></thead>
          <tbody>${attente.map((e) => `
            <tr><td>${fmtDate(e.date_service)}</td><td>${esc(libelleEntree(e))}</td><td>${e.moyen ? MOYENS[e.moyen] : '—'}</td><td class="num">${chf(e.montant)}</td></tr>`).join('')}</tbody>
        </table>
      </section>` : ''}

      <section>
        <h2>Historique des sorties</h2>
        ${sortiesPayees.length ? `
        <table class="histo">
          <thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="num">CHF</th><th>N°</th><th>Pièces</th></tr></thead>
          <tbody>${sortiesPayees.map((s) => `
            <tr>
              <td>${fmtDate(s.date)}</td><td>${esc(s.libelle)}</td><td>${CATEGORIES_SORTIE[s.categorie]}</td>
              <td class="num">${chf(s.montant)}</td><td>${numero('S', s.numero)}</td><td>${s.pieces?.length || '—'}</td>
            </tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Aucune sortie payée ce mois.</p>'}
        ${sortiesPrevues.length ? `<p class="muted">${sortiesPrevues.length} charge(s) fixe(s) prévue(s) pas encore payée(s) : ${esc(sortiesPrevues.map((s) => s.libelle).join(', '))}.</p>` : ''}
      </section>

      <footer class="rapport-foot">
        Bons cadeaux en circulation (non utilisés) : ${chf(bonsEnCirculation)} CHF · Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}
      </footer>
    </article>`;

  bindMonthBar(root);
  $('#imprimer').onclick = () => window.print();

  const lancer = (bouton, params) => async () => {
    const label = bouton.textContent;
    bouton.disabled = true;
    try {
      await exporterZip({ ...params, progression: (t) => { bouton.textContent = t; } });
      toast('Export téléchargé');
    } catch (e) {
      toast(messageErreur(e), true);
    } finally {
      bouton.textContent = label;
      bouton.disabled = false;
    }
  };
  $('#zip-mois').onclick = lancer($('#zip-mois'), { from, to, nom: `compta-${ym}.zip` });
  $('#zip-tout').onclick = lancer($('#zip-tout'), { from: '1900-01-01', to: '2999-12-31', nom: `sauvegarde-complete-${new Date().toISOString().slice(0, 10)}.zip` });
}
