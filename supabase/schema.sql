-- Question pour une championne : schéma Supabase
-- À coller dans Supabase > SQL Editor > New query, puis "Run".
-- Le script peut être relancé sans risque : il crée ce qui manque et met
-- à jour les règles. Il migre aussi une ancienne base à un seul quiz.

-- 0. Droits de base ------------------------------------------------------
-- Les nouveaux projets Supabase ne les donnent plus automatiquement.
-- Les règles RLS plus bas restent appliquées par-dessus.
grant usage on schema public to anon, authenticated;

-- 1. Table des quiz ------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  published   boolean not null default false, -- visible dans la liste des quiz
  created_at  timestamptz not null default now()
);

alter table public.quizzes enable row level security;
grant select on public.quizzes to anon, authenticated;
grant insert, update, delete on public.quizzes to authenticated;

-- Un quiz publié est visible par tous ; un brouillon seulement par son auteur
drop policy if exists "quiz visibles" on public.quizzes;
create policy "quiz visibles"
  on public.quizzes for select
  to anon, authenticated
  using (published or owner = auth.uid());

drop policy if exists "quiz créés par leur auteur" on public.quizzes;
create policy "quiz créés par leur auteur"
  on public.quizzes for insert
  to authenticated
  with check (owner = auth.uid());

drop policy if exists "quiz modifiables par leur auteur" on public.quizzes;
create policy "quiz modifiables par leur auteur"
  on public.quizzes for update
  to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists "quiz supprimables par leur auteur" on public.quizzes;
create policy "quiz supprimables par leur auteur"
  on public.quizzes for delete
  to authenticated
  using (owner = auth.uid());

-- 2. Table des questions -------------------------------------------------
create table if not exists public.questions (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answers     text[] not null check (array_length(answers, 1) = 4),
  correct     smallint not null check (correct between 0 and 3),
  photo_path  text,                       -- chemin du fichier dans le bucket "photos"
  position    integer not null default 0, -- ordre d'affichage dans le quiz
  created_at  timestamptz not null default now()
);

alter table public.questions
  add column if not exists quiz_id uuid references public.quizzes (id) on delete cascade;

-- Migration : les questions d'avant (sans quiz) vont dans un premier quiz,
-- publié et attribué au premier compte admin créé.
do $$
declare
  first_admin uuid;
  first_quiz  uuid;
begin
  if exists (select 1 from public.questions where quiz_id is null) then
    select id into first_admin from auth.users order by created_at limit 1;
    if first_admin is null then
      raise exception 'Crée d''abord un compte admin (Authentication > Users), puis relance ce script.';
    end if;
    insert into public.quizzes (owner, title, description, published)
    values (first_admin, 'Est-ce que tu me connais vraiment ?', 'Le tout premier quiz.', true)
    returning id into first_quiz;
    update public.questions set quiz_id = first_quiz where quiz_id is null;
  end if;
end $$;

alter table public.questions alter column quiz_id set not null;
create index if not exists questions_quiz_id_idx on public.questions (quiz_id, position);

alter table public.questions enable row level security;
grant select on public.questions to anon, authenticated;
grant insert, update, delete on public.questions to authenticated;

-- Anciennes règles (version à un seul quiz)
drop policy if exists "questions lisibles par tous" on public.questions;
drop policy if exists "questions modifiables par l'admin" on public.questions;

-- Les questions se lisent si leur quiz est visible pour la personne
drop policy if exists "questions des quiz visibles" on public.questions;
create policy "questions des quiz visibles"
  on public.questions for select
  to anon, authenticated
  using (exists (
    select 1 from public.quizzes q
    where q.id = quiz_id and (q.published or q.owner = auth.uid())
  ));

-- Seul l'auteur du quiz peut ajouter / modifier / supprimer ses questions
drop policy if exists "questions modifiables par l'auteur du quiz" on public.questions;
create policy "questions modifiables par l'auteur du quiz"
  on public.questions for all
  to authenticated
  using (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner = auth.uid()))
  with check (exists (select 1 from public.quizzes q where q.id = quiz_id and q.owner = auth.uid()));

-- 3. Bucket des photos ---------------------------------------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do update set public = true;

-- Lecture publique (nécessaire pour afficher les photos dans le quiz)
drop policy if exists "photos lisibles par tous" on storage.objects;
create policy "photos lisibles par tous"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'photos');

-- Envoi / remplacement / suppression réservés aux admins connectés
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
