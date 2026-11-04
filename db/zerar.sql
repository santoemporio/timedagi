-- =====================================================================
-- Time da Gi · ZERAR TUDO (só se quiser começar do zero)
-- ATENÇÃO: apaga alunos, planilhas, treinos, mural, anamneses e as contas
-- de login do app (inclusive a da coach). Não tem como desfazer.
-- Depois de rodar este, rode o instalar.sql.
-- =====================================================================
drop table if exists public.docs   cascade;
drop table if exists public.admins cascade;
drop function if exists public.is_admin()                          cascade;
drop function if exists public.is_member()                         cascade;
drop function if exists public.docs_touch()                        cascade;
drop function if exists public.perfis_guard()                      cascade;
drop function if exists public.admin_set_password(uuid, text)      cascade;
drop function if exists public.admin_set_login(uuid, text)         cascade;
drop function if exists public.admin_delete_user(uuid)             cascade;
drop function if exists public.admin_create_user(text, text)       cascade;
drop function if exists public.tg_new_auth_user(text, text)        cascade;
drop function if exists public.tg_versao()                         cascade;
delete from auth.users where email like '%@timedagi.app';
select 'Zerado. Agora rode o instalar.sql.' as resultado;
