/**
 * Cliente Supabase com service role key.
 * Usa as variáveis de ambiente injetadas pelos GitHub Secrets.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ConfigAgente,
  PropostaAgente,
  LogAgente,
  LogIa,
} from "../../types/index.js";

let cliente: SupabaseClient | null = null;

/**
 * Retorna o cliente Supabase singleton (service role).
 * Lança erro se as variáveis obrigatórias não estiverem definidas.
 */
export function getSupabase(): SupabaseClient {
  if (cliente) return cliente;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios (GitHub Secrets)."
    );
  }

  cliente = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cliente;
}

/**
 * Busca a configuração do agente para um usuário.
 * Se usuarioId for informado, filtra por usuario_id;
 * senão retorna a primeira linha (limit 1).
 */
export async function buscarConfigAgente(
  usuarioId?: string
): Promise<ConfigAgente | null> {
  const sb = getSupabase();

  let query = sb.from("config_agente").select("*").limit(1);

  if (usuarioId) {
    query = query.eq("usuario_id", usuarioId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Erro ao buscar config_agente: ${error.message}`);
  }

  return data as ConfigAgente | null;
}

/**
 * Insere uma proposta de produto no banco.
 */
export async function gravarProposta(
  proposta: PropostaAgente
): Promise<string> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from("propostas_agente")
    .insert({
      usuario_id: proposta.usuario_id,
      dados_produto: proposta.dados_produto,
      pontuacao: proposta.pontuacao,
      subpontuacoes: proposta.subpontuacoes,
      razao: proposta.razao,
      relatorio: proposta.relatorio,
      dados_incompletos: proposta.dados_incompletos,
      confianca: proposta.confianca,
      status: proposta.status,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Erro ao gravar proposta: ${error.message}`);
  }

  return data.id as string;
}

/**
 * Grava log de ação do agente.
 */
export async function gravarLogAgente(log: LogAgente): Promise<void> {
  const sb = getSupabase();

  const { error } = await sb.from("log_agente").insert({
    usuario_id: log.usuario_id,
    acao: log.acao,
    resultado: log.resultado,
    detalhe: log.detalhe,
    mensagem: log.mensagem,
  });

  if (error) {
    // Não interrompe o fluxo principal — apenas registra no console
    console.error(`[log_agente] Falha ao gravar: ${error.message}`);
  }
}

/**
 * Grava log de chamada à IA.
 */
export async function gravarLogIa(log: LogIa): Promise<void> {
  const sb = getSupabase();

  const { error } = await sb.from("log_ia").insert({
    usuario_id: log.usuario_id,
    provedor: log.provedor,
    modelo: log.modelo,
    tokens_entrada: log.tokens_entrada,
    tokens_saida: log.tokens_saida,
    latencia_ms: log.latencia_ms,
    sucesso: log.sucesso,
    erro: log.erro,
  });

  if (error) {
    console.error(`[log_ia] Falha ao gravar: ${error.message}`);
  }
}
