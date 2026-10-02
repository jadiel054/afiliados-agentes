/**
 * Tipos compartilhados do orquestrador de agentes de afiliados.
 * Zero "any" — tudo tipado de forma estrita.
 */

/** Configuração do agente por usuário (tabela config_agente). */
export interface ConfigAgente {
  id: string;
  usuario_id: string;
  nicho: string;
  comissao_minima: number;
  valor_maximo: number;
  categorias: string[] | null;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Dados extraídos de um link de produto (sem inventar o que não dá para saber). */
export interface DadosProduto {
  url: string;
  marketplace: string | null;
  produto_id: string | null;
  titulo: string | null;
  preco: number | null;
  comissao_percentual: number | null;
  avaliacao: number | null;
  num_avaliacoes: number | null;
  categoria: string | null;
  imagem_url: string | null;
  /** Campos que não puderam ser extraídos só da URL. */
  campos_faltantes: string[];
}

/** Subpontuações ponderadas do produto. */
export interface Subpontuacoes {
  margem_comissao: number;
  giro_velocidade: number;
  avaliacao: number;
  tendencia: number;
  competitividade: number;
  sazonalidade: number;
}

/** Confiança da análise. */
export type Confianca = "baixa" | "media" | "alta";

/** Status da proposta. */
export type StatusProposta =
  | "pendente"
  | "aprovado"
  | "rejeitado"
  | "automatico"
  | "expirado";

/** Registro a ser gravado em propostas_agente. */
export interface PropostaAgente {
  usuario_id: string;
  dados_produto: DadosProduto;
  pontuacao: number;
  subpontuacoes: Subpontuacoes;
  razao: string[];
  relatorio: string;
  dados_incompletos: boolean;
  confianca: Confianca;
  status: StatusProposta;
}

/** Resultado de uma ação do agente (log_agente). */
export type ResultadoLog = "sucesso" | "parcial" | "falhou";

export interface LogAgente {
  usuario_id: string;
  acao: string;
  resultado: ResultadoLog;
  detalhe: Record<string, unknown>;
  mensagem: string;
}

/** Registro de chamada à IA (log_ia). */
export interface LogIa {
  usuario_id: string;
  provedor: string;
  modelo: string;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  latencia_ms: number;
  sucesso: boolean;
  erro: string | null;
}

/** Resposta estruturada esperada do Groq na pontuação. */
export interface RespostaPontuacaoGroq {
  pontuacao: number;
  subpontuacoes: Subpontuacoes;
  razao: string[];
  relatorio: string;
  confianca: Confianca;
  eliminado: boolean;
  motivo_eliminacao: string | null;
}
