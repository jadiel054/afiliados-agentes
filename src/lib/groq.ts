/**
 * Cliente de chamadas ao Groq (LLM).
 * Timeout de 30s e try/catch que registra falha em log_ia.
 */

import type { RespostaPontuacaoGroq, DadosProduto, ConfigAgente } from "../../types/index.js";
import { gravarLogIa } from "./supabase.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELO = "openai/gpt-oss-120b";
const TIMEOUT_MS = 30_000;

interface GroqChoice {
  message: {
    content: string | null;
  };
}

interface GroqResponse {
  choices: GroqChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/**
 * Monta o prompt de pontuação em português.
 * Pesos: margem 30%, giro 25%, avaliação 15%, tendência 15%,
 * competitividade 10%, sazonalidade 5%.
 * Filtros eliminatórios: comissão < mínima, valor > máximo, avaliação < 3.0.
 */
function montarPromptPontuacao(
  dados: DadosProduto,
  config: ConfigAgente
): string {
  return `Você é um analista especialista em produtos de afiliados no nicho "${config.nicho}".

Analise o produto abaixo e retorne APENAS um JSON válido (sem markdown, sem explicação fora do JSON) com a seguinte estrutura:

{
  "pontuacao": number (0 a 100),
  "subpontuacoes": {
    "margem_comissao": number (0-100),
    "giro_velocidade": number (0-100),
    "avaliacao": number (0-100),
    "tendencia": number (0-100),
    "competitividade": number (0-100),
    "sazonalidade": number (0-100)
  },
  "razao": ["motivo 1", "motivo 2", ...],
  "relatorio": "texto em português do Brasil explicando a decisão de forma clara e objetiva",
  "confianca": "baixa" | "media" | "alta",
  "eliminado": boolean,
  "motivo_eliminacao": string | null
}

REGRAS DE PONTUAÇÃO (pesos):
- margem_comissao: 30%
- giro_velocidade: 25%
- avaliacao: 15%
- tendencia: 15%
- competitividade: 10%
- sazonalidade: 5%

FILTROS ELIMINATÓRIOS (se qualquer um for verdadeiro, eliminado=true e pontuacao=0):
- comissão percentual < ${config.comissao_minima}%
- preço > ${config.valor_maximo}
- avaliação < 3.0

DADOS DO PRODUTO:
${JSON.stringify(dados, null, 2)}

CONFIGURAÇÃO DO USUÁRIO:
- Nicho: ${config.nicho}
- Comissão mínima: ${config.comissao_minima}%
- Valor máximo: ${config.valor_maximo}
- Categorias preferidas: ${config.categorias?.join(", ") ?? "qualquer"}

IMPORTANTE:
- NÃO invente dados que não estão presentes. Se campos estão faltando, reduza a confiança e marque subpontuações baixas quando não houver base.
- O relatório deve ser em português do Brasil, direto e útil para o afiliado decidir.
- A pontuação final deve ser a média ponderada das subpontuações (respeitando os pesos), a menos que seja eliminado.`;
}

/**
 * Chama o Groq para pontuar um produto.
 * Em caso de falha, grava em log_ia e re-lança o erro.
 */
export async function pontuarComGroq(
  dados: DadosProduto,
  config: ConfigAgente,
  usuarioId: string
): Promise<RespostaPontuacaoGroq> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY não definida (GitHub Secret).");
  }

  const prompt = montarPromptPontuacao(dados, config);
  const inicio = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resposta = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELO,
        messages: [
          {
            role: "system",
            content:
              "Você responde somente com JSON válido. Nunca use markdown nem texto fora do objeto JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencia = Date.now() - inicio;

    if (!resposta.ok) {
      const textoErro = await resposta.text();
      await gravarLogIa({
        usuario_id: usuarioId,
        provedor: "groq",
        modelo: MODELO,
        tokens_entrada: null,
        tokens_saida: null,
        latencia_ms: latencia,
        sucesso: false,
        erro: `HTTP ${resposta.status}: ${textoErro.slice(0, 500)}`,
      });
      throw new Error(`Groq retornou ${resposta.status}: ${textoErro.slice(0, 200)}`);
    }

    const json = (await resposta.json()) as GroqResponse;
    const conteudo = json.choices?.[0]?.message?.content;

    if (!conteudo) {
      await gravarLogIa({
        usuario_id: usuarioId,
        provedor: "groq",
        modelo: MODELO,
        tokens_entrada: json.usage?.prompt_tokens ?? null,
        tokens_saida: json.usage?.completion_tokens ?? null,
        latencia_ms: latencia,
        sucesso: false,
        erro: "Resposta vazia do modelo",
      });
      throw new Error("Resposta vazia do Groq");
    }

    let parsed: RespostaPontuacaoGroq;
    try {
      parsed = JSON.parse(conteudo) as RespostaPontuacaoGroq;
    } catch {
      await gravarLogIa({
        usuario_id: usuarioId,
        provedor: "groq",
        modelo: MODELO,
        tokens_entrada: json.usage?.prompt_tokens ?? null,
        tokens_saida: json.usage?.completion_tokens ?? null,
        latencia_ms: latencia,
        sucesso: false,
        erro: `JSON inválido: ${conteudo.slice(0, 300)}`,
      });
      throw new Error("Groq retornou JSON inválido");
    }

    // Grava sucesso
    await gravarLogIa({
      usuario_id: usuarioId,
      provedor: "groq",
      modelo: MODELO,
      tokens_entrada: json.usage?.prompt_tokens ?? null,
      tokens_saida: json.usage?.completion_tokens ?? null,
      latencia_ms: latencia,
      sucesso: true,
      erro: null,
    });

    return parsed;
  } catch (err) {
    clearTimeout(timeoutId);
    const latencia = Date.now() - inicio;
    const mensagem = err instanceof Error ? err.message : String(err);

    // Evita gravar duas vezes se já gravamos acima
    if (!mensagem.startsWith("Groq retornou") && !mensagem.includes("JSON inválido") && !mensagem.includes("Resposta vazia")) {
      await gravarLogIa({
        usuario_id: usuarioId,
        provedor: "groq",
        modelo: MODELO,
        tokens_entrada: null,
        tokens_saida: null,
        latencia_ms: latencia,
        sucesso: false,
        erro: mensagem.slice(0, 500),
      });
    }

    throw err;
  }
}
