/**
 * Agente Caçador v1 — semi-manual.
 * Recebe links via workflow_dispatch, extrai o que for possível da URL,
 * pontua com Groq e grava propostas + logs no Supabase.
 *
 * NÃO usa APIs de marketplace (Shopee/ML) nesta fase.
 */

import {
  buscarConfigAgente,
  gravarProposta,
  gravarLogAgente,
} from "../lib/supabase.js";
import { pontuarComGroq } from "../lib/groq.js";
import type {
  DadosProduto,
  ConfigAgente,
  PropostaAgente,
  RespostaPontuacaoGroq,
} from "../../types/index.js";

/**
 * Detecta o marketplace a partir do hostname da URL.
 */
function detectarMarketplace(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("shopee")) return "shopee";
    if (host.includes("mercadolivre") || host.includes("mercadolibre")) return "mercadolivre";
    if (host.includes("amazon")) return "amazon";
    if (host.includes("magazineluiza") || host.includes("magalu")) return "magalu";
    if (host.includes("americanas")) return "americanas";
    if (host.includes("casasbahia")) return "casasbahia";
    if (host.includes("aliexpress")) return "aliexpress";
    return null;
  } catch {
    return null;
  }
}

/**
 * Tenta extrair um ID de produto da URL (padrões comuns).
 * Retorna null se não for possível identificar com segurança.
 */
function extrairProdutoId(url: string, marketplace: string | null): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname;

    // Shopee: /produto-i.123.456 ou /product/123/456
    if (marketplace === "shopee") {
      const m = path.match(/\.(\d+)\.(\d+)/) || path.match(/\/product\/(\d+)\/(\d+)/);
      if (m) return `${m[1]}.${m[2]}`;
    }

    // Mercado Livre: /p/MLB123456 ou /MLB-123456
    if (marketplace === "mercadolivre") {
      const m = path.match(/(MLB-?\d+)/i) || path.match(/\/p\/(MLB\d+)/i);
      if (m) return m[1].replace("-", "");
    }

    // Amazon: /dp/B0XXXX
    if (marketplace === "amazon") {
      const m = path.match(/\/dp\/([A-Z0-9]{10})/i);
      if (m) return m[1];
    }

    // Fallback genérico: último segmento numérico longo
    const segmentos = path.split("/").filter(Boolean);
    const ultimo = segmentos[segmentos.length - 1] ?? "";
    if (/^\d{6,}$/.test(ultimo)) return ultimo;

    return null;
  } catch {
    return null;
  }
}

/**
 * Extrai dados disponíveis SOMENTE da URL.
 * Nunca inventa preço, comissão, avaliação etc.
 * Marca campos_faltantes para tudo que não puder ser obtido.
 */
function extrairDadosDaUrl(url: string): DadosProduto {
  const marketplace = detectarMarketplace(url);
  const produtoId = extrairProdutoId(url, marketplace);

  const camposFaltantes: string[] = [
    "titulo",
    "preco",
    "comissao_percentual",
    "avaliacao",
    "num_avaliacoes",
    "categoria",
    "imagem_url",
  ];

  // Se nem o marketplace foi detectado, adiciona também
  if (!marketplace) {
    camposFaltantes.unshift("marketplace");
  }
  if (!produtoId) {
    camposFaltantes.unshift("produto_id");
  }

  return {
    url: url.trim(),
    marketplace,
    produto_id: produtoId,
    titulo: null,
    preco: null,
    comissao_percentual: null,
    avaliacao: null,
    num_avaliacoes: null,
    categoria: null,
    imagem_url: null,
    campos_faltantes: camposFaltantes,
  };
}

/**
 * Normaliza a resposta do Groq e aplica filtros eliminatórios locais
 * caso o modelo tenha falhado em aplicar.
 */
function normalizarResposta(
  resp: RespostaPontuacaoGroq,
  dados: DadosProduto,
  config: ConfigAgente
): RespostaPontuacaoGroq {
  let eliminado = resp.eliminado;
  let motivo = resp.motivo_eliminacao;
  let pontuacao = Math.max(0, Math.min(100, Number(resp.pontuacao) || 0));

  // Reforça filtros eliminatórios localmente
  if (
    dados.comissao_percentual !== null &&
    dados.comissao_percentual < config.comissao_minima
  ) {
    eliminado = true;
    motivo = `Comissão ${dados.comissao_percentual}% abaixo do mínimo ${config.comissao_minima}%`;
    pontuacao = 0;
  }
  if (dados.preco !== null && dados.preco > config.valor_maximo) {
    eliminado = true;
    motivo = `Preço R$ ${dados.preco} acima do máximo R$ ${config.valor_maximo}`;
    pontuacao = 0;
  }
  if (dados.avaliacao !== null && dados.avaliacao < 3.0) {
    eliminado = true;
    motivo = `Avaliação ${dados.avaliacao} abaixo de 3.0`;
    pontuacao = 0;
  }

  const sub = resp.subpontuacoes ?? {
    margem_comissao: 0,
    giro_velocidade: 0,
    avaliacao: 0,
    tendencia: 0,
    competitividade: 0,
    sazonalidade: 0,
  };

  return {
    pontuacao: eliminado ? 0 : pontuacao,
    subpontuacoes: {
      margem_comissao: clamp(sub.margem_comissao),
      giro_velocidade: clamp(sub.giro_velocidade),
      avaliacao: clamp(sub.avaliacao),
      tendencia: clamp(sub.tendencia),
      competitividade: clamp(sub.competitividade),
      sazonalidade: clamp(sub.sazonalidade),
    },
    razao: Array.isArray(resp.razao) ? resp.razao : [],
    relatorio: typeof resp.relatorio === "string" ? resp.relatorio : "Sem relatório gerado.",
    confianca: ["baixa", "media", "alta"].includes(resp.confianca)
      ? resp.confianca
      : "baixa",
    eliminado,
    motivo_eliminacao: motivo,
  };
}

