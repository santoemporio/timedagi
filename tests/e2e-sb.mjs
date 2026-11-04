// E2E da versão hospedada: o site real (dist/) rodando contra um Postgres local com o
// supabase.sql aplicado (mesmas regras de acesso). O cliente Supabase do navegador é
// substituído por um cliente fino que executa as consultas nesse Postgres como o usuário logado.
import {PGlite} from '@electric-sql/pglite';
import fs from 'fs';import http from 'http';import path from 'path';
import {createRequire} from 'module';const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const ROOT=path.resolve('../dist');
const db=new PGlite();
await db.exec(fs.readFileSync('prelude.sql','utf8'));
await db.exec("insert into auth.users(email,encrypted_password) values('coachgi@timedagi.app','h:'||md5('tg_0123'))");
await db.exec(fs.readFileSync(ROOT+'/supabase.sql','utf8').replace(/create extension if not exists pgcrypto with schema extensions;/,'').replace(/do \$\$\s*begin\s*alter publication[\s\S]*?end \$\$;/,''));
const lit=v=>v==null?'null':"'"+String(v).replace(/'/g,"''")+"'";
let chain=Promise.resolve();const serial=f=>{const p=chain.then(f,f);chain=p.catch(()=>{});return p};
async function asUser(uid,sql){await db.exec(uid?`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`:`set role anon; select set_config('request.jwt.claim.sub','',false)`);
  try{const r=await db.exec(sql);return{data:r[r.length-1].rows,error:null}}catch(e){return{data:null,error:{message:e.message,code:e.code}}}finally{await db.exec('reset role')}}
async function handle(o){
  switch(o.op){
    case'signin':{const r=await db.query("select id,email from auth.users where email=$1 and encrypted_password=extensions.crypt($2,encrypted_password)",[o.email,o.password]);return r.rows[0]?{data:{user:r.rows[0]}}:{error:{message:'Invalid login credentials'}}}
    case'signup':{return{error:{message:'Email address "'+o.email+'" is invalid'}};const ex=await db.query("select 1 from auth.users where email=$1",[o.email.toLowerCase()]);if(ex.rows.length)return{error:{message:'User already registered'}};
      if(o.password.length<6)return{error:{message:'Password should be at least 6 characters'}};const r=await db.query("insert into auth.users(email,encrypted_password) values(lower($1),extensions.crypt($2,'x')) returning id,email",[o.email,o.password]);return{data:{user:Object.assign(r.rows[0],{identities:[{}]})}}}
    case'setpw':{if(!o.uid)return{error:{message:'not logged'}};await db.query("update auth.users set encrypted_password=extensions.crypt($1,'x') where id=$2",[o.password,o.uid]);return{data:{}}}
    case'select':if(globalThis.FAIL_SEL)return{error:{message:'Failed to fetch'}};return asUser(o.uid,`select id,data from public.docs where col=${lit(o.col)}${o.id!=null?' and id='+lit(o.id):''}`);
    case'upsert':return asUser(o.uid,`insert into public.docs(col,id,data) values(${lit(o.col)},${lit(o.id)},${lit(JSON.stringify(o.data))}::jsonb) on conflict(col,id) do update set data=excluded.data`);
    case'update':return asUser(o.uid,`update public.docs set data=${lit(JSON.stringify(o.data))}::jsonb where col=${lit(o.col)} and id=${lit(o.id)} returning id`);
    case'delete':return asUser(o.uid,`delete from public.docs where col=${lit(o.col)} and id=${lit(o.id)} returning id`);
    case'rpc':{const a=o.args||{};const args={is_admin:'',tg_versao:'',admin_set_password:`${lit(a.target)}::uuid,${lit(a.new_password)}`,admin_set_login:`${lit(a.target)}::uuid,${lit(a.new_email)}`,admin_delete_user:`${lit(a.target)}::uuid`,admin_create_user:`${lit(a.new_email)},${lit(a.new_password)}`}[o.name];
      const r=await asUser(o.uid,`select public.${o.name}(${args}) as v`);if(r.error)return r;return{data:r.data[0].v,error:null}}
  }return{error:{message:'op?'}}}
const FAKE=`(()=>{const KEY="tg-fake-session";
function mk(opts){const persist=!(opts&&opts.auth&&opts.auth.persistSession===false);let cur=persist?JSON.parse(localStorage.getItem(KEY)||"null"):null;
 const call=o=>window.__pg(JSON.stringify(Object.assign({uid:cur&&cur.user.id},o))).then(JSON.parse);
 const save=()=>{if(persist){cur?localStorage.setItem(KEY,JSON.stringify(cur)):localStorage.removeItem(KEY)}};
 const auth={async getSession(){return{data:{session:cur}}},
  async signInWithPassword({email,password}){const r=await call({op:'signin',email,password});if(r.error)return{data:{},error:r.error};cur={user:r.data.user};save();return{data:{user:cur.user,session:cur},error:null}},
  async signUp({email,password}){const r=await call({op:'signup',email,password});if(r.error)return{data:{},error:r.error};return{data:{user:r.data.user},error:null}},
  async signOut(){cur=null;save();return{error:null}},
  async updateUser({password}){const r=await call({op:'setpw',password});return{data:{},error:r.error||null}}};
 function q(){const st={f:{}};const b={select(){st.sel=1;return b},eq(k,v){st.f[k]=v;return b},maybeSingle(){st.single=1;return b},upsert(row){st.op='upsert';st.row=row;return b},update(o){st.op='update';st.row=o;return b},delete(){st.op='delete';return b},
  then(res,rej){const op=st.op||'select';return call({op,col:st.f.col!=null?st.f.col:st.row&&st.row.col,id:st.f.id!=null?st.f.id:st.row&&st.row.id,data:st.row&&st.row.data}).then(r=>{if(r.error)return{data:null,error:r.error};if(op==='select'&&st.single)return{data:(r.data||[])[0]||null,error:null};if((op==='upsert'||op==='delete')&&!st.sel)return{data:null,error:null};return{data:r.data,error:null}}).then(res,rej)}};return b}
 return{auth,from(){return q()},rpc(name,args){return call({op:'rpc',name,args:args||{}})},channel(){const ch={on(){return ch},subscribe(){return ch}};return ch}}}
window.supabase={createClient:(u,k,o)=>mk(o)};})();`;
const CONFIG=`window.TG_CONFIG={supabaseUrl:"https://teste.supabase.co",supabaseKey:"chave-teste",dominio:"timedagi.app"};`;
const types={'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';
  if(p==='/vendor/supabase.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(FAKE)}
  if(p==='/config.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(CONFIG)}
  const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end()}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res)}).listen(0);
