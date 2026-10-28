import { db, BUCKET, q, numero, fmtDate, MOYENS, CATEGORIES_SORTIE, TYPES_ENTREE_LABELS } from './lib.js';

const csv = (rows) => '﻿' + rows
  .map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';'))
  .join('\r\n');

const montant = (n) => Number(n).toFixed(2).replace('.', ',');
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

function telecharger(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Période [from, to] incluse. Génère un ZIP : entrees.csv, sorties.csv et justificatifs/ (nommés avec le n° de pièce).
export async function exporterZip({ from, to, nom, progression = () => {} }) {
  const [entrees, sorties] = await Promise.all([
    q(db.from('entrees').select('*').or(`and(paye_le.gte.${from},paye_le.lte.${to}),paye_le.is.null`).order('date_service')),
    q(db.from('sorties').select('*, pieces(*)').gte('date', from).lte('date', to).order('date')),
  ]);

  const zip = new JSZip();

  zip.file('entrees.csv', csv([
    ['N°', 'Date du service', 'Payé le', 'Type', 'Libellé', 'Moyen de paiement', 'Montant CHF', 'Statut', 'Remarque'],
    ...entrees.map((e) => [
      numero('E', e.numero), fmtDate(e.date_service), fmtDate(e.paye_le), TYPES_ENTREE_LABELS[e.type], e.libelle,
      e.moyen ? MOYENS[e.moyen] : '', montant(e.montant), e.paye_le ? 'Payé' : 'En attente', e.note,
    ]),
  ]));

  const noms = new Map();
  const aTelecharger = [];
  sorties.forEach((s) => {
    const fichiers = (s.pieces || []).map((p, i) => {
      const ext = p.chemin.split('.').pop();
      const fichier = `${numero('S', s.numero)}_${s.date}_${slug(s.libelle)}_${Number(s.montant).toFixed(2)}_${i + 1}.${ext}`;
      aTelecharger.push({ chemin: p.chemin, fichier });
      return fichier;
    });
    noms.set(s.id, fichiers);
  });

  zip.file('sorties.csv', csv([
    ['N°', 'Date', 'Libellé', 'Catégorie', 'Montant CHF', 'Statut', 'Moyen de paiement', 'Justificatifs', 'Remarque'],
    ...sorties.map((s) => [
      numero('S', s.numero), fmtDate(s.date), s.libelle, CATEGORIES_SORTIE[s.categorie], montant(s.montant),
      s.statut === 'paye' ? 'Payé' : 'Prévu', s.moyen ? MOYENS[s.moyen] : '', noms.get(s.id).join(' | '), s.note,
    ]),
  ]));

  const dossier = zip.folder('justificatifs');
  let fait = 0;
  for (const { chemin, fichier } of aTelecharger) {
    progression(`Justificatifs ${++fait}/${aTelecharger.length}…`);
    const { data, error } = await db.storage.from(BUCKET).download(chemin);
    if (error) throw error;
    dossier.file(fichier, data);
  }

  progression('Création du ZIP…');
  telecharger(await zip.generateAsync({ type: 'blob' }), nom);
}
