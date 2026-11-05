// Time da Gi · boas-vindas pós-anamnese escritas por IA.
// Só a coach (admin) pode chamar. Lê perfil + anamnese + plano pelo próprio login dela (RLS),
// pede à IA o texto pessoal e devolve. Pix, valor e pedido de comprovante são anexados pelo app.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CAMPOS: Record<string, string> = {
  objetivo: "Objetivo com o plano", treina: "Já treina?", treinaQue: "O que treina", treinaVezes: "Vezes por semana",
  dores: "Dores, lesões ou restrições", saude: "Problemas de saúde diagnosticados", mais: "Algo que a coach precisa saber",
  trabalho: "Rotina de trabalho", rotina: "Rotina diária", rotinaInfo: "Informação importante da rotina",
  local: "Onde pretende treinar", equip: "Equipamentos disponíveis",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "sem_chave" }, 503);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: adm } = await sb.rpc("is_admin");
    if (adm !== true) return json({ error: "somente_coach" }, 403);
    const { alunoId } = await req.json();
    if (!alunoId) return json({ error: "sem_aluno" }, 400);
    const { data: rows, error } = await sb.from("docs").select("col,id,data").in("col", ["perfis", "anamnese", "fin"]).eq("id", alunoId);
    if (error) return json({ error: "leitura" }, 500);
    const by = (c: string) => rows?.find((r) => r.col === c)?.data ?? null;
    const perfil = by("perfis"), anam = by("anamnese"), fin = by("fin");
    if (!perfil) return json({ error: "sem_perfil" }, 404);
    const primeiro = String(perfil.nome || perfil.apelido || "").trim().split(/\s+/)[0];
    const d = (anam && anam.d) || {};
    const ficha = Object.entries(CAMPOS).map(([k, l]) => d[k] ? `- ${l}: ${String(d[k]).slice(0, 600)}` : "").filter(Boolean).join("\n");
    const isento = fin && (fin.plano === "isento" || (fin.plano === "personalizado" && !Number(fin.valor)));

    const system = `Tu és a Coach Gi (Giovana), profissional de Educação Física, escrevendo no WhatsApp para um(a) novo(a) atleta que acabou de preencher a ficha de anamnese.
Escreve em português do Brasil com o jeito gaúcho da Gi: trata por "tu", calorosa, próxima, profissional, sem exageros.
Regras:
- Começa com "Oi, ${primeiro}!" e agradece pela ficha.
- Mostra que leste a ficha com atenção: comenta o objetivo com as palavras certas e conecta com 1 ou 2 detalhes concretos (rotina, o que já treina, onde vai treinar, equipamentos, restrições). Escolhe os detalhes mais relevantes, não lista tudo.
- Se houver dor, lesão ou problema de saúde, diz com cuidado que vais considerar isso na montagem; não dás diagnóstico, não prometes cura e não citas medicamentos.
- Diz que vais montar a planilha do zero, pensada para a pessoa, e que ela fica liberada no app em até 7 dias${isento ? "." : " depois da confirmação do pagamento do primeiro mês."}
- NÃO escrevas valores, Pix, chave, nome do plano nem peças comprovante: isso é anexado depois automaticamente.
- No máximo 2 emojis. Para negrito do WhatsApp usa *asteriscos*; sem markdown, sem listas, sem assinatura.
- Entre 450 e 900 caracteres, em 2 ou 3 parágrafos curtos.
- Responde só com o texto da mensagem.`;
    const user = `Primeiro nome: ${primeiro}\nObjetivo cadastrado pela coach: ${perfil.objetivo || perfil.objetivoMural || "(não informado)"}\nFicha de anamnese:\n${ficha || "(ficha vazia)"}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5", max_tokens: 700, system, messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) return json({ error: "ia", status: r.status, detail: (await r.text()).slice(0, 300) }, 502);
    const out = await r.json();
    const texto = (out.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("").trim();
    if (!texto) return json({ error: "vazio" }, 502);
    return json({ texto });
  } catch (e) {
    return json({ error: "falha", detail: String(e).slice(0, 200) }, 500);
  }
});
