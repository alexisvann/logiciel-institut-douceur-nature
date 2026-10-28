import { db, $, $$, esc, chf, q, openModal, closeModal, confirmer, toast, messageErreur, refresh } from './lib.js';

const TABS = [['cabine', 'Cabine'], ['vente', 'En vente']];

export async function render(root, sub) {
  if (!TABS.some(([k]) => k === sub)) sub = 'cabine';
  const rows = await q(db.from('produits').select('*').eq('type', sub).order('nom'));

  root.innerHTML = `
    <div class="page-head"><h1>Stock</h1><button class="btn primary small" id="add">+ Ajouter</button></div>
    <div class="seg tabs">${TABS.map(([k, l]) => `<a href="#/stock/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    <p class="hint">${sub === 'cabine'
      ? 'Produits utilisés pour les soins, non vendus.'
      : 'Produits vendus : chaque vente saisie dans Entrées baisse le stock automatiquement.'}</p>
    <div class="card">${rows.length ? rows.map((p) => ligne(p, sub)).join('') : '<p class="empty">Aucun produit.</p>'}</div>`;

  $('#add').onclick = () => formulaire(sub);
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((p) => p.id === b.dataset.edit)); });
  $$('[data-delta]', root).forEach((b) => {
    b.onclick = async () => {
      try {
        await q(db.rpc('ajuster_stock', { p_id: b.dataset.id, p_delta: Number(b.dataset.delta) }));
        refresh();
      } catch (e) {
        toast(messageErreur(e), true);
      }
    };
  });
}

function ligne(p, sub) {
  const bas = p.seuil_alerte > 0 && p.quantite <= p.seuil_alerte;
  const prix = sub === 'vente' && p.prix_vente != null ? `${chf(p.prix_vente)} CHF` : '';
  return `
    <div class="row">
      <button class="row-main-btn" data-edit="${p.id}">
        <span class="row-title">${esc(p.nom)}</span>
        <span class="row-sub">${bas ? '<span class="tag warn">Stock bas</span> ' : ''}${esc(prix)}</span>
      </button>
      <div class="stepper">
        <button data-id="${p.id}" data-delta="-1" aria-label="Retirer un">−</button>
        <span class="qte ${bas ? 'low' : ''}">${p.quantite}</span>
        <button data-id="${p.id}" data-delta="1" aria-label="Ajouter un">+</button>
      </div>
    </div>`;
}

async function supprimer(p) {
  if (!await confirmer(`Supprimer « ${p.nom} » du stock ? (Les ventes déjà saisies sont conservées.)`)) return;
  try {
    await q(db.from('produits').delete().eq('id', p.id));
    toast('Produit supprimé');
    refresh();
  } catch (e) {
    toast(messageErreur(e), true);
  }
}

function formulaire(type, p = null) {
  const m = openModal(p ? 'Modifier le produit' : 'Nouveau produit', `
    <form id="f" class="form">
      <label class="field"><span>Nom</span><input name="nom" required autocomplete="off" value="${esc(p?.nom)}"></label>
      <div class="field-row">
        <label class="field"><span>Quantité en stock</span><input type="number" name="quantite" step="1" required value="${p ? p.quantite : 0}"></label>
        ${type === 'vente' ? `<label class="field"><span>Prix de vente (CHF)</span><input type="number" name="prix" min="0" step="0.05" inputmode="decimal" value="${p?.prix_vente != null ? Number(p.prix_vente).toFixed(2) : ''}"></label>` : ''}
      </div>
      <details class="more" ${p?.seuil_alerte ? 'open' : ''}>
        <summary>Alerte de stock bas</summary>
        <label class="field"><span>Prévenir quand il en reste (0 = pas d’alerte)</span><input type="number" name="seuil" min="0" step="1" value="${p ? p.seuil_alerte : 0}"></label>
      </details>
      <div class="form-foot">
        ${p ? '<button type="button" class="link danger" id="supprimer">Supprimer</button>' : '<span></span>'}
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  const f = $('#f', m);
  if (p) $('#supprimer', m).onclick = () => supprimer(p);
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const payload = {
      nom: f.nom.value.trim(),
      type,
      quantite: Number(f.quantite.value),
      seuil_alerte: Number(f.seuil.value) || 0,
      prix_vente: type === 'vente' && f.prix.value !== '' ? Number(f.prix.value) : null,
    };
    try {
      await q(p ? db.from('produits').update(payload).eq('id', p.id) : db.from('produits').insert(payload));
      closeModal();
      toast('Enregistré');
      refresh();
    } catch (e) {
      toast(messageErreur(e), true);
    }
  };
}
