-- Question pour une championne : schéma Supabase
-- À coller une seule fois dans Supabase > SQL Editor > New query, puis "Run".

-- 1. Table des questions -------------------------------------------------
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answers     text[] not null check (array_length(answers, 1) = 4),
  correct     smallint not null check (correct between 0 and 3),
  photo_path  text,                       -- chemin du fichier dans le bucket "photos"
  position    integer not null default 0, -- ordre d'affichage
  created_at  timestamptz not null default now()
);

alter table public.questions enable row level security;

-- Tout le monde peut lire les questions (le quiz est public)
drop policy if exists "questions lisibles par tous" on public.questions;
create policy "questions lisibles par tous"
  on public.questions for select
  to anon, authenticated
  using (true);

-- Seul l'admin connecté peut ajouter / modifier / supprimer
drop policy if exists "questions modifiables par l'admin" on public.questions;
create policy "questions modifiables par l'admin"
  on public.questions for all
  to authenticated
  using (true)
  with check (true);

-- 2. Bucket des photos ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- Lecture publique (nécessaire pour afficher les photos dans le quiz)
drop policy if exists "photos lisibles par tous" on storage.objects;
create policy "photos lisibles par tous"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'photos');

-- Envoi / remplacement / suppression réservés à l'admin connecté
drop policy if exists "photos envoyables par l'admin" on storage.objects;
create policy "photos envoyables par l'admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'photos');

drop policy if exists "photos modifiables par l'admin" on storage.objects;
create policy "photos modifiables par l'admin"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'photos');

drop policy if exists "photos supprimables par l'admin" on storage.objects;
create policy "photos supprimables par l'admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'photos');
