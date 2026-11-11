-- ════════════════════════════════════════════════════════════════════════════════════════════
-- DERNIER RELAIS : schéma du jeu en ligne (PostgreSQL / Supabase)
--
-- COMMENT L'APPLIQUER
--   1. Tableau de bord Supabase → SQL Editor → New query : colle ce fichier EN ENTIER, puis « Run ».
--      Le script est rejouable : tu peux le relancer autant de fois que tu veux, il ne casse rien.
--   2. Authentication → Sign In / Providers → section « User Signups » : active « Allow anonymous
--      sign-ins », puis « Save changes ». Sans ce réglage, le jeu reste en mode local (sans erreur).
--   3. C'est tout. Aucune clé secrète n'est nécessaire dans le jeu : la clé « publishable » suffit.
--
-- PRINCIPES
--   • Sécurité au niveau des lignes (RLS) activée sur toutes les tables.
--   • Les joueurs sont des comptes anonymes : ils ont le rôle « authenticated ». Le rôle « anon »
--     (aucune session) peut seulement lire les tables publiques.
--   • Les écritures sensibles (abris, régions, relais, récompenses) passent uniquement par des
--     fonctions « security definer » ; aucune écriture directe n'est possible sur ces tables.
-- ════════════════════════════════════════════════════════════════════════════════════════════


-- ───────────────────────────── 1. TABLES ─────────────────────────────

-- Les 13 régions métropolitaines et leur progression collective.
create table if not exists public.regions (
  id              text primary key,
  name            text not null,
  shelters        integer not null default 0,   -- abris ayant reçu au moins une livraison
  active_shelters integer not null default 0,   -- abris de niveau collectif 1 ou plus
  points          bigint  not null default 0,
  deliveries      bigint  not null default 0,
  updated_at      timestamptz not null default now()
);

insert into public.regions (id, name) values
  ('idf', 'Île-de-France'),
  ('cvl', 'Centre-Val de Loire'),
  ('bfc', 'Bourgogne-Franche-Comté'),
  ('nor', 'Normandie'),
  ('hdf', 'Hauts-de-France'),
  ('ges', 'Grand Est'),
  ('pdl', 'Pays de la Loire'),
  ('bre', 'Bretagne'),
  ('naq', 'Nouvelle-Aquitaine'),
  ('occ', 'Occitanie'),
  ('ara', 'Auvergne-Rhône-Alpes'),
  ('pac', 'Provence-Alpes-Côte d’Azur'),
  ('cor', 'Corse')
on conflict (id) do nothing;

