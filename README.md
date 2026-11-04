# Time da Gi

App de treinos e comunidade dos alunos da Coach Gi.

- `site/` — o que vai para o ar (Cloudflare Pages, output directory = `site`)
- `src/` — código-fonte (`time-da-gi.html`) e `build.py`, que gera a pasta `site/`
- `db/` — scripts do banco Supabase (`instalar.sql` é idempotente; `zerar.sql` apaga tudo)
- `tests/` — testes (Playwright + PGlite)
