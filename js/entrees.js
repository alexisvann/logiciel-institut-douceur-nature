import {
  db, $, $$, esc, chf, fmtDate, todayISO, monthRange, state, monthBarHtml, bindMonthBar,
  MOYENS, libelleEntree, q, openModal, closeModal, confirmer, toast, messageErreur, refresh,
} from './lib.js';

const TABS = [['service', 'Services'], ['produit', 'Produits'], ['bon_cadeau', 'Bons cadeaux']];

export async function render(root, sub) {
  if (!TABS.some(([k]) => k === sub)) sub = 'service';
  const isBons = sub === 'bon_cadeau';
  let rows;
  const soldes = {};

  if (isBons) {
    const [ventes, bons] = await Promise.all([
      q(db.from('entrees').select('*').eq('type', 'bon_cadeau').order('date_service', { ascending: false })),
      q(db.from('bons_cadeaux').select('id,solde')),
    ]);
    bons.forEach((b) => { soldes[b.id] = Number(b.solde); });
    rows = ventes;
  } else {
    const [from, to] = monthRange(state.mois);
    // visibles : saisis dans le mois, payés dans le mois, ou encore en attente
    const filtre = `and(date_service.gte.${from},date_service.lte.${to}),and(paye_le.gte.${from},paye_le.lte.${to}),paye_le.is.null`;
    rows = await q(db.from('entrees').select('*').eq('type', sub).or(filtre)
      .order('date_service', { ascending: false }).order('created_at', { ascending: false }));
  }

  root.innerHTML = `
    <div class="page-head"><h1>Entrées</h1><button class="btn primary" id="add">+ Ajouter</button></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/entrees/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${isBons
      ? `<p class="muted">Vendre un bon est une entrée d’argent. Quand le bon sert à payer, choisissez « Bon cadeau » comme moyen de paiement : le solde baisse automatiquement.</p>`
      : monthBarHtml()}
    <div class="list">${rows.length ? rows.map((r) => ligne(r, soldes)).join('') : '<p class="empty">Rien pour le moment.</p>'}</div>`;

  bindMonthBar(root);
  $('#add').onclick = () => formulaire(sub);
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((r) => r.id === b.dataset.edit)); });
  $$('[data-del]', root).forEach((b) => { b.onclick = () => supprimer(rows.find((r) => r.id === b.dataset.del)); });
}

function ligne(r, soldes) {
  const paye = r.paye_le
    ? `<span class="badge ok">Payé le ${fmtDate(r.paye_le)}</span>`
    : '<span class="badge warn">En attente</span>';
  let bon = '';
  if (r.type === 'bon_cadeau') {
    const s = soldes[r.id] ?? 0;
    bon = s > 0 ? `<span class="badge info">Solde ${chf(s)}</span>` : '<span class="badge">Épuisé</span>';
  }
  const meta = [fmtDate(r.date_service), r.moyen ? MOYENS[r.moyen] : '', r.type === 'produit' && r.quantite ? `×${r.quantite}` : '']
    .filter(Boolean).map(esc).join(' · ');
  return `
    <div class="item">
      <div class="item-main">
        <strong>${esc(libelleEntree(r))}</strong>
        <small>${meta}</small>
        <div class="badges">${paye}${bon}</div>
      </div>
      <div class="item-amount">${chf(r.montant)}</div>
      <div class="item-actions">
        <button class="btn small" data-edit="${r.id}">Modifier</button>
        <button class="btn small danger-o" data-del="${r.id}">Supprimer</button>
      </div>
    </div>`;
}

async function supprimer(r) {
  if (!await confirmer(`Supprimer « ${libelleEntree(r)} » (${chf(r.montant)}) ?`)) return;
  try {
    await q(db.from('entrees').delete().eq('id', r.id));
    toast('Entrée supprimée');
    refresh();
  } catch (e) {
    toast(messageErreur(e), true);
  }
}

