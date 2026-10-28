import {
  db, $, $$, esc, chf, fmtDate, pad, todayISO, monthRange, state, monthBarHtml, bindMonthBar,
  MOYENS, CATEGORIES_SORTIE, FREQUENCES, q, openModal, closeModal, confirmer, toast, messageErreur, refresh,
  envoyerPiece, urlsPieces, supprimerFichiers,
} from './lib.js';

const TABS = [['fixe', 'Fixes'], ['flexible', 'Flexibles'], ['stock', 'Stock']];
const MOYENS_SORTIE = ['cash', 'carte', 'twint', 'virement'];

export async function render(root, sub) {
  if (!TABS.some(([k]) => k === sub)) sub = 'fixe';
  const [from, to] = monthRange(state.mois);
  const cats = sub === 'stock' ? ['stock_cabine', 'stock_vente'] : [sub];
  const rows = await q(db.from('sorties').select('*, pieces(id)').in('categorie', cats)
    .gte('date', from).lte('date', to).order('date', { ascending: false }).order('created_at', { ascending: false }));

  root.innerHTML = `
    <div class="page-head"><h1>Sorties</h1><button class="btn primary" id="add">+ Ajouter</button></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/sorties/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${monthBarHtml()}
    ${sub === 'fixe' ? `<p class="muted">Loyer, électricité, assurances… <button class="link" id="modeles">Gérer les charges fixes récurrentes</button></p>` : ''}
    <div class="list">${rows.length ? rows.map((r) => ligne(r, sub)).join('') : '<p class="empty">Rien pour ce mois.</p>'}</div>`;

  bindMonthBar(root);
  $('#add').onclick = () => formulaire(sub);
  if (sub === 'fixe') $('#modeles').onclick = () => gererModeles();
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((r) => r.id === b.dataset.edit)); });
  $$('[data-del]', root).forEach((b) => { b.onclick = () => supprimer(rows.find((r) => r.id === b.dataset.del)); });
}

