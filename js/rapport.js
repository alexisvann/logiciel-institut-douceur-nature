import { CONFIG } from '../config.js';
import {
  db, $, $$, esc, chf, sum, fmtDate, fmtCourt, monthRange, monthLabel, currentMonth, shiftMonth,
  MOYENS, MOYENS_ENCAISSES, CATEGORIES_SORTIE, libelleEntree, q, toast, messageErreur,
} from './lib.js';
import { exporterZip } from './export.js';

const COULEURS = { cash: '#2f7d57', carte: '#4a6fa5', twint: '#8a5cc2', virement: '#8b8285' };
const TYPES = [['service', 'Services'], ['produit', 'Produits'], ['bon_cadeau', 'Bons cadeaux vendus']];

// Page de détail d'un mois : c'est aussi le rapport imprimable.
export async function render(root, ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) ym = currentMonth();
  const [from, to] = monthRange(ym);

  const [payees, attente, sorties, bons] = await Promise.all([
    q(db.from('entrees').select('*').gte('paye_le', from).lte('paye_le', to).order('paye_le').order('created_at')),
    q(db.from('entrees').select('*').is('paye_le', null).lte('date_service', to).order('date_service')),
    q(db.from('sorties').select('*').gte('date', from).lte('date', to).order('date').order('created_at')),
    q(db.from('bons_cadeaux').select('solde')),
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

  const ligne = (label, valeur, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${chf(valeur)}</td></tr>`;

  root.innerHTML = `
    <div class="detail-bar no-print">
      <a class="back" href="#/tableau-de-bord">‹ Récap</a>
      <div class="bar-actions">
        <button class="btn small" id="zip">Exporter</button>
        <button class="btn small primary" id="imprimer">Imprimer / PDF</button>
      </div>
    </div>

    <article class="rapport">
      <header class="rapport-head">
        <div class="eyebrow">${esc(CONFIG.NOM_INSTITUT)} · Rapport mensuel</div>
        <div class="titre-mois">
          <a class="no-print" href="#/mois/${shiftMonth(ym, -1)}" aria-label="Mois précédent">‹</a>
          <h1>${esc(monthLabel(ym))}</h1>
          <a class="no-print" href="#/mois/${shiftMonth(ym, 1)}" aria-label="Mois suivant">›</a>
        </div>
      </header>

      <section class="stats">
        <div class="stat"><span>Encaissé</span><strong>${chf(totalEncaisse)}</strong></div>
        <div class="stat"><span>Sorties</span><strong>${chf(totalSorties)}</strong></div>
        <div class="stat ${resultat < 0 ? 'neg' : 'pos'}"><span>Résultat</span><strong>${chf(resultat)}</strong></div>
      </section>

      <section>
        <h2>Entrées par moyen de paiement</h2>
        <div class="method-cards">
          ${MOYENS_ENCAISSES.map((m) => `
            <div class="method">
              <span><i class="dot" style="background:${COULEURS[m]}"></i>${MOYENS[m]}</span>
              <strong>${chf(sum(encaisse.filter((e) => e.moyen === m)))}</strong>
            </div>`).join('')}
        </div>
        ${parBon.length ? `<p class="hint">Payé par bon cadeau : ${chf(sum(parBon))} (déjà encaissé à la vente du bon, non compté ci-dessus).</p>` : ''}
      </section>

      <div class="detail-grid">
        <section>
          <h2>Entrées par type</h2>
          <table class="resume">
            ${TYPES.map(([t, l]) => ligne(l, sum(encaisse.filter((e) => e.type === t)))).join('')}
            ${ligne('Total', totalEncaisse, 'total')}
          </table>
        </section>
        <section>
          <h2>Sorties par catégorie</h2>
          <table class="resume">
            ${Object.entries(CATEGORIES_SORTIE).map(([k, l]) => ligne(l, sum(sortiesPayees.filter((s) => s.categorie === k)))).join('')}
            ${ligne('Total', totalSorties, 'total')}
          </table>
        </section>
      </div>

      <section class="historiques">
        <details class="histo-box">
          <summary><span>Historique des entrées</span><span class="count">${payees.length}</span></summary>
          ${payees.length ? `
          <table class="histo">
            <thead><tr><th>Date</th><th>Libellé</th><th>Moyen</th><th class="num">CHF</th></tr></thead>
            <tbody>${payees.map((e) => `
              <tr><td>${fmtCourt(e.paye_le)}</td><td>${esc(libelleEntree(e))}</td><td>${MOYENS[e.moyen]}</td><td class="num">${chf(e.montant)}</td></tr>`).join('')}</tbody>
          </table>` : '<p class="muted">Aucune entrée ce mois.</p>'}
        </details>

        <details class="histo-box">
          <summary><span>Historique des sorties</span><span class="count">${sortiesPayees.length}</span></summary>
          ${sortiesPayees.length ? `
          <table class="histo">
            <thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th class="num">CHF</th></tr></thead>
            <tbody>${sortiesPayees.map((s) => `
              <tr><td>${fmtCourt(s.date)}</td><td>${esc(s.libelle)}</td><td>${CATEGORIES_SORTIE[s.categorie]}</td><td class="num">${chf(s.montant)}</td></tr>`).join('')}</tbody>
          </table>` : '<p class="muted">Aucune sortie ce mois.</p>'}
          ${sortiesPrevues.length ? `<p class="muted">Prévues, pas encore payées : ${esc(sortiesPrevues.map((s) => s.libelle).join(', '))}.</p>` : ''}
        </details>

        ${attente.length ? `
        <details class="histo-box">
          <summary><span>En attente de paiement</span><span class="count">${chf(sum(attente))}</span></summary>
          <table class="histo">
            <thead><tr><th>Date</th><th>Libellé</th><th class="num">CHF</th></tr></thead>
            <tbody>${attente.map((e) => `
              <tr><td>${fmtCourt(e.date_service)}</td><td>${esc(libelleEntree(e))}</td><td class="num">${chf(e.montant)}</td></tr>`).join('')}</tbody>
          </table>
        </details>` : ''}
      </section>

      <footer class="rapport-foot">
        Bons cadeaux en circulation : ${chf(bonsEnCirculation)} CHF · Édité le ${fmtDate(new Date().toISOString().slice(0, 10))}
      </footer>
    </article>`;

  // À l'impression, les historiques sont toujours dépliés
  const boites = $$('details', root);
  const etat = [];
  window.onbeforeprint = () => boites.forEach((d, i) => { etat[i] = d.open; d.open = true; });
  window.onafterprint = () => boites.forEach((d, i) => { d.open = !!etat[i]; });

  $('#imprimer').onclick = () => window.print();

  const bouton = $('#zip');
  bouton.onclick = async () => {
    const label = bouton.textContent;
    bouton.disabled = true;
    try {
      await exporterZip({ from, to, nom: `compta-${ym}.zip`, progression: (t) => { bouton.textContent = t; } });
      toast('Export téléchargé');
    } catch (e) {
      toast(messageErreur(e), true);
    } finally {
      bouton.textContent = label;
      bouton.disabled = false;
    }
  };
}
