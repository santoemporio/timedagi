-- =====================================================================
-- Time da Gi · INSTALAÇÃO DO BANCO (versão 8)
-- Cole TUDO no SQL Editor do Supabase e clique em "Run".
-- Pode rodar quantas vezes quiser: não apaga dados e deixa tudo na versão certa.
-- Ele também cria a conta da coach (usuário coachgi, senha 0123) se ela não existir.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Tudo do app fica numa tabela só: cada linha é um documento de uma coleção
-- (perfis, planos, checkins, posts, comentarios, curtidas, contatos, anamnese, config).
create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs replica identity full;

-- Quem é administradora (a coach). Só entra aqui por este script.
create table if not exists public.admins (
  uid uuid primary key
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where uid = auth.uid());
$$;

-- É aluno ativo? (tem perfil criado pela coach e não está arquivado)
create or replace function public.is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.docs p
     where p.col = 'perfis' and p.id = auth.uid()::text
       and coalesce((p.data->>'arquivado')::boolean, false) = false
  );
$$;

-- Data de atualização automática
create or replace function public.docs_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs
for each row execute function public.docs_touch();

-- Aluno só pode mudar a própria foto e o aviso da anamnese no seu perfil.
-- Nome, usuário, dias, objetivo, arquivamento etc. só a coach altera.
create or replace function public.perfis_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.col = 'perfis' and not public.is_admin() then
    if (new.data - array['foto','anamneseOk']) is distinct from (old.data - array['foto','anamneseOk']) then
      raise exception 'Somente a coach pode alterar estes dados do perfil' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists perfis_guard on public.docs;
create trigger perfis_guard before update on public.docs
for each row execute function public.perfis_guard();

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
-- ---------------------------------------------------------------------
alter table public.docs   enable row level security;
alter table public.admins enable row level security;

drop policy if exists docs_read   on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

-- Ler: aluno ativo lê o mural, perfis e planilhas. Conta sem perfil não lê nada
-- (só o próprio perfil, para o app saber se está arquivado).
-- WhatsApp (contatos) só a coach. Anamnese: a coach e o próprio aluno.
create policy docs_read on public.docs for select to authenticated using (
  case col
    when 'contatos' then public.is_admin()
    when 'anamnese' then public.is_admin() or id = auth.uid()::text
    when 'perfis'   then public.is_member() or id = auth.uid()::text
    else public.is_member()
  end
);

-- Criar: a coach cria tudo. O aluno cria só o próprio treino, os próprios
-- comentários e reações, e a própria ficha de anamnese.
create policy docs_insert on public.docs for insert to authenticated with check (
  public.is_admin()
  or (public.is_member() and (
        (col = 'checkins' and data->>'alunoId' = auth.uid()::text)
     or (col in ('comentarios','curtidas') and data->>'autor' = auth.uid()::text)
     or (col = 'anamnese' and id = auth.uid()::text)
  ))
);

-- Alterar: a coach altera tudo. O aluno altera o próprio perfil (foto) e a própria anamnese.
create policy docs_update on public.docs for update to authenticated
using (
  public.is_admin()
  or (public.is_member() and col in ('perfis','anamnese') and id = auth.uid()::text)
)
with check (
  public.is_admin()
  or (public.is_member() and col in ('perfis','anamnese') and id = auth.uid()::text)
);

-- Apagar: a coach apaga tudo. O aluno apaga só os próprios comentários e reações.
create policy docs_delete on public.docs for delete to authenticated using (
  public.is_admin()
  or (public.is_member() and col in ('comentarios','curtidas') and data->>'autor' = auth.uid()::text)
);

revoke all on public.docs   from anon;
revoke all on public.admins from anon, authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- ---------------------------------------------------------------------
-- Funções que só a coach pode chamar (senha, usuário e remoção de aluno)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_password(target uuid, new_password text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'Somente a coach' using errcode = '42501'; end if;
  if length(new_password) < 6 then raise exception 'Senha curta'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target;
end $$;

create or replace function public.admin_set_login(target uuid, new_email text)
returns void language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.is_admin() then raise exception 'Somente a coach' using errcode = '42501'; end if;
  update auth.users set email = lower(new_email), updated_at = now() where id = target;
  update auth.identities
     set identity_data = jsonb_set(coalesce(identity_data,'{}'::jsonb), '{email}', to_jsonb(lower(new_email)))
   where user_id = target and provider = 'email';
end $$;

create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Somente a coach' using errcode = '42501'; end if;
  if exists (select 1 from public.admins where uid = target) then raise exception 'Não é possível remover a coach'; end if;
  delete from auth.users where id = target;
end $$;

-- Cria uma conta de login direto no banco (uso interno; ninguém chama de fora).
-- Não usa o cadastro público do Supabase, por isso não precisa de e-mail real.
create or replace function public.tg_new_auth_user(new_email text, new_password text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text := lower(trim(new_email));
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change,
                          email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
          extensions.crypt(new_password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
          '', '', '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
          'email', now(), now(), now());
  return uid;
end $$;
revoke all on function public.tg_new_auth_user(text, text) from public, anon, authenticated;

-- A coach cria a conta de login de um aluno (o app chama esta função).
create or replace function public.admin_create_user(new_email text, new_password text)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare em text := lower(trim(new_email));
begin
  if not public.is_admin() then raise exception 'Somente a coach' using errcode = '42501'; end if;
  if length(new_password) < 6 then raise exception 'Senha curta'; end if;
  if exists (select 1 from auth.users where email = em) then raise exception 'User already registered'; end if;
  return public.tg_new_auth_user(em, new_password);
end $$;
revoke all on function public.admin_create_user(text, text) from public, anon;

-- Versão do banco (o app confere e avisa a coach se estiver desatualizado)
create or replace function public.tg_versao()
returns int language sql stable as $$ select 8 $$;
grant execute on function public.tg_versao() to authenticated;
grant execute on function public.admin_create_user(text, text) to authenticated;

revoke all on function public.admin_set_password(uuid, text) from public, anon;
revoke all on function public.admin_set_login(uuid, text)    from public, anon;
revoke all on function public.admin_delete_user(uuid)        from public, anon;
grant execute on function public.is_admin()                        to authenticated;
grant execute on function public.is_member()                       to authenticated;
grant execute on function public.admin_set_password(uuid, text)    to authenticated;
grant execute on function public.admin_set_login(uuid, text)       to authenticated;
grant execute on function public.admin_delete_user(uuid)           to authenticated;

-- Atualização ao vivo (mural e painel se atualizam sozinhos)
do $$
begin
  alter publication supabase_realtime add table public.docs;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- Conta da coach: cria se não existir (usuário coachgi · senha 0123)
-- e garante que ela é a administradora.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from auth.users where email = 'coachgi@timedagi.app') then
    perform public.tg_new_auth_user('coachgi@timedagi.app', 'tg_0123');
  end if;
end $$;
update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
 where email = 'coachgi@timedagi.app';
insert into public.admins (uid)
select id from auth.users where email = 'coachgi@timedagi.app'
on conflict do nothing;

select case when exists (select 1 from public.admins a join auth.users u on u.id = a.uid where u.email = 'coachgi@timedagi.app')
             and exists (select 1 from pg_proc where proname = 'admin_create_user')
            then 'Pronto! Banco na versão 8. Coach: usuário coachgi.'
            else 'Algo não foi criado. Copie a mensagem de erro acima e me mande.'
       end as resultado;
