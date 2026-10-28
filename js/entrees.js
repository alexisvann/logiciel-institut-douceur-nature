import {
  db, $, $$, esc, chf, fmtDate, fmtCourt, todayISO, monthRange, state, monthBarHtml, bindMonthBar, chips,
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
    <div class="page-head"><h1>Entrées</h1><button class="btn primary small" id="add">+ Ajouter</button></div>
    <div class="seg tabs">${TABS.map(([k, l]) => `<a href="#/entrees/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${isBons ? '' : monthBarHtml()}
    <div class="card" style="margin-top:.8rem">${rows.length ? rows.map((r) => ligne(r, soldes)).join('') : '<p class="empty">Rien pour le moment.</p>'}</div>
    ${isBons ? '<p class="hint" style="margin-top:.8rem">Quand un bon sert à payer, choisissez « Bon cadeau » comme moyen de paiement : le solde baisse tout seul.</p>' : ''}`;

  bindMonthBar(root);
  $('#add').onclick = () => formulaire(sub);
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((r) => r.id === b.dataset.edit)); });
}

function ligne(r, soldes) {
  const bon = r.type === 'bon_cadeau';
  const solde = soldes[r.id] ?? 0;
  const sub = bon
    ? [`Vendu le ${fmtDate(r.date_service)}`, r.moyen ? MOYENS[r.moyen] : '']
    : [
      fmtCourt(r.date_service),
      r.moyen ? MOYENS[r.moyen] : '',
      r.type === 'produit' && r.quantite > 1 ? `×${r.quantite}` : '',
      r.paye_le && r.paye_le !== r.date_service ? `payé le ${fmtCourt(r.paye_le)}` : '',
    ];
  const fin = bon
    ? `<span class="amount">${chf(solde)}</span><span class="tag">${solde > 0 ? `sur ${chf(r.montant)}` : 'Épuisé'}</span>`
    : `<span class="amount">${chf(r.montant)}</span>${r.paye_le ? '' : '<span class="tag warn">En attente</span>'}`;
  return `
    <button class="row ${bon && solde <= 0 ? 'faded' : ''}" data-edit="${r.id}">
      <span class="row-main">
        <span class="row-title">${esc(libelleEntree(r))}</span>
        <span class="row-sub">${sub.filter(Boolean).map(esc).join(' · ')}</span>
      </span>
      <span class="row-end">${fin}</span>
    </button>`;
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
  const titre = `${e ? 'Modifier' : 'Nouvelle'} ${{ service: 'prestation', produit: 'vente de produit', bon_cadeau: 'vente de bon cadeau' }[type]}`;
  const payeInitial = e ? !!e.paye_le : true;
  const moyensListe = [['', 'Aucun'], ...Object.entries(MOYENS)];

  const m = openModal(titre, `
    <form id="f" class="form">
      ${type === 'service' ? `
        <label class="field"><span>Prestation</span>
          <input name="libelle" list="prestations" required autocomplete="off" value="${esc(e?.libelle)}" placeholder="Ex. Pose gel, soin du visage…">
          <datalist id="prestations">${[...prix.keys()].map((k) => `<option value="${esc(k)}"></option>`).join('')}</datalist>
        </label>` : ''}

      ${type === 'produit' ? `
        <label class="field"><span>Produit</span>
          <select name="produit_id">
            <option value="">Autre produit (hors stock)</option>
            ${produits.map((p) => `<option value="${p.id}" ${e?.produit_id === p.id ? 'selected' : ''}>${esc(p.nom)} (stock : ${p.quantite})</option>`).join('')}
          </select>
        </label>
        <label class="field" id="row-libelle"><span>Désignation</span><input name="libelle" autocomplete="off" value="${esc(e?.libelle)}"></label>
        <label class="field" id="row-qte"><span>Quantité</span><input type="number" name="quantite" min="1" step="1" value="${e?.quantite || 1}"></label>` : ''}

      ${estBon ? `
        <label class="field"><span>Bon pour</span><input name="libelle" required autocomplete="off" value="${esc(e?.libelle)}" placeholder="Ex. Marie Dupont"></label>` : ''}

      <div class="field-row">
        <label class="field"><span>Montant (CHF)</span>
          <input type="number" name="montant" required min="0.05" step="0.05" inputmode="decimal" value="${e ? Number(e.montant).toFixed(2) : ''}">
        </label>
        <label class="field"><span>Date</span><input type="date" name="date_service" required value="${e?.date_service || todayISO()}"></label>
      </div>

      ${estBon ? '' : `
        <div class="seg" style="justify-self:start">
          <label><input type="radio" name="statut" value="paye" ${payeInitial ? 'checked' : ''}><span>Payé</span></label>
          <label><input type="radio" name="statut" value="attente" ${payeInitial ? '' : 'checked'}><span>En attente</span></label>
        </div>`}

      <label class="field" id="row-paye-le"><span>Payé le</span><input type="date" name="paye_le" value="${e?.paye_le || (payeInitial ? todayISO() : '')}"></label>

      <div class="field"><span id="moyen-label">Moyen de paiement</span>${chips('moyen', moyensListe, e?.moyen || '')}</div>

      <label class="field" id="row-bon"><span>Bon utilisé</span>
        <select name="bon_id">
          ${bonsDispo.map((b) => `<option value="${b.id}" ${e?.bon_id === b.id ? 'selected' : ''}>${esc(b.libelle)} – solde ${chf(b.dispo)}</option>`).join('')}
        </select>
      </label>

      <details class="more" ${e?.note ? 'open' : ''}>
        <summary>Remarque</summary>
        <label class="field"><textarea name="note" rows="2">${esc(e?.note)}</textarea></label>
      </details>

      <div class="form-foot">
        ${e ? '<button type="button" class="link danger" id="supprimer">Supprimer</button>' : '<span></span>'}
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`);

  const f = $('#f', m);
  const estPaye = () => estBon || f.elements.statut.value === 'paye';
  const moyenVal = () => f.elements.moyen.value;

  // « Payé » => moyen obligatoire (vérifié à l'envoi) ; « bon cadeau » seulement si payé tout de suite
  function majPaiement() {
    const paye = estPaye();
    $$('input[name=moyen]', f).forEach((r) => {
      const cache = (r.value === '' && paye) || (r.value === 'bon_cadeau' && !(paye && !estBon && bonsDispo.length));
      r.closest('.chip').hidden = cache;
      if (cache && r.checked) r.checked = false;
    });
    $('#moyen-label', m).textContent = paye ? 'Moyen de paiement' : 'Moyen prévu (facultatif)';
    $('#row-paye-le', m).hidden = !paye;
    f.paye_le.required = paye;
    if (paye && !f.paye_le.value) f.paye_le.value = todayISO();
    $('#row-bon', m).hidden = moyenVal() !== 'bon_cadeau';
  }
  majPaiement();

  $$('input[name=statut]', f).forEach((r) => { r.onchange = majPaiement; });
  $$('input[name=moyen]', f).forEach((r) => { r.onchange = majPaiement; });

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

  if (e) $('#supprimer', m).onclick = () => supprimer(e);

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const paye = estPaye();
    const moyen = moyenVal() || null;
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
      toast('Enregistré');
      refresh();
    } catch (err) {
      toast(messageErreur(err), true);
      bouton.disabled = false;
    }
  };
}
