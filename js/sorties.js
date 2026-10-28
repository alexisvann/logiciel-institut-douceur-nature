import {
  db, $, $$, esc, chf, fmtDate, fmtCourt, pad, todayISO, monthRange, state, monthBarHtml, bindMonthBar, chips,
  MOYENS, CATEGORIES_SORTIE, FREQUENCES, q, openModal, closeModal, confirmer, toast, messageErreur, refresh,
  envoyerPiece, urlsPieces, supprimerFichiers,
} from './lib.js';

const TABS = [['fixe', 'Fixes'], ['flexible', 'Flexibles'], ['stock', 'Stock']];
const MOYENS_SORTIE = ['cash', 'carte', 'twint', 'virement'];
const CLIP = '<svg class="pj" viewBox="0 0 24 24"><path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-3-3L15 8.5"/></svg>';

export async function render(root, sub) {
  if (!TABS.some(([k]) => k === sub)) sub = 'fixe';
  const [from, to] = monthRange(state.mois);
  const cats = sub === 'stock' ? ['stock_cabine', 'stock_vente'] : [sub];
  const rows = await q(db.from('sorties').select('*, pieces(id)').in('categorie', cats)
    .gte('date', from).lte('date', to).order('date', { ascending: false }).order('created_at', { ascending: false }));

  root.innerHTML = `
    <div class="page-head"><h1>Sorties</h1><button class="btn primary small" id="add">+ Ajouter</button></div>
    <div class="seg tabs">${TABS.map(([k, l]) => `<a href="#/sorties/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${monthBarHtml()}
    <div class="card" style="margin-top:.8rem">${rows.length ? rows.map((r) => ligne(r, sub)).join('') : '<p class="empty">Rien pour ce mois.</p>'}</div>
    ${sub === 'fixe' ? '<p class="foot"><button class="link" id="modeles">Charges fixes récurrentes</button></p>' : ''}`;

  bindMonthBar(root);
  $('#add').onclick = () => formulaire(sub);
  if (sub === 'fixe') $('#modeles').onclick = () => gererModeles();
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((r) => r.id === b.dataset.edit)); });
}

function ligne(r, sub) {
  const prevu = r.statut === 'prevu';
  const nb = r.pieces?.length || 0;
  const meta = [fmtCourt(r.date), sub === 'stock' ? CATEGORIES_SORTIE[r.categorie] : '', r.moyen ? MOYENS[r.moyen] : '']
    .filter(Boolean).map(esc).join(' · ');
  return `
    <button class="row" data-edit="${r.id}">
      <span class="row-main">
        <span class="row-title">${esc(r.libelle)}</span>
        <span class="row-sub">${meta}${nb ? ` · ${CLIP}` : ''}</span>
      </span>
      <span class="row-end">
        <span class="amount">${prevu ? '≈ ' : ''}${chf(r.montant)}</span>
        ${prevu ? '<span class="tag warn">À valider</span>' : ''}
      </span>
    </button>`;
}

async function supprimer(r) {
  if (!await confirmer(`Supprimer « ${r.libelle} » (${chf(r.montant)}) et ses justificatifs ?`)) return;
  try {
    const pieces = await q(db.from('pieces').select('chemin').eq('sortie_id', r.id));
    await supprimerFichiers(pieces.map((p) => p.chemin));
    await q(db.from('sorties').delete().eq('id', r.id));
    toast('Sortie supprimée');
    refresh();
  } catch (e) {
    toast(messageErreur(e), true);
  }
}

async function formulaire(tab, s = null) {
  const estStock = tab === 'stock';
  const [produits, pieces] = await Promise.all([
    estStock && !s ? q(db.from('produits').select('id,nom,type').order('nom')) : [],
    s ? q(db.from('pieces').select('*').eq('sortie_id', s.id).order('created_at')) : [],
  ]);
  const urls = await urlsPieces(pieces);
  const categorie = s?.categorie || (estStock ? 'stock_cabine' : tab);
  const retirees = new Set();
  const nouvelles = [];

  const titre = s ? (s.statut === 'prevu' ? 'Valider la charge' : 'Modifier la sortie') : 'Nouvelle sortie';
  const moyensListe = [['', 'Aucun'], ...MOYENS_SORTIE.map((k) => [k, MOYENS[k]])];

  const m = openModal(titre, `
    <form id="f" class="form">
      <label class="field"><span>Description</span>
        <input name="libelle" required autocomplete="off" value="${esc(s?.libelle)}" placeholder="Ex. Migros – décorations">
      </label>
      <div class="field-row">
        <label class="field"><span>Montant (CHF)</span>
          <input type="number" name="montant" required min="0" step="0.05" inputmode="decimal" value="${s ? Number(s.montant).toFixed(2) : ''}">
        </label>
        <label class="field"><span>Date</span><input type="date" name="date" required value="${s?.date || todayISO()}"></label>
      </div>
      ${estStock ? `
        <div class="field"><span>Type de stock</span>
          ${chips('categorie', [['stock_cabine', 'Cabine (usage interne)'], ['stock_vente', 'Vente (revendu)']], categorie)}
        </div>` : ''}

      <div class="field"><span>Justificatifs</span>
        <div id="pieces" class="pieces"></div>
        <div class="row-btns">
          <label class="btn file small">Prendre une photo<input type="file" id="photo" accept="image/*" capture="environment" hidden></label>
          <label class="btn file small">Choisir un fichier<input type="file" id="fichiers" accept="image/*,application/pdf" multiple hidden></label>
        </div>
      </div>

      <details class="more" ${s?.moyen || s?.note ? 'open' : ''}>
        <summary>Plus d’options</summary>
        <div class="form">
          <div class="field"><span>Moyen de paiement</span>${chips('moyen', moyensListe, s?.moyen || '')}</div>
          ${estStock && !s ? `
            <div class="field-row">
              <label class="field"><span>Ajouter au stock</span><select name="stock_produit"></select></label>
              <label class="field"><span>Quantité reçue</span><input type="number" name="stock_qte" min="1" step="1" value="1"></label>
            </div>` : ''}
          <label class="field"><span>Remarque</span><textarea name="note" rows="2">${esc(s?.note)}</textarea></label>
        </div>
      </details>

      <div class="form-foot">
        ${s ? '<button type="button" class="link danger" id="supprimer">Supprimer</button>' : '<span></span>'}
        <button type="submit" class="btn primary">${s?.statut === 'prevu' ? 'Valider' : 'Enregistrer'}</button>
      </div>
    </form>`);

  const f = $('#f', m);

  function dessinerPieces() {
    const existantes = pieces.filter((p) => !retirees.has(p.id)).map((p) => {
      const url = urls[p.chemin];
      const apercu = p.chemin.endsWith('.pdf') || !url ? '<span class="pdf">PDF</span>' : `<img src="${esc(url)}" alt="Justificatif">`;
      return `<div class="piece"><a href="${esc(url || '#')}" target="_blank" rel="noopener">${apercu}</a><button type="button" class="icon" data-rm-old="${p.id}" aria-label="Retirer">✕</button></div>`;
    });
    const ajoutees = nouvelles.map((file, i) => `
      <div class="piece"><span class="pdf">${esc(file.name.slice(0, 16))}</span><button type="button" class="icon" data-rm-new="${i}" aria-label="Retirer">✕</button></div>`);
    $('#pieces', m).innerHTML = [...existantes, ...ajoutees].join('');
    $$('[data-rm-old]', m).forEach((b) => { b.onclick = () => { retirees.add(b.dataset.rmOld); dessinerPieces(); }; });
    $$('[data-rm-new]', m).forEach((b) => { b.onclick = () => { nouvelles.splice(Number(b.dataset.rmNew), 1); dessinerPieces(); }; });
  }
  dessinerPieces();

  const ajouter = (input) => { nouvelles.push(...input.files); input.value = ''; dessinerPieces(); };
  $('#photo', m).onchange = (ev) => ajouter(ev.target);
  $('#fichiers', m).onchange = (ev) => ajouter(ev.target);

  if (estStock && !s) {
    const majProduits = () => {
      const type = f.elements.categorie.value === 'stock_cabine' ? 'cabine' : 'vente';
      f.stock_produit.innerHTML = '<option value="">— Aucun —</option>'
        + produits.filter((p) => p.type === type).map((p) => `<option value="${p.id}">${esc(p.nom)}</option>`).join('');
    };
    $$('input[name=categorie]', f).forEach((r) => { r.onchange = majProduits; });
    majProduits();
  }

  if (s) $('#supprimer', m).onclick = () => supprimer(s);

  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const bouton = f.querySelector('[type=submit]');
    bouton.disabled = true;
    const payload = {
      date: f.date.value,
      libelle: f.libelle.value.trim(),
      montant: Number(f.montant.value),
      categorie: estStock ? f.elements.categorie.value : categorie,
      statut: 'paye',
      moyen: f.elements.moyen.value || null,
      note: f.note.value.trim() || null,
    };
    try {
      let id = s?.id;
      if (s) await q(db.from('sorties').update(payload).eq('id', id));
      else id = (await q(db.from('sorties').insert(payload).select('id').single())).id;

      for (const file of nouvelles) await envoyerPiece(id, file);

      const aRetirer = pieces.filter((p) => retirees.has(p.id));
      if (aRetirer.length) {
        await supprimerFichiers(aRetirer.map((p) => p.chemin));
        await q(db.from('pieces').delete().in('id', aRetirer.map((p) => p.id)));
      }

      if (estStock && !s && f.stock_produit.value) {
        await q(db.rpc('ajuster_stock', { p_id: f.stock_produit.value, p_delta: Number(f.stock_qte.value) || 0 }));
      }
      closeModal();
      toast('Enregistré');
      refresh();
    } catch (err) {
      toast(messageErreur(err), true);
      bouton.disabled = false;
    }
  };
}

// ---------- charges fixes récurrentes ----------
function occurrences(debut, fin, frequence) {
  const pas = { mensuelle: 1, trimestrielle: 3, annuelle: 12 }[frequence];
  const [y, m, d] = debut.split('-').map(Number);
  const dates = [];
  for (let k = 0; k < 600; k++) {
    const total = (m - 1) + k * pas;
    const an = y + Math.floor(total / 12);
    const mois = total % 12;
    const dernier = new Date(an, mois + 1, 0).getDate();
    const iso = `${an}-${pad(mois + 1)}-${pad(Math.min(d, dernier))}`;
    if (iso > fin) break;
    dates.push(iso);
  }
  return dates;
}

async function gererModeles(editId = null) {
  const modeles = await q(db.from('charges_fixes').select('*').order('libelle'));
  const e = modeles.find((x) => x.id === editId) || null;
  const annee = new Date().getFullYear();

  const m = openModal('Charges fixes récurrentes', `
    <p class="hint">Créez un modèle (loyer, électricité…) avec sa période : les lignes « à valider » sont préparées. Le moment venu, il suffit de les valider avec le vrai montant et la facture.</p>
    ${modeles.length ? `<div class="card">${modeles.map((x) => `
      <button class="row" data-m-edit="${x.id}">
        <span class="row-main">
          <span class="row-title">${esc(x.libelle)}</span>
          <span class="row-sub">${FREQUENCES[x.frequence]} · ${fmtDate(x.date_debut)} → ${fmtDate(x.date_fin)}</span>
        </span>
        <span class="row-end"><span class="amount">${chf(x.montant)}</span></span>
      </button>`).join('')}</div>` : ''}
    <h3>${e ? 'Modifier le modèle' : 'Nouveau modèle'}</h3>
    <form id="fm" class="form">
      <label class="field"><span>Libellé</span><input name="libelle" required value="${esc(e?.libelle)}" placeholder="Ex. Électricité"></label>
      <div class="field-row">
        <label class="field"><span>Montant estimé (CHF)</span><input type="number" name="montant" required min="0" step="0.05" inputmode="decimal" value="${e ? Number(e.montant).toFixed(2) : ''}"></label>
        <label class="field"><span>Fréquence</span>
          <select name="frequence">${Object.entries(FREQUENCES).map(([k, l]) => `<option value="${k}" ${e?.frequence === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
      </div>
      <div class="field-row">
        <label class="field"><span>Première échéance</span><input type="date" name="date_debut" required value="${e?.date_debut || `${annee}-01-01`}"></label>
        <label class="field"><span>Jusqu’au</span><input type="date" name="date_fin" required value="${e?.date_fin || `${annee}-12-31`}"></label>
      </div>
      <div class="form-foot">
        ${e ? '<button type="button" class="link danger" id="m-del">Supprimer ce modèle</button>' : '<span></span>'}
        <button type="submit" class="btn primary">${e ? 'Enregistrer' : 'Créer'}</button>
      </div>
      ${e ? '<button type="button" class="link" id="nouveau" style="justify-self:center">Annuler la modification</button>' : ''}
    </form>`);

  $$('[data-m-edit]', m).forEach((b) => { b.onclick = () => gererModeles(b.dataset.mEdit); });
  if (e) $('#nouveau', m).onclick = () => gererModeles();

  if (e) {
    $('#m-del', m).onclick = async () => {
      if (!await confirmer(`Supprimer le modèle « ${e.libelle} » et ses lignes encore à valider ? Les lignes déjà payées sont conservées.`)) return;
      try {
        await q(db.from('sorties').delete().eq('modele_id', e.id).eq('statut', 'prevu'));
        await q(db.from('charges_fixes').delete().eq('id', e.id));
        toast('Modèle supprimé');
        refresh();
      } catch (err) {
        toast(messageErreur(err), true);
      }
    };
  }

  const f = $('#fm', m);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const data = {
      libelle: f.libelle.value.trim(),
      montant: Number(f.montant.value),
      frequence: f.frequence.value,
      date_debut: f.date_debut.value,
      date_fin: f.date_fin.value,
    };
    if (data.date_fin < data.date_debut) return toast('La date de fin est avant le début.', true);
    const bouton = f.querySelector('[type=submit]');
    bouton.disabled = true;
    try {
      let id = e?.id;
      if (e) {
        await q(db.from('charges_fixes').update(data).eq('id', id));
        await q(db.from('sorties').delete().eq('modele_id', id).eq('statut', 'prevu')
          .or(`date.lt.${data.date_debut},date.gt.${data.date_fin}`));
        await q(db.from('sorties').update({ libelle: data.libelle, montant: data.montant }).eq('modele_id', id).eq('statut', 'prevu'));
      } else {
        id = (await q(db.from('charges_fixes').insert(data).select('id').single())).id;
      }
      const lignes = occurrences(data.date_debut, data.date_fin, data.frequence).map((date) => ({
        date, libelle: data.libelle, montant: data.montant, categorie: 'fixe', statut: 'prevu', modele_id: id,
      }));
      if (lignes.length) await q(db.from('sorties').upsert(lignes, { onConflict: 'modele_id,date', ignoreDuplicates: true }));
      closeModal();
      toast(`${lignes.length} ligne(s) dans la période`);
      refresh();
    } catch (err) {
      toast(messageErreur(err), true);
      bouton.disabled = false;
    }
  };
}