-- Fiche publique de chaque joueur (classement).
create table if not exists public.players (
  id          uuid primary key references auth.users (id) on delete cascade,
  pseudo      text not null default 'Porteur'
              check (char_length(pseudo) between 2 and 20 and pseudo = btrim(pseudo)),
  level       integer not null default 1 check (level between 1 and 999),
  score       bigint  not null default 0 check (score >= 0),
  deliveries  integer not null default 0 check (deliveries >= 0),
  distance_km numeric(10, 2) not null default 0 check (distance_km >= 0),
  region      text references public.regions (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists players_score_idx on public.players (score desc);

-- Sauvegarde de partie (GameSave), strictement privée.
create table if not exists public.saves (
  id         uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 4000000),
  saved_at   bigint not null default 0,          -- champ savedAt de la sauvegarde (millisecondes)
  updated_at timestamptz not null default now()
);

-- Abris collectifs : même identifiant chez tous les joueurs (calculé par le jeu).
create table if not exists public.shelters (
  id         text primary key check (char_length(id) between 1 and 80),
  name       text not null check (char_length(name) between 1 and 80),
  lng        double precision not null,
  lat        double precision not null,
  region     text not null references public.regions (id),
  points     bigint  not null default 0 check (points >= 0),
  deliveries integer not null default 0 check (deliveries >= 0),
  level      smallint not null default 0 check (level between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shelters_region_idx on public.shelters (region);

-- Chaîne de relais : un colis qui passe de porteur en porteur jusqu'à son abri de destination.
create table if not exists public.relays (
  id           uuid primary key default gen_random_uuid(),
  payload      jsonb not null,                    -- le colis (nom, caisse, poids, récompense, destination…)
  dest_shelter text  not null,                    -- abri de destination
  at_shelter   text,                              -- abri où il attend ; null s'il est porté
  last_shelter text,                              -- dernier abri où il a attendu (retour si abandon)
  carrier      uuid,                              -- porteur actuel ; null s'il attend
  carriers     uuid[] not null default '{}',      -- porteurs successifs, sans doublon, du premier au dernier
  state        text not null default 'waiting' check (state in ('waiting', 'carried', 'delivered')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  delivered_at timestamptz,
  constraint relays_state_coherent check (
       (state = 'waiting'   and at_shelter is not null and carrier is null)
    or (state = 'carried'   and at_shelter is null     and carrier is not null)
    or (state = 'delivered' and carrier is null)
  )
);
create index if not exists relays_waiting_idx on public.relays (at_shelter) where state = 'waiting';
create index if not exists relays_carried_idx on public.relays (carrier)    where state = 'carried';
create index if not exists relays_stale_idx   on public.relays (updated_at) where state = 'carried';

-- Récompenses de la chaîne : une ligne par porteur et par relais livré, à réclamer.
create table if not exists public.relay_rewards (
  id         bigint generated always as identity primary key,
  relay_id   uuid not null references public.relays (id) on delete cascade,
  player     uuid not null references public.players (id) on delete cascade,
  points     integer not null check (points >= 0),
  hops       integer not null default 1,          -- nombre de porteurs de la chaîne
  parcel     text not null default '',            -- nom du colis, pour l'affichage
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  constraint relay_rewards_once unique (relay_id, player)
);
create index if not exists relay_rewards_pending_idx on public.relay_rewards (player) where claimed_at is null;

-- Limite de fréquence par joueur et par type d'action (table interne, illisible depuis le jeu).
create table if not exists public.rate_limits (
  player       uuid not null references auth.users (id) on delete cascade,
  kind         text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (player, kind)
);


-- ───────────────────────────── 2. DROITS ET RLS ─────────────────────────────

alter table public.regions       enable row level security;
alter table public.players       enable row level security;
alter table public.saves         enable row level security;
alter table public.shelters      enable row level security;
alter table public.relays        enable row level security;
alter table public.relay_rewards enable row level security;
alter table public.rate_limits   enable row level security;

-- On repart de zéro, puis on n'accorde que le strict nécessaire.
revoke all on table public.regions, public.players, public.saves, public.shelters,
                    public.relays, public.relay_rewards, public.rate_limits
  from public, anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on table public.regions, public.shelters, public.players, public.relays to anon, authenticated;
grant insert, update on table public.players to authenticated;
grant select, insert, update on table public.saves to authenticated;
grant select on table public.relay_rewards to authenticated;
-- rate_limits : aucun droit, aucune règle → inaccessible depuis le jeu.

-- regions : lecture par tous.
drop policy if exists regions_read on public.regions;
create policy regions_read on public.regions for select to anon, authenticated using (true);

-- shelters : lecture par tous.
drop policy if exists shelters_read on public.shelters;
create policy shelters_read on public.shelters for select to anon, authenticated using (true);

-- players : lecture par tous, écriture de sa propre ligne seulement.
drop policy if exists players_read on public.players;
create policy players_read on public.players for select to anon, authenticated using (true);
drop policy if exists players_insert_own on public.players;
create policy players_insert_own on public.players for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists players_update_own on public.players;
create policy players_update_own on public.players for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- saves : strictement privé.
drop policy if exists saves_read_own on public.saves;
create policy saves_read_own on public.saves for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists saves_insert_own on public.saves;
create policy saves_insert_own on public.saves for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists saves_update_own on public.saves;
create policy saves_update_own on public.saves for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- relays : les relais en attente sont visibles de tous ; les autres, de leurs porteurs seulement.
drop policy if exists relays_read on public.relays;
create policy relays_read on public.relays for select to anon, authenticated
  using (state = 'waiting' or carrier = (select auth.uid()) or (select auth.uid()) = any (carriers));

-- relay_rewards : chacun ne voit que les siennes.
drop policy if exists relay_rewards_read_own on public.relay_rewards;
create policy relay_rewards_read_own on public.relay_rewards for select to authenticated
  using ((select auth.uid()) = player);


-- ───────────────────────────── 3. FONCTIONS ─────────────────────────────

-- Date de mise à jour automatique (players, saves).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists players_touch on public.players;
create trigger players_touch before update on public.players
  for each row execute function public.touch_updated_at();
drop trigger if exists saves_touch on public.saves;
create trigger saves_touch before update on public.saves
  for each row execute function public.touch_updated_at();

-- Niveau collectif d'un abri (0 à 5). Les étoiles personnelles demandent 100 / 300 / 600 / 1 000 /
-- 1 500 points ; ici c'est l'effort de tous : 600 / 3 000 / 10 000 / 25 000 / 60 000.
create or replace function public.collective_level(p_points bigint)
returns smallint
language sql
immutable
set search_path = public
as $$
  select (case
    when p_points >= 60000 then 5
    when p_points >= 25000 then 4
    when p_points >= 10000 then 3
    when p_points >= 3000  then 2
    when p_points >= 600   then 1
    else 0
  end)::smallint;
$$;

-- Limite de fréquence : vrai si le joueur courant a encore droit à cette action
-- (au plus p_max appels par fenêtre de durée p_window). Fonction interne.
create or replace function public.rate_ok(p_kind text, p_max integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_hits integer;
begin
  if v_uid is null then
    return false;
  end if;
  insert into public.rate_limits as r (player, kind, window_start, hits)
  values (v_uid, p_kind, now(), 1)
  on conflict (player, kind) do update
    set hits         = case when r.window_start < now() - p_window then 1     else r.hits + 1     end,
        window_start = case when r.window_start < now() - p_window then now() else r.window_start end
  returning r.hits into v_hits;
  return v_hits <= p_max;
end;
$$;

-- Une livraison à un abri : ajoute les points à l'abri collectif, à sa région, et note la région du joueur.
--   • au plus 400 points par appel ;
--   • au plus 12 appels par tranche de 10 minutes et par joueur.
-- Renvoie { ok, level, level_before, points, deliveries, region } ou { ok: false, reason }.
create or replace function public.deliver_to_shelter(
  p_shelter_id text,
  p_name       text,
  p_lng        double precision,
  p_lat        double precision,
  p_region     text,
  p_points     integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_name      text := left(btrim(coalesce(p_name, '')), 80);
  v_points    integer := least(400, greatest(1, coalesce(p_points, 1)));
  v_created   integer := 0;
  v_old_level smallint;
  v_region    text;
  v_total     bigint;
  v_count     integer;
  v_level     smallint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if p_shelter_id is null or char_length(p_shelter_id) not between 1 and 80
     or v_name = ''
     or p_lng is null or p_lat is null
     or p_lng not between -5.5 and 10 or p_lat not between 41 and 51.5
     or not exists (select 1 from public.regions g where g.id = p_region) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not public.rate_ok('delivery', 12, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  -- L'abri est créé à sa première livraison ; sa région ne change plus ensuite.
  insert into public.shelters (id, name, lng, lat, region)
  values (p_shelter_id, v_name, p_lng, p_lat, p_region)
  on conflict (id) do nothing;
  get diagnostics v_created = row_count;

  select s.level, s.region into v_old_level, v_region
  from public.shelters s
  where s.id = p_shelter_id
  for update;

  update public.shelters s
     set points     = s.points + v_points,
         deliveries = s.deliveries + 1,
         level      = public.collective_level(s.points + v_points),
         updated_at = now()
   where s.id = p_shelter_id
  returning s.points, s.deliveries, s.level into v_total, v_count, v_level;

  update public.regions g
     set points          = g.points + v_points,
         deliveries      = g.deliveries + 1,
         shelters        = g.shelters + v_created,
         active_shelters = g.active_shelters + (case when v_old_level = 0 and v_level >= 1 then 1 else 0 end),
         updated_at      = now()
   where g.id = v_region;

  insert into public.players (id, region)
  values (v_uid, v_region)
  on conflict (id) do update set region = excluded.region;

  return jsonb_build_object(
    'ok', true, 'level', v_level, 'level_before', v_old_level,
    'points', v_total, 'deliveries', v_count, 'region', v_region);
end;
$$;

-- Dépose un colis dans un abri-relais.
--   • p_relay_id null  : nouveau relais (le joueur confie un de ses colis à la chaîne) ;
--   • p_relay_id donné : le joueur repose un relais qu'il porte, plus près de sa destination.
-- Renvoie { ok, id } ou { ok: false, reason }.
create or replace function public.relay_drop(
  p_relay_id     uuid,
  p_at_shelter   text,
  p_dest_shelter text,
  p_payload      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if p_at_shelter is null or char_length(p_at_shelter) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Un relais porté depuis plus de 72 h est considéré comme abandonné : il retourne à son dernier abri.
  update public.relays r
     set state = 'waiting', at_shelter = r.last_shelter, carrier = null, updated_at = now()
   where r.state = 'carried' and r.updated_at < now() - interval '72 hours' and r.last_shelter is not null;

  if (select count(*) from public.relays r where r.at_shelter = p_at_shelter and r.state = 'waiting') >= 30 then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  if p_relay_id is not null then
    update public.relays r
       set state = 'waiting', at_shelter = p_at_shelter, last_shelter = p_at_shelter,
           carrier = null, updated_at = now()
     where r.id = p_relay_id and r.state = 'carried' and r.carrier = v_uid
       and r.dest_shelter <> p_at_shelter
    returning r.id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_carrier');
    end if;
    return jsonb_build_object('ok', true, 'id', v_id);
  end if;

  if p_dest_shelter is null or char_length(p_dest_shelter) not between 1 and 80
     or p_dest_shelter = p_at_shelter
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or pg_column_size(p_payload) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Au plus 10 relais en circulation lancés par le même joueur, et 20 dépôts par heure.
  if (select count(*) from public.relays r where r.carriers[1] = v_uid and r.state <> 'delivered') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  if not public.rate_ok('relay_drop', 20, interval '1 hour') then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  insert into public.players (id) values (v_uid) on conflict (id) do nothing;

  insert into public.relays (payload, dest_shelter, at_shelter, last_shelter, carrier, carriers, state)
  values (p_payload, p_dest_shelter, p_at_shelter, p_at_shelter, null, array[v_uid], 'waiting')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Prend un relais en attente. Un seul joueur peut gagner : la mise à jour ne passe que si le relais
-- est encore « waiting » (le second appel attend le verrou de ligne, puis ne trouve plus rien).
-- Renvoie { ok, relay } ou { ok: false, reason }.
create or replace function public.relay_take(p_relay_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.relays%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if p_relay_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Relais abandonnés (portés depuis plus de 72 h) : retour à leur dernier abri.
  update public.relays r
     set state = 'waiting', at_shelter = r.last_shelter, carrier = null, updated_at = now()
   where r.state = 'carried' and r.updated_at < now() - interval '72 hours' and r.last_shelter is not null;

  -- Au plus 3 relais portés en même temps.
  if (select count(*) from public.relays r where r.carrier = v_uid and r.state = 'carried') >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;

  insert into public.players (id) values (v_uid) on conflict (id) do nothing;

  update public.relays r
     set state      = 'carried',
         carrier    = v_uid,
         at_shelter = null,
         carriers   = case when v_uid = any (r.carriers) then r.carriers else r.carriers || v_uid end,
         updated_at = now()
   where r.id = p_relay_id and r.state = 'waiting'
  returning r.* into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end if;
  return jsonb_build_object('ok', true, 'relay', to_jsonb(v_row));
end;
$$;

-- Livre un relais à son abri de destination : chaque porteur de la chaîne reçoit une récompense
-- (la valeur de la livraison, 400 points au plus), à réclamer avec relay_claim_rewards().
-- Renvoie { ok, points, hops } ou { ok: false, reason }.
create or replace function public.relay_deliver(p_relay_id uuid, p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_points integer := least(400, greatest(1, coalesce(p_points, 1)));
  v_row    public.relays%rowtype;
  v_hops   integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  if p_relay_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not public.rate_ok('relay_deliver', 12, interval '10 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  update public.relays r
     set state = 'delivered', carrier = null, at_shelter = null, delivered_at = now(), updated_at = now()
   where r.id = p_relay_id and r.state = 'carried' and r.carrier = v_uid
  returning r.* into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_carrier');
  end if;

  v_hops := coalesce(array_length(v_row.carriers, 1), 0);

  insert into public.relay_rewards (relay_id, player, points, hops, parcel)
  select v_row.id, p.id, v_points, v_hops, left(coalesce(v_row.payload ->> 'name', ''), 60)
  from (select distinct c as id from unnest(v_row.carriers) as c) as u
  join public.players p on p.id = u.id
  on conflict (relay_id, player) do nothing;

  return jsonb_build_object('ok', true, 'points', v_points, 'hops', v_hops);
end;
$$;

-- Réclame toutes ses récompenses de relais en attente. Renvoie { ok, points, count }.
create or replace function public.relay_claim_rewards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_points bigint;
  v_count  integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'auth');
  end if;
  with claimed as (
    update public.relay_rewards w
       set claimed_at = now()
     where w.player = v_uid and w.claimed_at is null
    returning w.points
  )
  select coalesce(sum(c.points), 0), count(*)::integer into v_points, v_count from claimed c;
  return jsonb_build_object('ok', true, 'points', v_points, 'count', v_count);
end;
$$;

-- Droits d'exécution : rien par défaut, puis seulement les joueurs connectés (comptes anonymes compris,
-- qui ont le rôle « authenticated »). Le rôle « anon » (sans session) ne peut appeler aucune écriture.
revoke all on function public.touch_updated_at()                                         from public, anon, authenticated;
revoke all on function public.rate_ok(text, integer, interval)                           from public, anon, authenticated;
revoke all on function public.collective_level(bigint)                                   from public, anon, authenticated;
revoke all on function public.deliver_to_shelter(text, text, double precision, double precision, text, integer) from public, anon, authenticated;
revoke all on function public.relay_drop(uuid, text, text, jsonb)                        from public, anon, authenticated;
revoke all on function public.relay_take(uuid)                                           from public, anon, authenticated;
revoke all on function public.relay_deliver(uuid, integer)                               from public, anon, authenticated;
revoke all on function public.relay_claim_rewards()                                      from public, anon, authenticated;

grant execute on function public.collective_level(bigint)                                to anon, authenticated;
grant execute on function public.deliver_to_shelter(text, text, double precision, double precision, text, integer) to authenticated;
grant execute on function public.relay_drop(uuid, text, text, jsonb)                     to authenticated;
grant execute on function public.relay_take(uuid)                                        to authenticated;
grant execute on function public.relay_deliver(uuid, integer)                            to authenticated;
grant execute on function public.relay_claim_rewards()                                   to authenticated;


-- ───────────────────────────── 4. TEMPS RÉEL ─────────────────────────────

-- La carte du réseau écoute la table regions (13 lignes) ; les relais en attente sont publiés aussi.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'regions') then
      alter publication supabase_realtime add table public.regions;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'relays') then
      alter publication supabase_realtime add table public.relays;
    end if;
  end if;
end;
$$;

-- Demande à l'API de relire le schéma tout de suite (sinon elle le fait d'elle-même sous peu).
notify pgrst, 'reload schema';
