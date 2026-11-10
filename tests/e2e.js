const { chromium } = require("playwright");
const path = require("path");
const DIR = __dirname;
const MOCK = `
(()=>{const S=window.__store={};const subs=new Set();const notify=()=>setTimeout(()=>subs.forEach(f=>f()),5);
const clone=o=>JSON.parse(JSON.stringify(o));
function doc(p){const id=p.split("/").pop();const snap=()=>({id,exists:!!S[p],data:()=>S[p]&&clone(S[p]),metadata:{}});return{id,path:p,
 get:async()=>snap(),set:async o=>{S[p]=clone(o);notify()},update:async o=>{if(!S[p])throw{code:"invalid_argument"};Object.assign(S[p],clone(o));notify()},
 delete:async()=>{delete S[p];notify()},onSnapshot(n){const f=()=>n(snap());subs.add(f);setTimeout(f,5);return()=>subs.delete(f)}}}
function col(c){return{path:c,doc:id=>doc(c+"/"+(id||Math.random().toString(36).slice(2))),onSnapshot(n){const f=()=>{const docs=Object.keys(S).filter(k=>k.startsWith(c+"/")&&k.split("/").length===2).sort().map(k=>({id:k.split("/")[1],exists:true,data:()=>clone(S[k]),metadata:{}}));n({docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{}})};subs.add(f);setTimeout(f,5);return()=>subs.delete(f)}}}
window.claude={use:async n=>n==="db"?{doc,collection:col}:null};})();`;
const results = [];
const ok = (name, cond, extra) => { results.push((cond ? "PASS " : "FAIL ") + name + (extra ? " — " + extra : "")); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ viewport: { width: 400, height: 860 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|fonts/.test(m.text())) errs.push(m.text()); });
  await page.addInitScript(MOCK);
  const html = require("fs").readFileSync(path.join(DIR, "time-da-gi.html"), "utf8");
  require("fs").writeFileSync(path.join(DIR, "run.html"), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + "</body></html>");
  await page.goto("file://" + path.join(DIR, "run.html"));
  const store = () => page.evaluate(() => window.__store);
  const keys = async pre => Object.keys(await store()).filter(k => k.startsWith(pre));

  // 1. gate
  await page.waitForSelector("#view-gate:not([hidden])");
  ok("Tela inicial pede usuário e senha", await page.isVisible("#lg-user") && await page.isVisible("#lg-pass"));
  // wrong
  await page.fill("#lg-user", "coachgi"); await page.fill("#lg-pass", "9999"); await page.click("#lg-btn");
  ok("Senha errada é recusada", (await page.textContent("#lg-msg")).includes("incorretos"));
  await page.fill("#lg-user", "coach1"); await page.fill("#lg-pass", "0123"); await page.click("#lg-btn");
  ok("Usuário com número é recusado", (await page.textContent("#lg-msg")).includes("só letras"));
  // coach login
  await page.fill("#lg-user", "CoachGi"); await page.fill("#lg-pass", "0123"); await page.click("#lg-btn");
  await page.waitForSelector("#view-painel:not([hidden])");
  ok("coachgi / 0123 entra direto no Painel", true);

  // 2. cadastrar aluno
  await page.click('#ptabs [data-tab="alunos"]');
  ok("Cadastro não tem mais campo de emoji nem 'treinos por semana'", (await page.$$("#fa-emo")).length === 0 && (await page.$$("#fa-fr")).length === 0);
  await page.type("#fa-nome", "Pablo Teste");
  ok("Nome é replicado no apelido do mural", (await page.inputValue("#fa-ap")) === "Pablo Teste");
  await page.fill("#fa-ap", "Pablito"); await page.fill("#fa-lg", "pablo");
  await page.fill("#fa-pw", "4321"); await page.fill("#fa-wa", "(51) 99888-7766");
  await page.fill("#fa-om", "Voltar a correr");
  await page.click('#fa button[type="submit"]'); await page.waitForTimeout(100);
  ok("Sem dia marcado, o cadastro pede os dias de treino", (await page.textContent("#fa-msg")).includes("dia de treino"));
  await page.click('#fa-wd [data-wd="1"]'); await page.click('#fa-wd [data-wd="4"]');
  ok("Seletor mostra 2 treinos por semana", (await page.textContent("#fa-wdn")).includes("2 treinos"));
  await page.click('#fa button[type="submit"]'); await page.waitForTimeout(150);
  let st = await store();
  const alId = Object.keys(st).find(k => k.startsWith("perfis/")).split("/")[1];
  ok("Aluno salvo no banco", !!alId);
  ok("WhatsApp salvo separado em 'contatos' (só coach)", st["contatos/" + alId] && st["contatos/" + alId].whatsapp === "51998887766");
  ok("WhatsApp não fica no perfil público", !("whatsapp" in st["perfis/" + alId]));
  ok("Dias salvos (Seg e Qui) e emoji sorteado pelo sistema", JSON.stringify(st["perfis/" + alId].semana) === "[1,4]" && st["perfis/" + alId].emoji && st["perfis/" + alId].emoji !== "💪", st["perfis/" + alId].emoji);
  // duplicate login
  await page.fill("#fa-nome", "Outro"); await page.fill("#fa-ap", "Outro"); await page.fill("#fa-lg", "pablo"); await page.fill("#fa-pw", "1111");
  await page.click('#fa button[type="submit"]'); await page.waitForTimeout(100);
  ok("Usuário repetido é bloqueado", (await page.textContent("#fa-msg")).includes("já existe"));
  await page.fill("#fa-lg", "coachgi"); await page.click('#fa button[type="submit"]'); await page.waitForTimeout(100);
  ok("Ninguém pode usar o usuário coachgi", (await page.textContent("#fa-msg")).includes("já existe"));

  // 3. perfil do aluno com WhatsApp
  await page.click(`[data-perfil="${alId}"]`);
  const wa = await page.getAttribute(".sheet a.btn.wa", "href");
  ok("Perfil do aluno tem botão WhatsApp", wa === "https://wa.me/5551998887766", wa);
  ok("Ficha de anamnese fica recolhida dentro do perfil", !(await page.$eval(".sheet details.anam", d => d.open)));
  await page.click(".sheet details.anam summary");
  const anLink = await page.getAttribute("[data-anamsend]", "href");
  ok("Botão envia a ficha por WhatsApp com link e usuário", anLink.startsWith("https://wa.me/5551998887766?text=") && decodeURIComponent(anLink).includes("#anamnese") && decodeURIComponent(anLink).includes("*pablo*"));
  await page.evaluate(() => { const a = document.querySelector("[data-anamsend]"); a.addEventListener("click", e => e.preventDefault(), { once: true }); a.click(); });
  await page.waitForTimeout(120);
  ok("Envio marca a ficha como pedida", !!(await store())["perfis/" + alId].anamnesePedida);
  await page.click("#sx");

  // 4. Hoje → dar um toque
  await page.click('#ptabs [data-tab="hoje"]');
  const toque = await page.getAttribute('#painel a.btn.wa', "href");
  ok("'Precisam de um toque' traz o WhatsApp do aluno sem treino", toque && toque.startsWith("https://wa.me/5551998887766?text="), toque && toque.slice(0, 60));

  // 5. Planilha: 2 treinos por semana
  await page.click('[data-montar]');
  await page.waitForSelector("#ed-form");
  await page.evaluate(()=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7)-14);const v=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");const i=document.querySelector("#ed-i");i.value=v;i.dispatchEvent(new Event("change"));});
  const nA = await page.$$eval('[data-letter="A"] .ed-dia', x => x.length);
  ok("Editor já abre com 2 treinos na semana (Seg e Qui)", nA === 2, "A=" + nA);
  const dds = await page.$$eval('[data-letter="A"] .ed-dia .dd', x => x.map(e => e.textContent));
  ok("Cada treino mostra o dia e a data (A1 Seg, A2 Qui)", dds[0].includes("Seg") && dds[1].includes("Qui"), dds.join(" | "));
  { // início no primeiro dia de treino, não na segunda
    const seg = await page.inputValue("#ed-i");
    await page.evaluate(()=>{const i=document.querySelector("#ed-i");const d=new Date(i.value+"T12:00:00");d.setDate(d.getDate()+1);i.value=d.toISOString().slice(0,10);i.dispatchEvent(new Event("change"));});
    const ini2 = await page.inputValue("#ed-i");
    const qui = (()=>{const d=new Date(seg+"T12:00:00");d.setDate(d.getDate()+3);return d.toISOString().slice(0,10)})();
    ok("Data que não é dia de treino (terça) avança para o próximo dia de treino (quinta)", ini2 === qui, seg + " → " + ini2);
    const dd2 = await page.$$eval('[data-letter="A"] .ed-dia .dd', x => x.map(e => e.textContent));
    ok("Semana começa na quinta e fecha na quarta: A1 Qui, A2 Seg seguinte", dd2[0].includes("Qui") && dd2[1].includes("Seg"), dd2.join(" | "));
    ok("Editor mostra o intervalo de cada semana", (await page.textContent("#ed-i-h")).includes("Semana 1:"));
    ok("Agenda da quinzena começa na quinta", (await page.$eval("#ed-cal .cal-c small", e => e.textContent)) === "Qui");
    await page.evaluate(v=>{const i=document.querySelector("#ed-i");i.value=v;i.dispatchEvent(new Event("change"));}, seg);
  }
  ok("Agenda da quinzena mostra os 4 treinos nas datas", (await page.$$("#ed-cal .cal-c.tr")).length === 4);
  const diasA = await page.$$('[data-letter="A"] .ed-dia');
  await (await diasA[0].$('[data-dt="titulo"]')).fill("Superiores");
  await (await diasA[0].$('[data-f="nome"]')).fill("Supino"); await (await diasA[0].$('[data-f="carga"]')).fill("20 kg");
  await (await diasA[0].$("[data-addrow]")).click();
  const rows0 = await diasA[0].$$(".ed-row");
  await (await rows0[1].$('[data-f="tipo"]')).selectOption("tabata");
  const vis = async sel => Promise.all((await rows0[1].$$(sel)).map(x => x.isVisible()));
  ok("Tabata esconde séries, reps, carga geral e descanso", !(await vis('[data-f="series"],[data-f="reps"],[data-f="descanso"],[data-f="carga"]')).some(Boolean));
  ok("Tabata abre com 2 movimentos", (await vis('[data-mv="nome"]')).filter(Boolean).length === 2);
  await (await rows0[1].$('[data-f="nmov"]')).selectOption("4");
  ok("Select troca para 4 movimentos", (await vis('[data-mv="nome"]')).filter(Boolean).length === 4);
  await (await rows0[1].$('[data-f="nmov"]')).selectOption("2");
  const mvs = await rows0[1].$$('[data-mv="nome"]'), kgs = await rows0[1].$$('[data-mv="carga"]');
  await mvs[0].fill("Burpee");
  await (await diasA[1].$('[data-dt="titulo"]')).fill("Inferiores");
  await (await diasA[1].$('[data-f="nome"]')).fill("Agachamento"); await (await diasA[1].$('[data-f="carga"]')).fill("30 kg");
  await page.click('[data-edl="B"]'); await page.click('[data-edl="A"]');
  await page.click('#ed-form button[type="submit"]'); await page.waitForTimeout(150);
  ok("Publicar com movimento do Tabata vazio é bloqueado", (await page.$$("#ed-form")).length === 1 && !Object.keys(await store()).some(k => k.startsWith("planos/")));
  await mvs[1].fill("Agachamento"); await kgs[1].fill("10 kg");
  await page.click('[data-edl="B"]');
  await page.click("#copy-ab");
  const bTit = await page.$$eval('[data-letter="B"] [data-dt="titulo"]', x => x.map(i => i.value));
  ok("'Copiar Treino A para o B' replica os 2 treinos", bTit.join() === "Superiores,Inferiores", bTit.join());
  await page.click('#ed-form button[type="submit"]'); await page.waitForTimeout(200);
  st = await store();
  const planos = Object.keys(st).filter(k => k.startsWith("planos/"));
  ok("Quinzena publicada com A e B", planos.length === 2);
  ok("Cada treino da semana salvo separado (A1, A2)", st[planos[0]].dias.length === 2 && st[planos[0]].dias[0].exs.length === 2);
  const tx = st[planos[0]].dias[0].exs[1];
  ok("Tabata salvo como 1 exercício com 2 movimentos e kg opcional", tx.tipo === "tabata" && tx.movs.length === 2 && tx.movs[1].carga === "10 kg" && tx.nome === "Burpee / Agachamento" && st[planos[0]].dias[0].exs.length === 2, JSON.stringify(tx.movs));
  ok("Copiar A→B leva o Tabata junto", (st[planos[1]].dias[0].exs[1] || {}).tipo === "tabata");

  // 6. Próxima quinzena com ajuste pontual
  await page.click("#ed-next");
  const firstCarga = await page.$('[data-letter="A"] .ed-dia [data-f="carga"]');
  ok("Próxima quinzena vem copiada", (await firstCarga.inputValue()) === "20 kg");
  await firstCarga.fill("22,5 kg");
  await page.click('#ed-form button[type="submit"]'); await page.waitForTimeout(200);
  st = await store();
  ok("Quinzena 2 criada", Object.keys(st).filter(k => k.startsWith("planos/")).length === 4);

  await page.click("#ed-next"); await page.click('#ed-form button[type="submit"]'); await page.waitForTimeout(200);
  ok("Quinzena 3 fica agendada (futura) para a coach", (await page.textContent("#painel")).includes("agendada"));
  // 6b. Modelo "Só Treino A": semana 2 repete o A
  await page.click("#ed-cur"); await page.waitForSelector("#ed-form");
  ok("Editor oferece o modelo da quinzena (A e B / Só A)", !!(await page.$('#ed-modo [data-modo="A"]')) && (await page.getAttribute("#ed-modo", "data-modo")) === "AB");
  await page.click('#ed-modo [data-modo="A"]');
  ok("Só Treino A esconde as abas e o Treino B", await page.isHidden("#ed-tabs") && await page.isHidden('[data-letter="B"]'));
  ok("Prévia da agenda mostra o A também na semana 2", (await page.textContent("#ed-cal")).includes("Semana 2 · Treino A"));
  await page.click('#ed-form button[type="submit"]'); await page.waitForTimeout(250);
  { const st3 = await store(); const ks = Object.keys(st3).filter(k => k.startsWith("planos/") && st3[k].ciclo === 3);
    const A3 = ks.map(k => st3[k]).find(x => x.letra === "A"), B3 = ks.map(k => st3[k]).find(x => x.letra === "B");
    ok("Só A grava a semana 2 como espelho do A, com datas +7 dias", A3 && B3 && B3.espelho === true && A3.modo === "A" && B3.dias.length === A3.dias.length && B3.dias[0].exs.length === A3.dias[0].exs.length && B3.dias[0].data === (()=>{const d=new Date(A3.dias[0].data+"T12:00:00");d.setDate(d.getDate()+7);return d.toISOString().slice(0,10)})(), JSON.stringify([A3&&A3.dias[0].data,B3&&B3.dias[0].data]));
    ok("Painel mostra o modelo e a semana 2 com A1", (await page.textContent("#painel")).includes("Só Treino A") && (await page.textContent("#painel")).includes("Semana 2 · Treino A") && !(await page.textContent("#painel .cal")).includes("B1")); }
  await page.click("#ed-cur"); ok("Ao reabrir, o editor lembra o modelo Só A", (await page.getAttribute("#ed-modo", "data-modo")) === "A");
  await page.click('#ed-modo [data-modo="AB"]'); ok("Voltar para A e B mostra o Treino B de novo", !(await page.isHidden("#ed-tabs")));
  await page.click("#ed-cancel");
  // 7. logout, login aluno
  await page.click("#nav-sair");
  await page.fill("#lg-user", "pablo"); await page.fill("#lg-pass", "4321"); await page.click("#lg-btn");
  await page.waitForSelector("#view-eu:not([hidden])");
  ok("Aluno entra com usuário e senha e cai na planilha", true);
  ok("Aluno não vê o Painel", await page.isHidden("#nav-painel"));
  const chips = await page.$$eval(".dia-chip b", x => x.map(b => b.textContent));
  ok("Aluno vê os 4 treinos da quinzena (A1, A2, B1, B2)", chips.length === 4 && chips[0].startsWith("A1") && chips[3].startsWith("B2"), chips.join(" | "));
  const chipDates = await page.$$eval(".dia-chip span", x => x.map(b => b.textContent));
  ok("Cada treino do aluno tem dia e data", chipDates[0].includes("Seg") && chipDates[1].includes("Qui"), chipDates.join(" | "));
  ok("Agenda visual com os treinos nas datas", (await page.$$("#al-plan .cal-c.tr")).length === 4);
  ok("Aviso da ficha de anamnese aparece para o aluno", await page.isVisible("#anam-go"));
  await page.click('#al-plan [data-sel^="A"]');
  ok("Aluno continua na quinzena atual (2), não na agendada (3)", (await page.textContent("#al-eyebrow")).includes("Quinzena 2"), await page.textContent("#al-eyebrow"));
  const tag = await page.textContent(".chg").catch(() => "");
  ok("Ajuste de carga aparece etiquetado pro aluno", tag.includes("20 kg → 22,5 kg"), tag);
  ok("Plano mostra o Tabata como 1 exercício com os movimentos e o kg", (await page.textContent(".exs")).includes("Tabata · 2 movimentos") && (await page.textContent(".tmovs")).includes("Agachamento10 kg".replace("10", " 10")) );
  await page.evaluate(() => { window.__tgSpeed = 60; });
  await page.click("#start-wk"); await page.waitForSelector("#wk-root .wk");
  ok("'Iniciar treino' abre o modo treino em tela cheia", (await page.textContent(".wk-name")).includes("Supino"));
  await page.click("#wk-fb"); await page.fill("#wf-c", "22,5 kg"); await page.fill("#wf-n", "Ombro ok"); await page.click("#wf-ok");
  await page.click("#wk-set");
  ok("'Série feita' começa o descanso", await page.isVisible(".wk.rest"));
  await page.waitForSelector(".wk.go", { timeout: 4000 });
  ok("Fim do descanso sinaliza na tela ('Bora!')", (await page.textContent(".wk-name")).includes("Bora"));
  await page.waitForSelector("#wk-set", { timeout: 4000 });
  await page.click("#wk-set"); await page.click("#wk-plus"); await page.click("#wk-skip");
  await page.click("#wk-set"); await page.click("#wk-skip");
  await page.waitForSelector("#wk-tab");
  ok("Depois das 3 séries vai para o Tabata", (await page.textContent(".wk-name")).includes("Tabata") && (await page.textContent(".wk-tmovs")).includes("Burpee"));
  await page.click("#wk-tab");
  ok("Tabata começa com contagem de preparo", await page.isVisible(".wk.tb.prep"));
  await page.waitForSelector(".wk.tb.work", { timeout: 4000 });
  ok("Tabata alterna para trabalho (rosa) com o movimento", (await page.textContent(".wk-name")).includes("Burpee"));
  await page.click("#wk-pause"); const ps = await page.textContent(".wk-lbl"); await page.click("#wk-pause");
  ok("Tabata pausa e continua", ps.includes("pausado"));
  await page.waitForSelector(".wk.tb.rest", { timeout: 4000 });
  ok("Tabata entra no descanso de 10s (azul)", true);
  await page.waitForSelector(".wk.tb.work .wk-name >> text=Agachamento", { timeout: 4000 });
  ok("Rodada 2 alterna o movimento e mostra o kg dele", (await page.textContent(".wk-kg")) === "10 kg");
  await page.waitForSelector(".wk.tb.done", { timeout: 12000 });
  ok("Tabata termina depois das 8 rodadas", true);
  await page.click("#wk-tnext"); await page.waitForSelector(".wk.end");
  ok("Treino completo leva à tela final", true);
  await page.click("#wk-fin");
  ok("Duração vem preenchida pelo cronômetro", Number(await page.inputValue("#f-dur")) >= 1);
  ok("Opção 'mostrar no mural' não existe mais", (await page.$$("#f-pub")).length === 0 && (await page.$$("#f-conq")).length === 0);
  await page.click('#humor [data-h="5"]'); await page.fill("#f-msg", "Bora, time! Hoje foi"); await page.fill("#f-com", "Achei leve");
  await page.setInputFiles("#f-file", path.join(DIR, "img/gi.jpg"));
  await page.waitForSelector("#cr-ok");
  const box = await page.$("#cr-box"); const bb = await box.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 30, bb.y + bb.height / 2 + 20); await page.mouse.up();
  await page.fill("#cr-z", "1.6"); await page.dispatchEvent("#cr-z", "input");
  await page.click("#cr-ok");
  ok("Foto do treino passa pelo recorte", (await page.$$("#f-pv img")).length === 1);
  await page.click("#f-save"); await page.waitForTimeout(250);
  st = await store();
  const ck = Object.entries(st).find(([k]) => k.startsWith("checkins/"));
  ok("Treino salva humor, feedback, recado privado, recado do mural e foto", ck && ck[1].humor === 5 && ck[1].exs.e1.nota === "Ombro ok" && ck[1].exs.e1.feito && ck[1].exs.e2.feito && ck[1].diaId === "d1" && ck[1].comentario === "Achei leve" && ck[1].mensagem === "Bora, time! Hoje foi" && /^data:image\/jpeg/.test(ck[1].foto), ck ? "foto " + Math.round((ck[1].foto || "").length / 1024) + " KB" : "");
  const chips2 = await page.$$eval(".dia-chip span", x => x.map(b => b.textContent));
  ok("A1 marcado como feito e o app pula para o próximo treino", chips2[0].includes("feito") && !(await page.textContent(".dia-chip.on b")).startsWith("A1"), chips2.join(" | "));
  await page.click('#al-plan .dia-chip >> nth=0');
  ok("Treino finalizado fica travado: sem iniciar, sem marcar, sem feedback", await page.isVisible(".done-banner") && (await page.$$("#start-wk")).length === 0 && (await page.$$("#al-plan [data-chk]")).length === 0 && (await page.$$("#al-plan [data-fb]")).length === 0);
  ok("Barra de finalizar some no treino já feito", await page.isHidden("#finish-bar"));
  ok("Feedback dado aparece como leitura", (await page.textContent("#al-plan .myfb")).includes("Ombro ok"));
  await page.click("#anam-go");
  ok("Ficha abre na etapa 1 com o nome preenchido", (await page.inputValue("#an-nome")) === "Pablo Teste");
  await page.click("#an-next");
  ok("Etapa 1 pede os campos obrigatórios", (await page.textContent("#an-msg")).includes("Preencha"));
  await page.fill("#an-nasc", "1995-03-20"); await page.fill("#an-tel", "51 99888-7766"); await page.click('[data-ansn="treina"][data-v="Sim"]'); await page.fill("#an-treinaQue", "Cross"); await page.fill("#an-objetivo", "Ganhar força e voltar a correr"); await page.fill("#an-dores", "Joelho direito às vezes");
  await page.click("#an-next");
  ok("Etapa 2 é a rotina", (await page.textContent(".sheet h3")).includes("Rotina"));
  await page.check('[data-anr="trabalho"] >> nth=0'); await page.fill("#an-local", "Lifit Training"); await page.fill("#an-equip", "Halteres e elástico");
  await page.click("#an-next");
  ok("Sem autorização a ficha não é enviada", (await page.textContent("#an-msg")).includes("autorização"));
  await page.check("#an-ok"); await page.click("#an-next"); await page.waitForTimeout(150);
  st = await store();
  ok("Ficha salva em área privada (anamnese) com as 2 etapas", st["anamnese/" + alId] && st["anamnese/" + alId].d.objetivo === "Ganhar força e voltar a correr" && st["anamnese/" + alId].d.trabalho === "Sentado durante a maior parte do dia" && st["anamnese/" + alId].d.treina === "Sim");
  ok("Aviso da ficha some depois de enviar", (await page.$$("#anam-go")).length === 0);

  // 8. reação liga/desliga
  await page.click('[data-go="mural"]');
  ok("Mural mostra o recado do aluno e a foto, sem 'Conquista'", (await page.textContent("#feed .msg")).includes("Bora, time") && (await page.$$("#feed .post-photo img")).length === 1 && !(await page.textContent("#feed")).includes("Conquista"));
  await page.screenshot({ path: path.join(DIR, "shot-feed.png") });
  const rsel = '#feed [data-tipo="fogo"]';
  await page.click(rsel); await page.waitForTimeout(120);
  const on1 = await page.$eval(rsel, b => [b.classList.contains("on"), b.textContent.trim()]);
  await page.click(rsel); await page.waitForTimeout(120);
  const on2 = await page.$eval(rsel, b => [b.classList.contains("on"), b.textContent.trim()]);
  ok("Reação liga no 1º toque", on1[0] && on1[1].endsWith("1"), on1.join(" "));
  ok("Reação desliga no 2º toque", !on2[0] && on2[1].endsWith("0"), on2.join(" "));
  ok("Nenhuma reação sobra no banco", (await keys("curtidas/")).length === 0);

  // 9. trocar senha
  await page.click('[data-go="eu"]');
  await page.click("#al-senha");
  await page.fill("#pw-a", "4321"); await page.fill("#pw-n", "135790"); await page.fill("#pw-c", "135790");
  await page.click('#pw-form button'); await page.waitForTimeout(150);
  ok("Aluno troca a senha e continua logado", await page.isVisible("#view-eu"));
  await page.click("#nav-sair");
  await page.fill("#lg-user", "pablo"); await page.fill("#lg-pass", "4321"); await page.click("#lg-btn");
  ok("Senha antiga deixa de funcionar", (await page.textContent("#lg-msg")).includes("incorretos"));
  await page.fill("#lg-pass", "135790"); await page.click("#lg-btn");
  await page.waitForSelector("#view-eu:not([hidden])");
  ok("Senha nova de 6 dígitos funciona", true);
  await page.click("#photo-btn"); await page.setInputFiles("#ph-file", path.join(DIR, "img/gi-face.jpg"));
  await page.waitForSelector("#cr-ok"); ok("Foto de perfil do aluno abre o recorte redondo", await page.isVisible(".crop-box.round")); await page.click("#cr-ok"); await page.click("#ph-save"); await page.waitForTimeout(150);
  ok("Foto de perfil do aluno salva recortada", /^data:image\/jpeg/.test((await store())["perfis/" + alId].foto || ""));
  ok("Troca de foto não tem mais campo de emoji", true);
  await page.click("#photo-btn"); ok("Sem campo de emoji na foto de perfil", (await page.$$("#ph-emo")).length === 0); await page.click("#ph-rm"); await page.click("#ph-save"); await page.waitForTimeout(120);
  ok("Removendo a foto, o emoji volta", ((await store())["perfis/" + alId].foto || "") === "" && (await page.textContent("#photo-btn .avi")).trim().length > 0);
  await page.screenshot({ path: path.join(DIR, "shot-aluno.png"), fullPage: false });
  await page.click("#nav-sair");

  // 10. coach: responde, arquiva, remove
  await page.fill("#lg-user", "coachgi"); await page.fill("#lg-pass", "0123"); await page.click("#lg-btn");
  await page.waitForSelector("#view-painel:not([hidden])");
  await page.click('#ptabs [data-tab="perfil"]');
  await page.fill("#fp-fd", "Hoje é dia de somar"); await page.click('#fd button'); await page.waitForTimeout(150);
  await page.setInputFiles("#fp-av", path.join(DIR, "img/gi.jpg")); await page.waitForSelector("#cr-ok"); await page.click("#cr-ok"); await page.waitForTimeout(150);
  await page.setInputFiles("#fp-main", path.join(DIR, "img/gi.jpg")); await page.waitForSelector("#cr-ok"); ok("Foto principal da coach recorta em 4:5", (await page.getAttribute("#cr-box", "style")).includes("0.8")); await page.click("#cr-ok"); await page.waitForTimeout(150);
  st = await store();
  ok("Coach troca foto de perfil e foto principal", /^data:image\/jpeg/.test(st["config/v3"].coach.avatar || "") && /^data:image\/jpeg/.test(st["config/v3"].coach.foto || ""), "config " + Math.round(JSON.stringify(st["config/v3"]).length / 1024) + " KB");
  await page.click('[data-go="mural"]');
  ok("Frase do dia aparece e fica fixa", (await page.textContent("#coach-strip")).includes("Hoje é dia de somar") && (await page.textContent("#coach-strip")).includes("Frase do dia"));
  ok("Avatar da coach novo aparece no mural", (await page.getAttribute("#coach-strip img", "src")).startsWith("data:image"));
  await page.click('[data-go="coach"]');
  ok("Conheça sua coach: 'Oi, eu sou a Coach Gi!' e novo texto", (await page.textContent("#coach-info h1")).includes("Coach Gi!") && (await page.textContent("#coach-info .bio")).includes("força, confiança e autonomia"));
  ok("Bacharelado em destaque", (await page.textContent("#coach-trilha .grad")).includes("Bacharel em Educação Física") && (await page.textContent("#coach-trilha .grad")).includes("Leonardo Da Vinci"));
  const anos = await page.$$eval("#coach-trilha .trilha >> nth=0", x => x.map(e => e.textContent));
  const cursosAnos = await page.$$eval("#coach-trilha .trilha", x => [...x[0].querySelectorAll(".tl > span")].map(e => e.textContent));
  ok("Cursos do mais recente para o mais antigo", cursosAnos.join(",") === "2025,2023,2022,2021", cursosAnos.join(","));
  ok("Botão 'Vamos conversar' leva ao WhatsApp da Gi", (await page.getAttribute("#coach-info a.btn", "href")).startsWith("https://wa.me/5551997770125"));
  await page.fill("#post-txt", "Recado de teste"); await page.click("#post-form button"); await page.waitForTimeout(150);
  await page.click('#coach-posts [data-pin]'); await page.waitForTimeout(150);
  const fx1 = Object.values(await store()).find(v => v.texto === "Recado de teste").fixado;
  await page.click('#coach-posts [data-pin]'); await page.waitForTimeout(150);
  const fx2 = Object.values(await store()).find(v => v.texto === "Recado de teste").fixado;
  ok("Coach fixa e desafixa recado", fx1 === true && fx2 === false);
  await page.click('[data-go="painel"]'); await page.click('#ptabs [data-tab="hoje"]');
  await page.fill("[data-reply] input", "Boa! Semana que vem sobe."); await page.click("[data-reply] button"); await page.waitForTimeout(120);
  ok("Coach responde o feedback em privado", Object.entries(await store()).some(([k, v]) => k.startsWith("comentarios/") && v.privado && v.autor === "coach"));
  await page.click("#painel .reply [data-delcm]"); await page.click("#painel .reply [data-delcm]"); await page.waitForTimeout(150);
  ok("Coach apaga a própria resposta", !Object.entries(await store()).some(([k, v]) => k.startsWith("comentarios/") && v.privado && v.autor === "coach"));
  await page.click("[data-fbdel]"); await page.click("[data-fbdel]"); await page.waitForTimeout(150);
  const ckAfter = Object.entries(await store()).find(([k]) => k.startsWith("checkins/"))[1];
  ok("Coach apaga o feedback escrito pelo aluno", ckAfter.comentario === "" && ckAfter.exs.e1.nota === "" && ckAfter.exs.e1.feito === true);
  await page.click('[data-go="mural"]');
  await page.click(`[data-aluno="${alId}"]`); await page.click(".sheet details.anam summary");
  ok("Coach lê a ficha de anamnese dentro do perfil", (await page.textContent(".sheet .anam")).includes("Ganhar força e voltar a correr") && (await page.textContent(".sheet .anam")).includes("Halteres e elástico"));
  await page.click("#sx"); await page.click('[data-go="painel"]');
  await page.click('#ptabs [data-tab="alunos"]');
  await page.click(`[data-arch="${alId}"]`); await page.waitForTimeout(120);
  ok("Arquivar marca o aluno", (await store())["perfis/" + alId].arquivado === true);
  await page.click('[data-go="mural"]');
  ok("Arquivado some do mural e do feed", (await page.$$(`[data-aluno="${alId}"]`)).length === 0 && !(await page.textContent("#feed")).includes("Pablito"));
  await page.click("#nav-sair");
  await page.fill("#lg-user", "pablo"); await page.fill("#lg-pass", "135790"); await page.click("#lg-btn");
  ok("Arquivado não consegue entrar", (await page.textContent("#lg-msg")).includes("pausado"));
  await page.fill("#lg-user", "coachgi"); await page.fill("#lg-pass", "0123"); await page.click("#lg-btn");
  await page.waitForSelector("#view-painel:not([hidden])");
  await page.click('#ptabs [data-tab="alunos"]');
  await page.click('[data-arq="1"]');
  ok("Remover fica escondido até abrir o ···", (await page.$$("[data-rm]")).length === 0);
  await page.click(`[data-more="${alId}"]`);
  await page.click(`[data-rm="${alId}"]`);
  ok("1º toque só pede confirmação", (await page.textContent(`[data-rm="${alId}"]`)).includes("Confirmar") && !!(await store())["perfis/" + alId]);
  await page.click(`[data-rm="${alId}"]`); await page.waitForTimeout(300);
  st = await store();
  const sobras = Object.keys(st).filter(k => !k.startsWith("config/") && !k.startsWith("posts/"));
  ok("Remoção apaga perfil, contato, planilhas, treinos e comentários", sobras.length === 0, sobras.join(","));

  // 11. alunos de teste + senha da coach
  await page.click('#ptabs [data-tab="ajustes"]');
  await page.click("#ex-add"); await page.waitForTimeout(600);
  ok("Cria 3 alunos de teste", (await keys("perfis/")).length === 3);
  await page.click('[data-go="mural"]'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(DIR, "shot-mural.png"), fullPage: false });
  ok("Mural mostra os 3", (await page.$$("#turma .av")).length === 3);

  await ctx.close();
  // desktop pass: coach editor screenshot
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage(); p2.on("pageerror", e => errs.push(e.message));
  await p2.addInitScript(MOCK); await p2.goto("file://" + path.join(DIR, "run.html"));
  await p2.fill("#lg-user", "coachgi"); await p2.fill("#lg-pass", "0123"); await p2.click("#lg-btn");
  await p2.click('#ptabs [data-tab="ajustes"]'); await p2.click("#ex-add"); await p2.waitForTimeout(600);
  await p2.click('#ptabs [data-tab="hoje"]'); await p2.waitForTimeout(100);
  await p2.screenshot({ path: path.join(DIR, "shot-painel.png"), fullPage: false });
  const ov = await p2.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  ok("Sem rolagem lateral no desktop", !ov);
  await browser.close();
  ok("Sem erros de JavaScript", errs.length === 0, errs.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  console.log("\n" + results.filter(r => r.startsWith("PASS")).length + "/" + results.length + " passaram");
})().catch(e => { console.log(results.join("\n")); console.error("CRASH", e.message); process.exit(1); });
