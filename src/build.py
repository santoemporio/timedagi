import shutil,os,re
from PIL import Image
D='../site'
src=open('time-da-gi.html').read()
i=src.index('</style>')+len('</style>')
headpart,body=src[:i],src[i:]
head=f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FF2D95">
<meta name="description" content="Comunidade e treinos dos alunos da Coach Gi.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="img/icon-192.png">
<link rel="apple-touch-icon" href="img/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Time da Gi">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<script src="vendor/supabase.js"></script>
<script src="config.js"></script>
{headpart}
<style>body{{margin:0}}img{{max-width:100%}}:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}</style>
</head>
<body>
'''
tail='''
<script>
if("serviceWorker" in navigator && location.protocol==="https:"){window.addEventListener("load",function(){navigator.serviceWorker.register("sw.js").catch(function(){})})}
</script>
</body>
</html>
'''
open(f'{D}/index.html','w').write(head+body+tail)
for f in ['gi.jpg','gi-face.jpg','zooei.png']:shutil.copy('img/'+f,f'{D}/img/'+f)
# icons
logo=Image.open('img/zooei.png').convert('RGBA')
for sz in [512,192,180]:
    bg=Image.new('RGBA',(sz,sz),(255,255,255,255))
    w=int(sz*0.78);h=int(logo.height*w/logo.width)
    lg=logo.resize((w,h),Image.LANCZOS)
    bg.paste(lg,((sz-w)//2,(sz-h)//2),lg)
    bg.convert('RGB').save(f'{D}/img/icon-{sz}.png',optimize=True)
open(f'{D}/manifest.webmanifest','w').write('''{
  "name": "Time da Gi",
  "short_name": "Time da Gi",
  "description": "Treinos, evolução e comunidade dos alunos da Coach Gi.",
  "lang": "pt-BR",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#FFFFFF",
  "theme_color": "#FF2D95",
  "icons": [
    {"src": "img/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "img/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}
  ]
}
''')
open(f'{D}/sw.js','w').write('''// Time da Gi · guarda a interface no celular para abrir rápido e funcionar como app.
const CACHE = "timedagi-v13";
const SHELL = ["./", "./index.html", "./config.js", "./vendor/supabase.js", "./img/zooei.png", "./img/gi.jpg", "./img/gi-face.jpg", "./img/icon-192.png"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
''')
if not os.path.exists(f'{D}/config.js'):
    open(f'{D}/config.js','w').write('''// =============================================================
// Time da Gi · configuração
// Cole aqui os dados do seu projeto Supabase:
// Supabase > Project Settings > API (ou Data API)
//   supabaseUrl  = "Project URL"
//   supabaseKey  = chave "anon" "public" (é pública por natureza; as regras do banco protegem os dados)
// =============================================================
window.TG_CONFIG = {
  supabaseUrl: "https://SEU-PROJETO.supabase.co",
  supabaseKey: "SUA-CHAVE-ANON-PUBLICA",
  dominio: "timedagi.app"
};
''')
open(f'{D}/_headers','w').write('''/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/config.js
  Cache-Control: no-cache
''')
print(sorted(os.listdir(D)), sorted(os.listdir(D+'/img')))
