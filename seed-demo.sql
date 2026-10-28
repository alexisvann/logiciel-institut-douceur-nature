-- =====================================================================
--  DONNÉES DE DÉMO (fausses données, dates relatives à aujourd'hui)
--  À lancer APRÈS schema.sql, UNE SEULE FOIS, et UNIQUEMENT sur le projet de démo.
--  NE JAMAIS lancer sur la base réelle de l'institut.
--
--  Pour vider la démo et repartir de zéro (avant de la relancer) :
--    delete from sorties; delete from charges_fixes; delete from entrees where bon_id is not null;
--    delete from entrees; delete from produits;
-- =====================================================================
do $$
declare
  m0 date := date_trunc('month', current_date)::date;          -- 1er du mois en cours
  m1 date := (date_trunc('month', current_date) - interval '1 month')::date;  -- 1er du mois précédent
  an0 date := date_trunc('year', current_date)::date;
  p_huile  uuid := '00000000-0000-0000-0000-0000000000a1';
  p_gel    uuid := '00000000-0000-0000-0000-0000000000a2';
  p_coton  uuid := '00000000-0000-0000-0000-0000000000a3';
  p_gants  uuid := '00000000-0000-0000-0000-0000000000a4';
  p_creme  uuid := '00000000-0000-0000-0000-0000000000b1';
  p_vernis uuid := '00000000-0000-0000-0000-0000000000b2';
  p_serum  uuid := '00000000-0000-0000-0000-0000000000b3';
  bon1 uuid := '00000000-0000-0000-0000-0000000000c1';
  bon2 uuid := '00000000-0000-0000-0000-0000000000c2';
  loyer uuid; elec uuid; assur uuid;
begin
  -- ---------- stock ----------
  insert into produits (id, nom, type, quantite, seuil_alerte, prix_vente) values
    (p_huile,  'Huile de massage',        'cabine', 6,  2, null),
    (p_gel,    'Gel UV – base',           'cabine', 4,  3, null),
    (p_coton,  'Disques de coton',        'cabine', 30, 10, null),
    (p_gants,  'Gants jetables (boîte)',  'cabine', 2,  3, null),
    (p_creme,  'Crème hydratante visage', 'vente',  12, 3, 38.00),
    (p_vernis, 'Vernis semi-permanent',   'vente',  20, 5, 24.00),
    (p_serum,  'Sérum éclat',             'vente',  3,  3, 59.00);

  -- ---------- bons cadeaux vendus ----------
  insert into entrees (id, date_service, type, libelle, montant, paye_le, moyen) values
    (bon2, m1 + 11, 'bon_cadeau', 'Sophie Martin', 150.00, m1 + 11, 'carte'),
    (bon1, m0 + 8,  'bon_cadeau', 'Marie Dupont',  100.00, m0 + 8,  'twint');

  -- ---------- entrées : mois précédent ----------
  insert into entrees (date_service, type, libelle, montant, paye_le, moyen, bon_id) values
    (m1 + 1,  'service', 'Soin du visage',             85.00, m1 + 1,  'cash',     null),
    (m1 + 3,  'service', 'Pose gel mains',             90.00, m1 + 3,  'twint',    null),
    (m1 + 5,  'service', 'Manucure semi-permanent',    55.00, m1 + 5,  'carte',    null),
    (m1 + 9,  'service', 'Épilation jambes complètes', 45.00, m1 + 9,  'cash',     null),
    (m1 + 14, 'service', 'Beauté des pieds',           60.00, m1 + 14, 'twint',    null),
    (m1 + 17, 'service', 'Pose gel mains',             90.00, m1 + 20, 'virement', null),
    (m1 + 22, 'service', 'Soin du visage',             80.00, m1 + 22, 'bon_cadeau', bon2);

  -- ---------- entrées : mois en cours ----------
  insert into entrees (date_service, type, libelle, montant, paye_le, moyen, bon_id) values
    (m0 + 1,  'service', 'Soin du visage',             85.00, m0 + 1,  'cash',     null),
    (m0 + 2,  'service', 'Pose gel mains',             90.00, m0 + 2,  'twint',    null),
    (m0 + 3,  'service', 'Manucure semi-permanent',    55.00, m0 + 3,  'carte',    null),
    (m0 + 6,  'service', 'Épilation jambes complètes', 45.00, m0 + 6,  'cash',     null),
    (m0 + 8,  'service', 'Pose gel mains',             90.00, m0 + 11, 'virement', null),
    (m0 + 15, 'service', 'Soin du visage',             85.00, null,    'virement', null),   -- en attente
    (m0 + 17, 'service', 'Beauté des pieds',           60.00, m0 + 17, 'twint',    null),
    (m0 + 20, 'service', 'Manucure semi-permanent',    55.00, m0 + 20, 'bon_cadeau', bon1);

  insert into entrees (date_service, type, libelle, montant, paye_le, moyen, produit_id, quantite) values
    (m0 + 12, 'produit', 'Crème hydratante visage', 76.00, m0 + 12, 'carte', p_creme,  2),
    (m0 + 18, 'produit', 'Vernis semi-permanent',   24.00, m0 + 18, 'cash',  p_vernis, 1);

  -- ---------- charges fixes récurrentes (toute l'année en cours) ----------
  insert into charges_fixes (libelle, montant, frequence, date_debut, date_fin)
    values ('Loyer du salon', 1200.00, 'mensuelle', an0, an0 + 364) returning id into loyer;
  insert into charges_fixes (libelle, montant, frequence, date_debut, date_fin)
    values ('Électricité', 180.00, 'trimestrielle', an0 + 14, an0 + 364) returning id into elec;
  insert into charges_fixes (libelle, montant, frequence, date_debut, date_fin)
    values ('Assurance RC professionnelle', 420.00, 'annuelle', an0 + 59, an0 + 364) returning id into assur;

  insert into sorties (date, libelle, montant, categorie, statut, moyen, modele_id)
  select d::date, 'Loyer du salon', 1200.00, 'fixe',
         case when d::date <= current_date then 'paye' else 'prevu' end,
         case when d::date <= current_date then 'virement' end, loyer
  from generate_series(an0, an0 + 364, interval '1 month') d;

  insert into sorties (date, libelle, montant, categorie, statut, moyen, modele_id)
  select d::date, 'Électricité',
         180.00 + case when d::date <= current_date then (extract(month from d)::int * 3) else 0 end,
         'fixe',
         case when d::date <= current_date then 'paye' else 'prevu' end,
         case when d::date <= current_date then 'virement' end, elec
  from generate_series(an0 + 14, an0 + 364, interval '3 months') d;

  insert into sorties (date, libelle, montant, categorie, statut, moyen, modele_id)
  select d::date, 'Assurance RC professionnelle', 420.00, 'fixe',
         case when d::date <= current_date then 'paye' else 'prevu' end,
         case when d::date <= current_date then 'virement' end, assur
  from generate_series(an0 + 59, an0 + 364, interval '12 months') d;

  -- ---------- sorties variables et stock ----------
  insert into sorties (date, libelle, montant, categorie, statut, moyen) values
    (m1 + 6,  'Flyers et cartes de visite',            48.00,  'flexible',     'paye', 'carte'),
    (m1 + 12, 'Beauty-Pro – gel UV et limes',         142.30,  'stock_cabine', 'paye', 'virement'),
    (m1 + 20, 'Distributeur – crèmes et sérums',      310.00,  'stock_vente',  'paye', 'virement'),
    (m0 + 4,  'Papeterie',                             23.50,  'flexible',     'paye', 'cash'),
    (m0 + 5,  'Beauty-Pro – huiles et coton',         118.90,  'stock_cabine', 'paye', 'virement'),
    (m0 + 13, 'Migros – décorations Halloween',        64.90,  'flexible',     'paye', 'carte'),
    (m0 + 19, 'Distributeur – vernis semi-permanents', 205.00, 'stock_vente',  'paye', 'virement');
end $$;