function ligne(r, sub) {
  const prevu = r.statut === 'prevu';
  const meta = [fmtDate(r.date), sub === 'stock' ? CATEGORIES_SORTIE[r.categorie] : '', r.moyen ? MOYENS[r.moyen] : '']
    .filter(Boolean).map(esc).join(' · ');
  const nb = r.pieces?.length || 0;
  return `
    <div class="item">
      <div class="item-main">
        <strong>${esc(r.libelle)}</strong>
        <small>${meta}</small>
        <div class="badges">
          ${prevu ? '<span class="badge warn">Prévu</span>' : '<span class="badge ok">Payé</span>'}
          ${nb ? `<span class="badge">📎 ${nb}</span>` : ''}
        </div>
      </div>
      <div class="item-amount">${prevu ? '≈ ' : ''}${chf(r.montant)}</div>
      <div class="item-actions">
        <button class="btn small ${prevu ? 'primary' : ''}" data-edit="${r.id}">${prevu ? 'Valider' : 'Modifier'}</button>
        <button class="btn small danger-o" data-del="${r.id}">Supprimer</button>
      </div>
    </div>`;
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
  const peutEtrePrevu = categorie === 'fixe';
  const retirees = new Set();
  const nouvelles = [];

  const m = openModal(`${s ? (s.statut === 'prevu' ? 'Valider' : 'Modifier') : 'Ajouter'} – sortie`, `
    <form id="f" class="form">
      <label>Date<input type="date" name="date" required value="${s?.date || todayISO()}"></label>
      <label>Fournisseur / description
        <input name="libelle" required autocomplete="off" value="${esc(s?.libelle)}" placeholder="Ex. Migros – décorations">
      </label>
      <label>Montant (CHF)
        <input type="number" name="montant" required min="0" step="0.05" inputmode="decimal" value="${s ? Number(s.montant).toFixed(2) : ''}">
      </label>
      ${estStock ? `
        <label>Type de stock
          <select name="categorie">
            <option value="stock_cabine" ${categorie === 'stock_cabine' ? 'selected' : ''}>Stock cabine (usage interne)</option>
            <option value="stock_vente" ${categorie === 'stock_vente' ? 'selected' : ''}>Stock vente (revendu)</option>
          </select>
        </label>` : ''}
      <label>Moyen de paiement (facultatif)
        <select name="moyen">
          <option value="">—</option>
          ${MOYENS_SORTIE.map((k) => `<option value="${k}" ${s?.moyen === k ? 'selected' : ''}>${MOYENS[k]}</option>`).join('')}
        </select>
      </label>
      ${peutEtrePrevu ? `
        <label class="check"><input type="checkbox" name="paye" ${!s || s.statut === 'paye' ? 'checked' : ''}> Payé (décochez si c’est encore une charge prévue)</label>` : ''}

      <fieldset>
        <legend>Justificatifs (ticket, facture)</legend>
        <div id="pieces" class="pieces"></div>
        <div class="row-btns">
          <label class="btn file">📷 Prendre une photo<input type="file" id="photo" accept="image/*" capture="environment" hidden></label>
          <label class="btn file">📁 Choisir des fichiers<input type="file" id="fichiers" accept="image/*,application/pdf" multiple hidden></label>
        </div>
      </fieldset>

      ${estStock && !s ? `
        <fieldset id="bloc-stock">
          <legend>Ajouter au stock (facultatif)</legend>
          <label>Produit<select name="stock_produit"></select></label>
          <label>Quantité reçue<input type="number" name="stock_qte" min="1" step="1" value="1"></label>
        </fieldset>` : ''}

      <label>Remarque (facultatif)<textarea name="note" rows="2">${esc(s?.note)}</textarea></label>

      <div class="actions">
        <button type="button" class="btn" id="annuler">Annuler</button>
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`);

  const f = $('#f', m);

  function dessinerPieces() {
    const existantes = pieces.filter((p) => !retirees.has(p.id)).map((p) => {
      const url = urls[p.chemin];
      const pdf = p.chemin.endsWith('.pdf');
      const apercu = pdf || !url ? '<span class="pdf">PDF</span>' : `<img src="${esc(url)}" alt="Justificatif">`;
      return `<div class="piece"><a href="${esc(url || '#')}" target="_blank" rel="noopener">${apercu}</a><button type="button" class="icon" data-rm-old="${p.id}" aria-label="Retirer">✕</button></div>`;
    });
    const ajoutees = nouvelles.map((file, i) => `
      <div class="piece new"><span class="pdf">${esc(file.name.slice(0, 18))}</span><button type="button" class="icon" data-rm-new="${i}" aria-label="Retirer">✕</button></div>`);
    $('#pieces', m).innerHTML = [...existantes, ...ajoutees].join('') || '<small class="muted">Aucun justificatif</small>';
    $$('[data-rm-old]', m).forEach((b) => { b.onclick = () => { retirees.add(b.dataset.rmOld); dessinerPieces(); }; });
    $$('[data-rm-new]', m).forEach((b) => { b.onclick = () => { nouvelles.splice(Number(b.dataset.rmNew), 1); dessinerPieces(); }; });
  }
  dessinerPieces();

  const ajouter = (input) => { nouvelles.push(...input.files); input.value = ''; dessinerPieces(); };
  $('#photo', m).onchange = (ev) => ajouter(ev.target);
  $('#fichiers', m).onchange = (ev) => ajouter(ev.target);

  if (estStock && !s) {
    const majProduits = () => {
      const type = f.categorie.value === 'stock_cabine' ? 'cabine' : 'vente';
      f.stock_produit.innerHTML = '<option value="">— Aucun —</option>'
        + produits.filter((p) => p.type === type).map((p) => `<option value="${p.id}">${esc(p.nom)}</option>`).join('');
    };
    f.categorie.onchange = majProduits;
    majProduits();
  }

  $('#annuler', m).onclick = closeModal;
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const bouton = f.querySelector('[type=submit]');
    bouton.disabled = true;
    const payload = {
      date: f.date.value,
      libelle: f.libelle.value.trim(),
      montant: Number(f.montant.value),
      categorie: estStock ? f.categorie.value : categorie,
      statut: peutEtrePrevu && !f.paye.checked ? 'prevu' : 'paye',
      moyen: f.moyen.value || null,
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
      toast('Sortie enregistrée');
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
    <p class="muted">Créez un modèle (électricité, loyer…) et choisissez la période : toutes les lignes « prévues » sont préparées. Le moment venu, il suffit de les valider avec le vrai montant et la facture.</p>
    <div class="list">
      ${modeles.map((x) => `
        <div class="item">
          <div class="item-main">
            <strong>${esc(x.libelle)}</strong>
            <small>${chf(x.montant)} · ${FREQUENCES[x.frequence]} · ${fmtDate(x.date_debut)} → ${fmtDate(x.date_fin)}</small>
          </div>
          <div class="item-actions">
            <button class="btn small" data-m-edit="${x.id}">Modifier</button>
            <button class="btn small danger-o" data-m-del="${x.id}">Supprimer</button>
          </div>
        </div>`).join('') || '<p class="empty">Aucun modèle.</p>'}
    </div>
    <h3>${e ? 'Modifier le modèle' : 'Nouveau modèle'}</h3>
    <form id="fm" class="form">
      <label>Libellé<input name="libelle" required value="${esc(e?.libelle)}" placeholder="Ex. Électricité"></label>
      <label>Montant estimé (CHF)<input type="number" name="montant" required min="0" step="0.05" inputmode="decimal" value="${e ? Number(e.montant).toFixed(2) : ''}"></label>
      <label>Fréquence
        <select name="frequence">${Object.entries(FREQUENCES).map(([k, l]) => `<option value="${k}" ${e?.frequence === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </label>
      <label>Du (première échéance)<input type="date" name="date_debut" required value="${e?.date_debut || `${annee}-01-01`}"></label>
      <label>Au<input type="date" name="date_fin" required value="${e?.date_fin || `${annee}-12-31`}"></label>
      <div class="actions">
        ${e ? '<button type="button" class="btn" id="nouveau">Annuler la modification</button>' : ''}
        <button type="submit" class="btn primary">${e ? 'Enregistrer' : 'Créer et préparer les lignes'}</button>
      </div>
    </form>`);

  $$('[data-m-edit]', m).forEach((b) => { b.onclick = () => gererModeles(b.dataset.mEdit); });
  if (e) $('#nouveau', m).onclick = () => gererModeles();

  $$('[data-m-del]', m).forEach((b) => {
    b.onclick = async () => {
      const x = modeles.find((mm) => mm.id === b.dataset.mDel);
      closeModal();
      if (!await confirmer(`Supprimer le modèle « ${x.libelle} » et ses lignes encore « prévues » ? Les lignes déjà payées sont conservées.`)) return;
      try {
        await q(db.from('sorties').delete().eq('modele_id', x.id).eq('statut', 'prevu'));
        await q(db.from('charges_fixes').delete().eq('id', x.id));
        toast('Modèle supprimé');
        refresh();
      } catch (err) {
        toast(messageErreur(err), true);
      }
    };
  });

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
      toast(`${lignes.length} ligne(s) prévue(s) dans la période`);
      refresh();
    } catch (err) {
      toast(messageErreur(err), true);
      bouton.disabled = false;
    }
  };
}
