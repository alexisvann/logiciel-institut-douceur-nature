import { CONFIG } from '../config.js';

export const db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
export const BUCKET = 'justificatifs';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const MOYENS = { cash: 'Cash', carte: 'Carte', twint: 'Twint', virement: 'Virement / banque', bon_cadeau: 'Bon cadeau' };
export const MOYENS_ENCAISSES = ['cash', 'carte', 'twint', 'virement'];
export const CATEGORIES_SORTIE = { fixe: 'Charge fixe', flexible: 'Dépense variable', stock_cabine: 'Stock cabine', stock_vente: 'Stock vente' };
export const TYPES_ENTREE_LABELS = { service: 'Service', produit: 'Produit', bon_cadeau: 'Bon cadeau' };
export const FREQUENCES ={ mensuelle: 'Mensuelle', trimestrielle: 'Trimestrielle', annuelle: 'Annuelle' };

// ---------- formats ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const chf = (n) => nf.format(Number(n) || 0);
export const sum = (rows, f = (r) => r.montant) => rows.reduce((s, r) => s + Number(f(r) || 0), 0);
export const pad = (n) => String(n).padStart(2, '0');
export const numero = (prefix, n) => `${prefix}-${String(n).padStart(4, '0')}`;

// ---------- dates (toujours en 'YYYY-MM-DD' / 'YYYY-MM') ----------
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
export const fmtCourt = (iso) => (iso ? iso.slice(5).split('-').reverse().join('.') : '');
export const currentMonth = () => todayISO().slice(0, 7);
export const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return [`${ym}-01`, `${ym}-${pad(new Date(y, m, 0).getDate())}`];
};
export const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('fr-CH', { month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const shiftMonth =(ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// Mois affiché, partagé entre les pages
export const state = {
  get mois() {
    try { return sessionStorage.getItem('mois') || currentMonth(); } catch { return currentMonth(); }
  },
  set mois(v) {
    try { sessionStorage.setItem('mois', v); } catch { /* ignoré */ }
  },
};

export const refresh = () => window.dispatchEvent(new Event('refresh'));

export const monthBarHtml = () => `
  <div class="monthbar no-print">
    <button class="nav-btn" data-mois="-1" aria-label="Mois précédent">‹</button>
    <strong>${esc(monthLabel(state.mois))}</strong>
    <button class="nav-btn" data-mois="1" aria-label="Mois suivant">›</button>
  </div>`;

// Choix unique présenté en pastilles ; une pastille avec la valeur '' = « aucun »
export const chips = (name, options, valeur = '') => `
  <div class="chips">${options.map(([k, l]) => `
    <label class="chip"><input type="radio" name="${name}" value="${esc(k)}" ${k === valeur ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}
  </div>`;

export function bindMonthBar(root) {
  $$('[data-mois]', root).forEach((b) => {
    b.onclick = () => { state.mois = shiftMonth(state.mois, Number(b.dataset.mois)); refresh(); };
  });
}

export const libelleEntree = (e) => (e.type === 'bon_cadeau' ? `Bon cadeau – ${e.libelle}` : e.libelle);

// ---------- accès base ----------
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export function messageErreur(e) {
  const m = e?.message || String(e);
  if (m.includes('entrees_bon_id_fkey')) return 'Ce bon cadeau a déjà été utilisé : supprimez d’abord les entrées payées avec ce bon.';
  if (m.includes('Solde du bon cadeau insuffisant')) return 'Le solde de ce bon cadeau est insuffisant.';
  if (m.includes('Failed to fetch')) return 'Pas de connexion internet.';
  return m;
}

// ---------- interface ----------
export function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 3800);
}

export function openModal(title, bodyHtml) {
  const m = $('#modal');
  m.onclose = null;
  m.innerHTML = `
    <form method="dialog" class="modal-head"><h2>${esc(title)}</h2><button class="icon" aria-label="Fermer">✕</button></form>
    <div class="modal-body">${bodyHtml}</div>`;
  // si une fenêtre est déjà ouverte (ex. confirmation de suppression), on remplace son contenu
  if (!m.open) m.showModal();
  document.activeElement?.blur();
  return m;
}
export const closeModal = () => $('#modal').close();

export function confirmer(message, okLabel = 'Supprimer') {
  return new Promise((resolve) => {
    const m = openModal('Confirmation', `
      <p>${esc(message)}</p>
      <div class="actions">
        <button type="button" class="btn" data-r="0">Annuler</button>
        <button type="button" class="btn danger" data-r="1">${esc(okLabel)}</button>
      </div>`);
    let ok = false;
    $$('[data-r]', m).forEach((b) => { b.onclick = () => { ok = b.dataset.r === '1'; m.close(); }; });
    m.onclose = () => resolve(ok);
  });
}

// ---------- justificatifs ----------
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Réduit les photos (1600 px max, JPEG) pour rester léger ; les PDF passent tels quels.
export async function preparerFichier(file) {
  if (file.type === 'application/pdf') return file;
  if (!file.type.startsWith('image/')) throw new Error(`Format non supporté : ${file.name} (photo ou PDF uniquement)`);
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const ratio = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * ratio);
    canvas.height = Math.round(bmp.height * ratio);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.78));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function envoyerPiece(sortieId, fichier) {
  const file = await preparerFichier(fichier);
  const ext = EXT[file.type];
  if (!ext) throw new Error(`Format non supporté : ${fichier.name}`);
  const chemin = `${sortieId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(chemin, file, { contentType: file.type });
  if (error) throw error;
  await q(db.from('pieces').insert({ sortie_id: sortieId, chemin, nom: fichier.name }));
}

export async function urlsPieces(pieces) {
  if (!pieces.length) return {};
  const { data } = await db.storage.from(BUCKET).createSignedUrls(pieces.map((p) => p.chemin), 3600);
  return Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
}

export async function supprimerFichiers(chemins) {
  if (chemins.length) await db.storage.from(BUCKET).remove(chemins);
}
