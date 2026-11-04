create role anon; create role authenticated;
create schema auth; create schema extensions;
create table auth.users(instance_id uuid, id uuid primary key default gen_random_uuid(), aud text, role text, email text unique, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz, confirmation_token text, recovery_token text, email_change_token_new text, email_change text, email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text);
create table auth.identities(id uuid, user_id uuid references auth.users(id) on delete cascade, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function extensions.gen_salt(text) returns text language sql as $$ select 'x' $$;
create function extensions.crypt(p text, s text) returns text language sql as $$ select 'h:'||md5(p) $$;
grant usage on schema auth, extensions to authenticated;