const URL0='http://127.0.0.1:'+srv.address().port+'/';
const R=[];const ok=(n,c,x)=>R.push((c?'PASS ':'FAIL ')+n+(x!==undefined&&!c?' — '+String(x).slice(0,140):''));
const sql=async q=>(await db.query(q)).rows;
const browser=await chromium.launch();const ctx=await browser.newContext({viewport:{width:400,height:880}});const page=await ctx.newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|fonts\.g/.test(m.text()))errs.push(m.text())});
await page.exposeFunction('__pg',s=>serial(()=>handle(JSON.parse(s))).then(JSON.stringify));
const login=async(u,p)=>{await page.fill('#lg-user',u);await page.fill('#lg-pass',p);await page.click('#lg-btn')};
const logout=async()=>{await page.click('#nav-sair');await page.waitForSelector('#view-gate:not([hidden])')};
try{
  await page.goto(URL0);await page.waitForSelector('#view-gate:not([hidden])');
  ok('Site hospedado abre na tela de login',true);
  await login('coachgi','9999');await page.waitForFunction(()=>document.querySelector('#lg-msg').textContent.includes('incorretos'));ok('Senha errada recusada pelo Supabase',true);
  await login('coachgi','0123');await page.waitForSelector('#view-painel:not([hidden])');ok('coachgi / 0123 entra como administradora',true);ok('Banco na versão 8: sem aviso de banco desatualizado',!(await page.$('#db-old')));
  // cadastro com conta real
  await page.click('#ptabs [data-tab="alunos"]');
  await page.type('#fa-nome','Pablo Teste');await page.fill('#fa-lg','pablo');await page.fill('#fa-pw','4321');await page.fill('#fa-wa','(51) 99888-7766');
  await page.click('#fa-wd [data-wd="1"]');await page.click('#fa-wd [data-wd="4"]');await page.fill('#fa-om','Voltar a correr');
  await page.click('#fa button[type="submit"]');await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('Aluno adicionado'),null,{timeout:8000});
  const u=(await sql("select id from auth.users where email='pablo@timedagi.app'"))[0];ok('Cadastro cria a conta de login do aluno',!!u);
  const alId=u&&u.id;
  ok('Perfil do aluno usa o id da conta e não guarda senha',(await sql(`select data->>'senhaHash' h from public.docs where col='perfis' and id='${alId}'`))[0]?.h===null);
  ok('WhatsApp salvo em área só da coach',(await sql(`select count(*)::int n from public.docs where col='contatos' and id='${alId}'`))[0].n===1);
  // usuário repetido
  await page.fill('#fa-nome','Outro');await page.fill('#fa-lg','pablo');await page.fill('#fa-pw','1111');await page.click('#fa-wd [data-wd="2"]');await page.click('#fa button[type="submit"]');
  await page.waitForFunction(()=>document.querySelector('#fa-msg').textContent.includes('já existe'));ok('Usuário repetido é bloqueado',true);
  // planilha
  await page.click('#ptabs [data-tab="treinos"]');await page.click('#ed-new');await page.waitForSelector('#ed-form');
  const dA=await page.$$('[data-letter="A"] .ed-dia');
  for(const [i,d] of dA.entries()){await (await d.$('[data-dt="titulo"]')).fill(i?'Inferiores':'Superiores');await (await d.$('[data-f="nome"]')).fill(i?'Agachamento':'Supino');await (await d.$('[data-f="carga"]')).fill('20 kg')}
  await page.click('[data-edl="B"]');await page.click('#copy-ab');await page.click('#ed-form button[type="submit"]');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('publicada'),null,{timeout:8000});
  ok('Coach publica a quinzena no banco',(await sql("select count(*)::int n from public.docs where col='planos'"))[0].n===2);
  // aluno
  await logout();await login('pablo','4321');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});ok('Aluno entra com a conta criada pela coach',true);
  ok('Aluno não vê o Painel',await page.isHidden('#nav-painel'));
  ok('Aluno vê a quinzena com datas',(await page.$$('#al-plan .cal-c.tr')).length===4);
  const contatosVisiveis=await page.evaluate(async()=>{const c=window.supabase.createClient('', '');return (await c.from('docs').select('id,data').eq('col','contatos')).data});
  ok('Aluno não consegue ler WhatsApp de ninguém (regra do banco)',Array.isArray(contatosVisiveis)&&contatosVisiveis.length===0,JSON.stringify(contatosVisiveis));
  const hackPlan=await page.evaluate(async()=>{const c=window.supabase.createClient('','');return (await c.from('docs').upsert({col:'planos',id:'hack',data:{}})).error});
  ok('Aluno não consegue criar planilha (regra do banco)',!!hackPlan);
  const hackLogin=await page.evaluate(async(id)=>{const c=window.supabase.createClient('','');return (await c.from('docs').update({data:{login:'x'}}).eq('col','perfis').eq('id',id).select('id')).error},alId);
  ok('Aluno não consegue mudar o próprio usuário/dados (regra do banco)',!!hackLogin);
  // treino
  await page.click('#al-plan [data-sel^="A"]');
  for(const b of await page.$$('#al-plan [data-chk]'))await b.click();
  await page.click('#finish-btn');await page.click('#humor [data-h="5"]');await page.fill('#f-msg','Bora, time!');await page.fill('#f-com','Achei leve');await page.click('#f-save');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('Treino salvo'),null,{timeout:8000});
  ok('Aluno finaliza treino e ele fica salvo',(await sql(`select count(*)::int n from public.docs where col='checkins' and data->>'alunoId'='${alId}'`))[0].n===1);
  await page.waitForTimeout(600);await page.click('#al-plan .dia-chip >> nth=0');ok('Treino finalizado fica travado',await page.isVisible('.done-banner')&&(await page.$$('#start-wk')).length===0);
  // reação
  await page.click('[data-go="mural"]');await page.waitForSelector('#feed [data-tipo="fogo"]');await page.click('#feed [data-tipo="fogo"]');await page.waitForTimeout(400);
  const c1=(await sql("select count(*)::int n from public.docs where col='curtidas'"))[0].n;await page.click('#feed [data-tipo="fogo"]');await page.waitForTimeout(400);
  const c2=(await sql("select count(*)::int n from public.docs where col='curtidas'"))[0].n;ok('Reação liga e desliga no banco',c1===1&&c2===0,c1+'/'+c2);
  // foto
  await page.click('[data-go="eu"]');await page.click('#photo-btn');await page.setInputFiles('#ph-file',path.join(ROOT,'img/gi-face.jpg'));await page.waitForSelector('#cr-ok');await page.click('#cr-ok');await page.click('#ph-save');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('Foto'),null,{timeout:8000});
  ok('Aluno salva a própria foto',(await sql(`select length(data->>'foto')::int n from public.docs where col='perfis' and id='${alId}'`))[0].n>1000);
  // senha
  await page.click('#al-senha');await page.fill('#pw-a','4321');await page.fill('#pw-n','135790');await page.fill('#pw-c','135790');await page.click('#pw-form button');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('Senha alterada'),null,{timeout:8000});
  await logout();await login('pablo','4321');await page.waitForFunction(()=>document.querySelector('#lg-msg').textContent.includes('incorretos'),null,{timeout:8000});ok('Senha antiga deixa de valer',true);
  await login('pablo','135790');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});ok('Senha nova do aluno funciona',true);
  // coach: anamnese, nova senha pelo painel, arquivar, remover
  await logout();await login('coachgi','0123');await page.waitForSelector('#view-painel:not([hidden])');
  await page.click('#ptabs [data-tab="alunos"]');await page.click(`[data-edit="${alId}"]`);await page.fill('#fa-pw','2468');await page.click('#fa button[type="submit"]');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('atualizado'),null,{timeout:8000});
  await page.click(`[data-perfil="${alId}"]`);await page.click('.sheet details.anam summary');
  await page.evaluate(()=>{const a=document.querySelector('[data-anamsend]');a.addEventListener('click',e=>e.preventDefault(),{once:true});a.click()});await page.waitForTimeout(400);await page.click('#sx');
  await logout();await login('pablo','2468');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});ok('Coach redefine a senha do aluno pelo Painel',true);
  await page.waitForSelector('#anam-go');await page.click('#anam-go');
  await page.fill('#an-nasc','1995-03-20');await page.fill('#an-tel','51 99888-7766');await page.fill('#an-objetivo','Ganhar força');await page.click('#an-next');
  await page.fill('#an-local','Lifit');await page.check('#an-ok');await page.click('#an-next');
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('Ficha enviada'),null,{timeout:8000});
  ok('Aluno envia a ficha de anamnese',(await sql(`select data->'d'->>'objetivo' o from public.docs where col='anamnese' and id='${alId}'`))[0]?.o==='Ganhar força');
  await logout();await login('coachgi','0123');await page.waitForSelector('#view-painel:not([hidden])');
  await page.click('[data-go="mural"]');await page.waitForSelector(`[data-aluno="${alId}"]`);await page.click(`[data-aluno="${alId}"]`);await page.click('.sheet details.anam summary');
  ok('Coach lê a anamnese no perfil',(await page.textContent('.sheet .anam')).includes('Ganhar força'));await page.click('#sx');
  await page.click('[data-go="painel"]');await page.click('#ptabs [data-tab="alunos"]');await page.click(`[data-arch="${alId}"]`);await page.waitForTimeout(500);
  await logout();await login('pablo','2468');
  await page.waitForFunction(()=>!document.querySelector('#view-gate').hidden&&document.querySelector('#lg-msg').textContent.includes('pausado'),null,{timeout:10000});ok('Aluno arquivado é desconectado com aviso',true);
  await login('coachgi','0123');await page.waitForSelector('#view-painel:not([hidden])');await page.click('#ptabs [data-tab="alunos"]');await page.click('[data-arq="1"]');
  await page.click(`[data-more="${alId}"]`);await page.click(`[data-rm="${alId}"]`);await page.click(`[data-rm="${alId}"]`);
  await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('removido'),null,{timeout:10000});
  ok('Remover apaga a conta de login e os dados do aluno',(await sql(`select count(*)::int n from auth.users where id='${alId}'`))[0].n===0&&(await sql(`select count(*)::int n from public.docs where id='${alId}' or data->>'alunoId'='${alId}'`))[0].n===0);
  // alunos de teste
  await page.click('#ptabs [data-tab="ajustes"]');await page.click('#ex-add');await page.waitForFunction(()=>document.querySelector('#toast-root').textContent.includes('criados'),null,{timeout:20000});
  ok('Alunos de teste ganham contas reais',(await sql("select count(*)::int n from auth.users where email in ('aninha@timedagi.app','brunao@timedagi.app','carlinha@timedagi.app')"))[0].n===3);
  // ===== financeiro =====
  {const poke2=async()=>{await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.waitForTimeout(700)};
  const hojeK=(n=0)=>{const d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  const an=(await sql("select id from public.docs where col='perfis' and data->>'login'='aninha'"))[0].id;
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{}});
  await page.click('#ptabs [data-tab="fin"]');await page.waitForSelector('.fin-stats');
  ok('Financeiro abre com visão do mês e próximos passos',(await page.textContent('#painel')).includes('Próximos passos')&&(await page.textContent('#painel')).includes('Definir o plano'));
  await page.click(`#painel [data-finopen="${an}"]`);await page.selectOption('#ff-pl','atleta');await page.click('#ff button[type="submit"]');await page.waitForTimeout(900);
  ok('Coach define plano Atleta',(await sql(`select data->>'plano' p from public.docs where col='fin' and id='${an}'`))[0]?.p==='atleta');
  await page.evaluate(()=>{const c=document.querySelector('#sx')||document.querySelector('#ov');if(c)c.click()});await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});
  await db.query("insert into public.docs(col,id,data) values('anamnese',$1,$2) on conflict(col,id) do update set data=excluded.data",[an,JSON.stringify({d:{objetivo:'Correr 10 km sem parar',local:'academia do bairro',treina:'Sim',treinaQue:'corrida',treinaVezes:'2x',dores:'Joelho esquerdo dói em agachamento'},por:'aluno',preenchidoEm:hojeK()})]);
  await db.query("update public.docs set data=data||$2 where col='perfis' and id=$1",[an,JSON.stringify({anamneseOk:hojeK()})]);
  await page.click('#ptabs [data-tab="hoje"]');await page.click('#ptabs [data-tab="fin"]');await poke2();await page.click('#ptabs [data-tab="fin"]');
  ok('Anamnese preenchida vira passo de boas-vindas',(await page.textContent('#painel')).includes('enviar boas-vindas'));
  await page.click(`[data-finmsg="bv"][data-id="${an}"]`);const bv=await page.inputValue('#ms-t');
  ok('Boas-vindas personalizadas: objetivo, dores, 7 dias, valor, Pix e comprovante',/correr 10 km sem parar/.test(bv)&&/dores/.test(bv)&&/7 dias/.test(bv)&&/R\$\s?160,00/.test(bv)&&/000201.*br\.gov\.bcb\.pix/.test(bv)&&/comprovante/.test(bv),bv);
  const code=(bv.match(/000201.*$/m)||[''])[0].trim();
  const crc=s=>{let c=0xFFFF;for(let i=0;i<s.length;i++){c^=s.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=(c&0x8000)?((c<<1)^0x1021)&0xFFFF:(c<<1)&0xFFFF}return c.toString(16).toUpperCase().padStart(4,'0')};
  ok('Pix copia e cola válido (chave +5551997770125, R$ 160,00, CRC confere)',code.includes('0114+5551997770125')&&code.includes('5406160.00')&&crc(code.slice(0,-4))===code.slice(-4),code);
  await page.click('#ms-cp');await page.waitForTimeout(900);
  ok('Enviar marca as boas-vindas como feitas',!!(await sql(`select data->>'boasVindasEm' b from public.docs where col='fin' and id='${an}'`))[0].b);
  await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});await page.click('#ptabs [data-tab="hoje"]');await page.click('#ptabs [data-tab="fin"]');
  ok('Depois das boas-vindas: aguardando comprovante',(await page.textContent('#painel')).includes('Aguardando comprovante'));
  await page.click(`[data-finpay="${an}"]`);await page.fill('#fp2-d',hojeK(-2));await page.click('#fp2 button[type="submit"]');await page.waitForSelector('#ms-t');
  const rec=await page.inputValue('#ms-t');
  const pg0=await sql(`select data from public.docs where col='pagamentos' and data->>'alunoId'='${an}'`);
  ok('1º pagamento registrado (ciclo 0, R$ 160) com recibo e prazo de 7 dias',pg0.length===1&&pg0[0].data.ciclo===0&&Number(pg0[0].data.valor)===160&&rec.includes('fica pronta até'),JSON.stringify(pg0)+' '+rec);
  await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});await page.click('#ptabs [data-tab="hoje"]');await page.click('#ptabs [data-tab="fin"]');
  ok('Pago e não liberado: aparece "Liberar planilha até" com o prazo',(await page.textContent('#painel')).includes('Liberar planilha até'));
  await page.click(`#painel [data-finlib="${an}"]`);await page.waitForSelector('#ms-t');const lib=await page.inputValue('#ms-t');
  ok('Liberar grava a data e gera a mensagem com a próxima renovação em 30 dias',(await sql(`select data->>'liberadoEm' l from public.docs where col='fin' and id='${an}'`))[0].l===hojeK()&&lib.includes('liberada')&&lib.includes(hojeK(30).slice(8,10)+'/'+hojeK(30).slice(5,7)),lib);
  await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});
  const setLib=async n=>{await db.query("update public.docs set data=data||$2 where col='fin' and id=$1",[an,JSON.stringify({liberadoEm:hojeK(n)})]);await page.click('#ptabs [data-tab="hoje"]');await poke2();await page.click('#ptabs [data-tab="fin"]')};
  await setLib(-28);
  ok('Ciclo conta da liberação: faltando 2 dias entra o lembrete D-3 na fila',(await page.textContent('#painel')).includes('Lembrete (3 dias antes)'));
  await setLib(-33);
  ok('3 dias de atraso: fila de cobrança com atraso e inadimplência no painel',(await page.textContent('#painel')).includes('Atraso: 3 dias')&&(await page.textContent('.fin-stats')).includes('1 em atraso'));
  await page.screenshot({path:'../fin-coach.png',fullPage:true});
  await page.click(`[data-finmsg="etapa"][data-id="${an}"]`);await page.screenshot({path:'../fin-msg.png'});const a3=await page.inputValue('#ms-t');ok('Mensagem de atraso gentil com Pix',a3.includes('passou batido')&&a3.includes('000201'),a3);
  await page.click('#ms-cp');await page.waitForTimeout(800);await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});await page.click('#ptabs [data-tab="hoje"]');await poke2();await page.click('#ptabs [data-tab="fin"]');
  ok('Depois de enviada, a cobrança sai da fila',!(await page.textContent('#painel')).includes('Atraso: 3 dias'));
  // aluna vê o próprio plano
  await logout();await login('aninha','1234');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});await page.waitForTimeout(600);
  ok('Atleta vê "Meu plano" discreto e o lembrete suave',(await page.textContent('#al-fin')).includes('Atleta')&&(await page.textContent('#al-nudge')).includes('em aberto'));
  await page.screenshot({path:'../fin-aluno.png',fullPage:true});
  await page.click('#fin-nudge-go');await page.waitForTimeout(300);await page.screenshot({path:'../fin-aluno-pix.png'});ok('Atleta abre os pagamentos e vê o Pix copia e cola',(await page.inputValue('#pix-cc')).startsWith('000201')&&(await page.textContent('.sheet')).includes('1º mês'));
  await page.evaluate(()=>{document.querySelector('#sheet-root').innerHTML=''});
  await logout();await login('brunao','1234');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});await page.waitForTimeout(500);
  ok('Outro atleta não vê o financeiro da colega',await page.evaluate(async()=>{const c=window.supabase.createClient('','');const a=(await c.from('docs').select('id,data').eq('col','fin')).data||[];const b=(await c.from('docs').select('id,data').eq('col','pagamentos')).data||[];return a.length===0&&b.length===0})&&(await page.textContent('#al-fin')).trim()==='');
  await logout();await login('coachgi','0123');await page.waitForSelector('#view-painel:not([hidden])');}
  await logout();await login('aninha','1234');await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});ok('Aluna de teste entra com aninha / 1234',true);
  await page.screenshot({path:'../sb-aluno.png'});
  await page.reload();await page.waitForSelector('#view-eu:not([hidden])',{timeout:8000});ok('Login continua depois de recarregar a página',true);
  // --- tela não se redesenha sozinha ---
  await page.click('[data-go="mural"]');await page.waitForSelector('#view-mural:not([hidden])');await page.waitForTimeout(400);
  const poke=()=>page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.evaluate(()=>{window.__n=document.querySelector('#turma').firstElementChild});
  await poke();await page.waitForTimeout(800);
  ok('Atualização automática sem novidade não redesenha a tela',await page.evaluate(()=>document.querySelector('#turma').firstElementChild===window.__n));
  globalThis.FAIL_SEL=true;await poke();await page.waitForTimeout(800);globalThis.FAIL_SEL=false;
  ok('Falha momentânea de conexão não desloga nem recarrega',await page.isVisible('#view-mural')&&await page.evaluate(()=>document.querySelector('#turma').firstElementChild===window.__n));
  await page.evaluate(()=>{const i=document.createElement('input');i.id='tst-in';document.querySelector('#feed').prepend(i)});
  await page.fill('#tst-in','meu texto');await page.evaluate(()=>document.activeElement.blur());
  await db.query("insert into public.docs(col,id,data) values('posts','p_novo',$1)",[JSON.stringify({texto:'Recado novo da coach',ts:new Date().toISOString(),fixado:false})]);
  await poke();await page.waitForTimeout(900);
  ok('Formulário com texto não salvo não é apagado por novidade no banco',await page.evaluate(()=>{const i=document.querySelector('#tst-in');return!!i&&i.value==='meu texto'}));
  await page.click('[data-go="coach"]');await page.click('[data-go="mural"]');await page.waitForTimeout(400);
  ok('Ao navegar, a novidade aparece',(await page.textContent('#feed')).includes('Recado novo da coach'));
}catch(e){R.push('CRASH '+e.message.split('\n')[0])}
ok('Sem erros de JavaScript',errs.length===0,errs.slice(0,3).join(' | '));
console.log(R.join('\n'));console.log(R.filter(x=>x.startsWith('PASS')).length+'/'+R.length+' passaram');
await browser.close();srv.close();process.exit(0);
