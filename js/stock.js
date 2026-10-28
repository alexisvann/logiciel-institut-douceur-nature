import { db, $, $$, esc, chf, q, openModal, closeModal, confirmer, toast, messageErreur, refresh } from './lib.js';

const TABS = [['cabine', 'Stock cabine'], ['vente', 'Stock en vente']];

export async function render(root, sub) {
  if (!TABS.some(([k]) => k === sub)) sub = 'cabine';
  const rows = await q(db.from('produits').select('*').eq('type', sub).order('nom'));

  root.innerHTML = `
    <div class="page-head"><h1>Stock</h1><button class="btn primary" id="add">+ Ajouter un produit</button></div>
    <div class="tabs">${TABS.map(([k, l]) => `<a href="#/stock/${k}" class="${k === sub ? 'active' : ''}">${l}</a>`).join('')}</div>
    <p class="muted">${sub === 'cabine'
      ? 'Produits utilisés pour les soins : ils ne sont pas vendus.'
      : 'Produits vendus : chaque vente saisie dans « Entrées > Produits » baisse le stock automatiquement.'}</p>
    <div class="list">${rows.length ? rows.map((p) => ligne(p, sub)).join('') : '<p class="empty">Aucun produit.</p>'}</div>`;

  $('#add').onclick = () => formulaire(sub);
  $$('[data-edit]', root).forEach((b) => { b.onclick = () => formulaire(sub, rows.find((p) => p.id === b.dataset.edit)); });
  $$('[data-del]', root).forEach((b) => { b.onclick = () => supprimer(rows.find((p) => p.id === b.dataset.del)); });
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
  return `
    <div class="item">
      <div class="item-main">
        <strong>${esc(p.nom)}</strong>
        <small>${p.seuil_alerte > 0 ? `Alerte à ${p.seuil_alerte}` : 'Pas d’alerte'}${sub === 'vente' && p.prix_vente != null ? ` · Prix ${chf(p.prix_vente)}` : ''}</small>
        ${bas ? '<div class="badges"><span class="badge warn">Stock bas</span></div>' : ''}
      </div>
      <div class="stepper">
        <button class="btn" data-id="${p.id}" data-delta="-1" aria-label="Retirer un">−</button>
        <span class="qte ${bas ? 'low' : ''}">${p.quantite}</span>
        <button class="btn" data-id="${p.id}" data-delta="1" aria-label="Ajouter un">+</button>
      </div>
      <div class="item-actions">
        <button class="btn small" data-edit="${p.id}">Modifier</button>
        <button class="btn small danger-o" data-del="${p.id}">Supprimer</button>
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
  const m = openModal(p ? 'Modifier le produit' : 'Ajouter un produit', `
    <form id="f" class="form">
      <label>Nom<input name="nom" required autocomplete="off" value="${esc(p?.nom)}"></label>
      <label>Quantité en stock<input type="number" name="quantite" step="1" required value="${p ? p.quantite : 0}"></label>
      <label>Alerte quand il en reste (0 = pas d’alerte)<input type="number" name="seuil" min="0" step="1" value="${p ? p.seuil_alerte : 0}"></label>
      ${type === 'vente' ? `<label>Prix de vente (CHF)<input type="number" name="prix" min="0" step="0.05" inputmode="decimal" value="${p?.prix_vente != null ? Number(p.prix_vente).toFixed(2) : ''}"></label>` : ''}
      <div class="actions">
        <button type="button" class="btn" id="annuler">Annuler</button>
        <button type="submit" class="btn primary">Enregistrer</button>
      </div>
    </form>`);
  const f = $('#f', m);
  $('#annuler', m).onclick = closeModal;
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
      toast('Produit enregistré');
      refresh();
    } catch (e) {
      toast(messageErreur(e), true);
    }
  };
}
