-- =====================================================================
--  Gestion institut : schéma de la base (Supabase / Postgres)
--  À coller dans Supabase > SQL Editor > Run.
--  Peut être relancé sans risque (ne touche pas aux données existantes).
-- =====================================================================

-- ---------------------------------------------------------------------
--  STOCK
-- ---------------------------------------------------------------------
create table if not exists produits (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null,
  type          text not null check (type in ('cabine', 'vente')),
  quantite      integer not null default 0,
  seuil_alerte  integer not null default 0 check (seuil_alerte >= 0),
  prix_vente    numeric(10,2) check (prix_vente is null or prix_vente >= 0),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  ENTRÉES D'ARGENT
--  Un bon cadeau vendu est une entrée de type 'bon_cadeau'.
--  Quand il sert à payer, l'entrée payée porte moyen = 'bon_cadeau'
--  et bon_id = l'entrée qui a vendu le bon.
-- ---------------------------------------------------------------------
create table if not exists entrees (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity,
  date_service  date not null default current_date,
  type          text not null check (type in ('service', 'produit', 'bon_cadeau')),
  libelle       text not null,
  montant       numeric(10,2) not null check (montant > 0),
  paye_le       date,
  moyen         text check (moyen in ('cash', 'carte', 'twint', 'virement', 'bon_cadeau')),
  bon_id        uuid references entrees(id) on delete restrict,
  produit_id    uuid references produits(id) on delete set null,
  quantite      integer check (quantite > 0),
  note          text,
  created_at    timestamptz not null default now(),

  -- payé => on connaît le moyen de paiement
  constraint paiement_necessite_moyen
    check (paye_le is null or moyen is not null),
  -- moyen "bon cadeau" <=> un bon est désigné
  constraint bon_coherent
    check ((coalesce(moyen, '') = 'bon_cadeau') = (bon_id is not null)),
  -- un bon cadeau est toujours payé tout de suite
  constraint bon_paye_immediatement
    check (moyen is distinct from 'bon_cadeau' or paye_le is not null),
  -- la vente d'un bon est payée tout de suite, et pas avec un autre bon
  constraint vente_bon_payee
    check (type <> 'bon_cadeau' or (paye_le is not null and moyen is distinct from 'bon_cadeau'))
);

create index if not exists entrees_paye_le_idx on entrees (paye_le);
create index if not exists entrees_date_idx    on entrees (date_service);
create index if not exists entrees_bon_idx     on entrees (bon_id);

-- Solde d'un bon cadeau : montant vendu - montants déjà utilisés
create or replace function verifier_bon() returns trigger
language plpgsql as $$
declare
  v_total   numeric;
  v_type    text;
  v_utilise numeric;
begin
  if new.moyen = 'bon_cadeau' then
    select montant, type into v_total, v_type from entrees where id = new.bon_id;
    if v_type is distinct from 'bon_cadeau' then
      raise exception 'Bon cadeau introuvable';
    end if;
    select coalesce(sum(montant), 0) into v_utilise
      from entrees where bon_id = new.bon_id and id <> new.id;
    if v_utilise + new.montant > v_total then
      raise exception 'Solde du bon cadeau insuffisant';
    end if;
  end if;

  -- on ne peut pas baisser le montant d'un bon en dessous de ce qui a été utilisé
  if new.type = 'bon_cadeau' and tg_op = 'UPDATE' then
    select coalesce(sum(montant), 0) into v_utilise from entrees where bon_id = new.id;
    if v_utilise > new.montant then
      raise exception 'Ce bon cadeau a déjà été utilisé pour un montant supérieur';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists entrees_verifier_bon on entrees;
create trigger entrees_verifier_bon
  before insert or update on entrees
  for each row execute function verifier_bon();

-- Une vente de produit retire la quantité du stock (et la remet si on corrige ou supprime)
create or replace function maj_stock_vente() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.produit_id is not null then
    update produits set quantite = quantite + coalesce(old.quantite, 0) where id = old.produit_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.produit_id is not null then
    update produits set quantite = quantite - coalesce(new.quantite, 0) where id = new.produit_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists entrees_maj_stock on entrees;
create trigger entrees_maj_stock
  after insert or update or delete on entrees
  for each row execute function maj_stock_vente();

-- Vue pratique : liste des bons avec leur solde
create or replace view bons_cadeaux with (security_invoker = true) as
select
  e.id,
  e.libelle,
  e.date_service as date_vente,
  e.montant      as montant_initial,
  e.montant - coalesce((select sum(u.montant) from entrees u where u.bon_id = e.id), 0) as solde
from entrees e
where e.type = 'bon_cadeau';

-- Ajustement du stock (+ / -), utilisé par l'app
create or replace function ajuster_stock(p_id uuid, p_delta integer) returns void
language sql as $$
  update produits set quantite = quantite + p_delta where id = p_id;
$$;

-- ---------------------------------------------------------------------
--  SORTIES D'ARGENT
-- ---------------------------------------------------------------------
create table if not exists charges_fixes (
  id          uuid primary key default gen_random_uuid(),
  libelle     text not null,
  montant     numeric(10,2) not null check (montant >= 0),
  frequence   text not null check (frequence in ('mensuelle', 'trimestrielle', 'annuelle')),
  date_debut  date not null,
  date_fin    date not null,
  created_at  timestamptz not null default now(),
  check (date_fin >= date_debut)
);

create table if not exists sorties (
  id         uuid primary key default gen_random_uuid(),
  numero     bigint generated always as identity,
  date       date not null default current_date,
  libelle    text not null,
  montant    numeric(10,2) not null check (montant >= 0),
  categorie  text not null check (categorie in ('fixe', 'flexible', 'stock_cabine', 'stock_vente')),
  statut     text not null default 'paye' check (statut in ('paye', 'prevu')),
  moyen      text check (moyen in ('cash', 'carte', 'twint', 'virement')),
  note       text,
  modele_id  uuid references charges_fixes(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (modele_id, date),
  check (statut = 'paye' or categorie = 'fixe')
);

create index if not exists sorties_date_idx on sorties (date);

-- Photos / PDF des tickets et factures (les fichiers sont dans le Storage)
create table if not exists pieces (
  id         uuid primary key default gen_random_uuid(),
  sortie_id  uuid not null references sorties(id) on delete cascade,
  chemin     text not null,
  nom        text,
  created_at timestamptz not null default now()
);

create index if not exists pieces_sortie_idx on pieces (sortie_id);

-- ---------------------------------------------------------------------
--  SÉCURITÉ : seule une personne connectée accède aux données
--  (les inscriptions sont désactivées : seul le compte créé à la main existe)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['produits', 'entrees', 'charges_fixes', 'sorties', 'pieces'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acces_connecte" on %I', t);
    execute format('create policy "acces_connecte" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function ajuster_stock(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------
--  STORAGE : bucket privé pour les justificatifs
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('justificatifs', 'justificatifs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists "justificatifs_connecte" on storage.objects;
create policy "justificatifs_connecte" on storage.objects
  for all to authenticated
  using (bucket_id = 'justificatifs')
  with check (bucket_id = 'justificatifs');
