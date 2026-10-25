-- Carnet value — structure de la base (à coller dans Supabase > SQL Editor, puis « Run »)

create table if not exists public.docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Met à jour la date de modification automatiquement
create or replace function public.docs_touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.docs_touch();

-- Sécurité : seules les personnes connectées (toi) peuvent lire et écrire.
-- Pense à désactiver les inscriptions (voir le guide) pour rester seul utilisateur.
alter table public.docs enable row level security;
drop policy if exists "lecture connectee" on public.docs;
drop policy if exists "ajout connecte" on public.docs;
drop policy if exists "modif connectee" on public.docs;
drop policy if exists "suppr connectee" on public.docs;
create policy "lecture connectee" on public.docs for select to authenticated using (true);
create policy "ajout connecte"    on public.docs for insert to authenticated with check (true);
create policy "modif connectee"   on public.docs for update to authenticated using (true) with check (true);
create policy "suppr connectee"   on public.docs for delete to authenticated using (true);