function clamp(n: number | undefined): number {
  const v = Number(n);
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

/**
 * Processa um único link: extrai → pontua → grava.
 */
async function processarLink(
  url: string,
  config: ConfigAgente,
  usuarioId: string
): Promise<{ sucesso: boolean; propostaId?: string; erro?: string }> {
  const dados = extrairDadosDaUrl(url);
  const dadosIncompletos = dados.campos_faltantes.length > 0;

  console.log(`→ Processando: ${url}`);
  console.log(`  Marketplace: ${dados.marketplace ?? "desconhecido"} | ID: ${dados.produto_id ?? "n/a"}`);
  console.log(`  Campos faltantes: ${dados.campos_faltantes.join(", ")}`);

  try {
    const raw = await pontuarComGroq(dados, config, usuarioId);
    const resp = normalizarResposta(raw, dados, config);

    // Se eliminado, ainda grava a proposta com status pendente e pontuação 0
    // para o usuário ver o motivo.
    const proposta: PropostaAgente = {
      usuario_id: usuarioId,
      dados_produto: dados,
      pontuacao: resp.pontuacao,
      subpontuacoes: resp.subpontuacoes,
      razao: resp.eliminado && resp.motivo_eliminacao
        ? [...resp.razao, `ELIMINADO: ${resp.motivo_eliminacao}`]
        : resp.razao,
      relatorio: resp.relatorio,
      dados_incompletos: dadosIncompletos,
      confianca: resp.confianca,
      status: "pendente",
    };

    const propostaId = await gravarProposta(proposta);

    await gravarLogAgente({
      usuario_id: usuarioId,
      acao: "pontuou",
      resultado: "sucesso",
      detalhe: {
        url,
        proposta_id: propostaId,
        pontuacao: resp.pontuacao,
        eliminado: resp.eliminado,
        dados_incompletos: dadosIncompletos,
      },
      mensagem: resp.eliminado
        ? `Produto eliminado: ${resp.motivo_eliminacao}`
        : `Produto pontuado com ${resp.pontuacao.toFixed(1)} pontos`,
    });

    console.log(`  ✓ Proposta ${propostaId} gravada | pontuação: ${resp.pontuacao}`);
    return { sucesso: true, propostaId };
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ Erro: ${mensagem}`);

    await gravarLogAgente({
      usuario_id: usuarioId,
      acao: "pontuou",
      resultado: "falhou",
      detalhe: { url, erro: mensagem },
      mensagem: `Falha ao pontuar: ${mensagem}`,
    });

    return { sucesso: false, erro: mensagem };
  }
}

/**
 * Entrada principal do Agente Caçador.
 * Lê LINKS (um por linha) e USUARIO_ID do ambiente.
 */
async function main(): Promise<void> {
  console.log("=== Agente Caçador v1 ===");
  console.log(`Horário: ${new Date().toISOString()}`);

  const linksRaw = process.env.LINKS ?? "";
  const usuarioIdEnv = process.env.USUARIO_ID ?? "";

  const links = linksRaw
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && (l.startsWith("http://") || l.startsWith("https://")));

  if (links.length === 0) {
    console.log("Nenhum link válido recebido. Encerrando (input vazio).");
    process.exit(0);
  }

  console.log(`Links recebidos: ${links.length}`);

  // Busca config do usuário
  let config: ConfigAgente | null;
  try {
    config = await buscarConfigAgente(usuarioIdEnv || undefined);
  } catch (err) {
    console.error("Falha ao buscar config_agente:", err);
    process.exit(1);
  }

  if (!config) {
    console.error(
      "Nenhuma config_agente encontrada. Cadastre no painel antes de rodar o Caçador."
    );
    process.exit(1);
  }

  const usuarioId = config.usuario_id;
  const nicho = config.categorias?.join(", ") ?? "geral";
  console.log(`Usuário: ${usuarioId} | Nicho: ${nicho}`);
  console.log(
    `Filtros → comissão ≥ ${config.comissao_minima}% | valor ≤ R$ ${config.valor_maximo}`
  );

  let sucessos = 0;
  let falhas = 0;

  for (const link of links) {
    const resultado = await processarLink(link, config, usuarioId);
    if (resultado.sucesso) sucessos++;
    else falhas++;
  }

  console.log("\n=== Resumo ===");
  console.log(`Sucessos: ${sucessos} | Falhas: ${falhas}`);

  // Se todos falharam, marca o job como falha
  if (sucessos === 0 && falhas > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Erro fatal no Caçador:", err);
  process.exit(1);
});
