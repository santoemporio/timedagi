# Time da Gi — como trabalhar neste repositório

- Código-fonte único: `src/time-da-gi.html` (HTML + CSS + JS vanilla).
- Gerar o site: `cd src && python3 build.py` → escreve em `site/` (não sobrescreve `site/config.js`).
- Publicação: push na branch `main` → Cloudflare Pages publica sozinho (output directory = `site`). URL: https://timedagi.pages.dev
- Banco: Supabase, projeto `cgrmsfmkpsuvfkgmgdfc` (org ZOOEI!). Mudanças de banco via conector Supabase (apply_migration) e também registradas em `db/instalar.sql` (idempotente). Ao mudar a versão do banco, atualize `tg_versao()` e a checagem `authU.dbv<8` no app.
- O conector Supabase só enxerga uma organização por vez (ZOOEI! = Time da Gi; ALRA MARKETING = sistema da Alra).
- Testes: `tests/` (Playwright + PGlite 0.2.17). Rode antes de publicar.
- Ao publicar uma versão nova do app, suba o número de versão no rodapé ("versão N") e o CACHE do sw.js em `src/build.py`.