async function formulaire(type, e = null) {
  const [produits, bons, historique] = await Promise.all([
    type === 'produit' ? q(db.from('produits').select('*').eq('type', 'vente').order('nom')) : [],
    type !== 'bon_cadeau' ? q(db.from('bons_cadeaux').select('*').order('date_vente')) : [],
    type === 'service'
      ? q(db.from('entrees').select('libelle,montant').eq('type', 'service').order('date_service', { ascending: false }).limit(300))
      : [],
  ]);

  // prestations déjà saisies : proposées avec leur dernier prix
  const prix = new Map();
  historique.forEach((h) => { if (!prix.has(h.libelle)) prix.set(h.libelle, Number(h.montant)); });

  const bonsDispo = bons
    .map((b) => ({ ...b, dispo: Number(b.solde) + (e && e.bon_id === b.id ? Number(e.montant) : 0) }))
    .filter((b) => b.dispo > 0);

  const estBon = type === 'bon_cadeau';
  const titre = `${e ? 'Modifier' : 'Ajouter'} – ${{ service: 'service', produit: 'vente de produit', bon_cadeau: 'vente de bon cadeau' }[type]}`;
  const payeInitial = e ? !!e.paye_le : true;

  const m = openModal(titre, `
    <form id="f" class="form">
      <label>Date du ${type === 'service' ? 'service' : 'jour'}
        <input type="date" name="date_service" required value="${e?.date_service || todayISO()}">
      </label>

      ${type === 'service' ? `
        <label>Prestation
          <input name="libelle" list="prestations" required autocomplete="off" value="${esc(e?.libelle)}" placeholder="Ex. Pose gel, soin du visage…">
          <datalist id="prestations">${[...prix.keys()].map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist>
        </label>` : ''}

      ${type === 'produit' ? `
        <label>Produit
          <select name="produit_id">
            <option value="">Autre produit (hors stock)</option>
            ${produits.map((p) => `<option value="${p.id}" ${e?.produit_id === p.id ? 'selected' : ''}>${esc(p.nom)} (stock : ${p.quantite})</option>`).join('')}
          </select>
        </label>
        <label id="row-libelle">Désignation<input name="libelle" autocomplete="off" value="${esc(e?.libelle)}"></label>
        <label id="row-qte">Quantité<input type="number" name="quantite" min="1" step="1" value="${e?.quantite || 1}"></label>` : ''}

      ${estBon ? `
        <label>Bon pour<input name="libelle" required autocomplete="off" value="${esc(e?.libelle)}" placeholder="Ex. Marie Dupont"></label>` : ''}

      <label>Montant (CHF)
        <input type="number" name="montant" required min="0.05" step="0.05" inputmode="decimal" value="${e ? Number(e.montant).toFixed(2) : ''}">
      </label>

      <fieldset>
        <legend>Paiement</legend>
        <label class="check">
          <input type="checkbox" name="paye" ${payeInitial || estBon ? 'checked' : ''} ${estBon ? 'disabled' : ''}>
          Payé ${estBon ? '(la vente d’un bon est payée tout de suite)' : ''}
        </label>
        <label id="row-paye-le">Payé le<input type="date" name="paye_le" value="${e?.paye_le || (payeInitial ? todayISO() : '')}"></label>
        <label>Moyen de paiement<select name="moyen"></select></label>
        <label id="row-bon">Bon cadeau utilisé
          <select name="bon_id">
            ${bonsDispo.map((b) => `<option value="${b.id}" ${e?.bon_id === b.id ? 'selected' : ''}>${esc(b.libelle)} – solde ${chf(b.dispo)}</option>`).join('')}
          </select>
        </label>
      </fieldset>

      <label>Remarque (facultatif)<textarea name="note" rows="2">${esc(e?.note)}</textarea></label>

      <div class="actions">
        <button type="button" class="btn" id="annuler">Annuler</button>
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`);

  const f = $('#f', m);
  const moyenSel = f.moyen;
  const estPaye = () => estBon || f.paye.checked;

  // Le moyen est obligatoire dès que « payé » ; « bon cadeau » n'existe que si payé tout de suite
  function majPaiement(garder = moyenSel.value) {
    const paye = estPaye();
    const options = Object.entries(MOYENS).filter(([k]) => k !== 'bon_cadeau' || (paye && !estBon && bonsDispo.length));
    moyenSel.innerHTML = `<option value="">${paye ? '— Choisir —' : 'Pas encore défini'}</option>`
      + options.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
    moyenSel.value = options.some(([k]) => k === garder) ? garder : '';
    moyenSel.required = paye;
    $('#row-paye-le', m).hidden = !paye;
    f.paye_le.required = paye;
    if (paye && !f.paye_le.value) f.paye_le.value = todayISO();
    $('#row-bon', m).hidden = moyenSel.value !== 'bon_cadeau';
  }
  majPaiement(e?.moyen || '');

  f.paye.onchange = () => majPaiement();
  moyenSel.onchange = () => majPaiement();

  // « payé le » suit la date tant qu'on n'y a pas touché
  let payeLeModifie = !!e;
  f.paye_le.oninput = () => { payeLeModifie = true; };
  f.date_service.oninput = () => { if (!payeLeModifie && estPaye()) f.paye_le.value = f.date_service.value; };

  if (type === 'service') {
    f.libelle.onchange = () => {
      if (prix.has(f.libelle.value) && !f.montant.value) f.montant.value = prix.get(f.libelle.value).toFixed(2);
    };
  }

  if (type === 'produit') {
    const majProduit = (init) => {
      const p = produits.find((x) => x.id === f.produit_id.value);
      $('#row-libelle', m).hidden = !!p;
      $('#row-qte', m).hidden = !p;
      f.libelle.required = !p;
      if (p && !init) {
        f.libelle.value = p.nom;
        if (p.prix_vente != null) f.montant.value = (Number(p.prix_vente) * (Number(f.quantite.value) || 1)).toFixed(2);
      }
      if (p && init && !f.libelle.value) f.libelle.value = p.nom;
    };
    f.produit_id.onchange = () => majProduit(false);
    f.quantite.oninput = () => majProduit(false);
    majProduit(true);
  }

  $('#annuler', m).onclick = closeModal;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const paye = estPaye();
    const moyen = moyenSel.value || null;
    if (paye && !moyen) return toast('Choisissez le moyen de paiement.', true);
    const produitId = type === 'produit' && f.produit_id.value ? f.produit_id.value : null;
    const payload = {
      type,
      date_service: f.date_service.value,
      libelle: f.libelle.value.trim(),
      montant: Number(f.montant.value),
      paye_le: paye ? f.paye_le.value : null,
      moyen,
      bon_id: moyen === 'bon_cadeau' ? f.bon_id.value : null,
      produit_id: produitId,
      quantite: produitId ? Number(f.quantite.value) : null,
      note: f.note.value.trim() || null,
    };
    const bouton = f.querySelector('[type=submit]');
    bouton.disabled = true;
    try {
      await q(e ? db.from('entrees').update(payload).eq('id', e.id) : db.from('entrees').insert(payload));
      closeModal();
      toast('Entrée enregistrée');
      refresh();
    } catch (err) {
      toast(messageErreur(err), true);
      bouton.disabled = false;
    }
  };
}
