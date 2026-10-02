# afiliados-agentes

**Cérebro multi-agente** de um sistema de gestão de afiliados.

Este repositório é o **orquestrador** que roda via GitHub Actions.  
O painel (React + Supabase) vive em `afiliados-inteligentes`.

---

## Stack

| Camada        | Tecnologia                          |
|---------------|-------------------------------------|
| Runtime       | Node 20 + TypeScript (tsx)          |
| Banco         | Supabase Postgres (service role)    |
| LLM           | Groq (`openai/gpt-oss-120b`)        |
| Orquestração  | GitHub Actions (ubuntu-latest)      |

---

## Secrets obrigatórios

No repositório → **Settings → Secrets and variables → Actions**, cadastre:

| Secret                         | Descrição                                      |
|--------------------------------|------------------------------------------------|
| `SUPABASE_URL`                 | URL do projeto Supabase do painel               |
| `SUPABASE_SERVICE_ROLE_KEY`    | Service role key (nunca use a anon key aqui)   |
| `GROQ_API_KEY`                 | Chave da API Groq                              |

---

## Como rodar o Agente Caçador (manual)

1. Vá em **Actions → Agente Caçador → Run workflow**.
2. No campo **links**, cole um URL por linha, por exemplo:

   ```
   https://shopee.com.br/produto-exemplo-i.123.456
   https://www.mercadolivre.com.br/produto/MLB123456789
   https://www.amazon.com.br/dp/B0EXAMPLE
   ```

3. (Opcional) Informe o `usuario_id` (UUID). Se deixar vazio, o agente usa a primeira `config_agente` ativa.
4. Clique em **Run workflow**.

O job:

1. Lê a `config_agente` do usuário (nicho, comissão mínima, valor máximo, categorias).
2. Para cada link, extrai o que for possível **somente da URL** (marketplace + ID quando reconhecível). Não inventa preço, comissão ou avaliação.
3. Chama o Groq para pontuar (pesos: margem 30 %, giro 25 %, avaliação 15 %, tendência 15 %, competitividade 10 %, sazonalidade 5 %).
4. Aplica filtros eliminatórios: comissão < mínima, valor > máximo, avaliação < 3.0.
5. Grava em `propostas_agente` (status `pendente`), `log_agente` e `log_ia`.

### Critério de pronto

- Workflow verde no Actions.
- Ao rodar com 3 links de teste, as propostas aparecem na tabela `propostas_agente` do Supabase.

---

## Estrutura

```
src/
  agentes/
    cacador.ts      ← Agente 1 (único nesta fase)
  lib/
    supabase.ts     ← Cliente + helpers de gravação
    groq.ts         ← Chamadas LLM com timeout 30s
types/
  index.ts          ← Tipos estritos (zero "any")
.github/workflows/
  cacador.yml       ← Cron a cada 2h + workflow_dispatch
```

---

## Agente Caçador v1 — regras

- **Semi-manual**: links chegam pelo `workflow_dispatch` (colados no celular).
- **Zero APIs de marketplace** nesta fase (sem Shopee/ML ainda).
- Dados incompletos → `dados_incompletos = true` e confiança reduzida.
- Toda chamada Groq tem timeout de 30 s e grava falha em `log_ia`.
- Código 100 % tipado e comentado em PT-BR.

---

## Plano dos próximos agentes

| Agente       | Função principal                                                                 | Status   |
|--------------|----------------------------------------------------------------------------------|----------|
| **Caçador**  | Recebe links → extrai → pontua → grava propostas                                 | ✅ v1    |
| **Roteirista** | Lê propostas aprovadas e gera roteiros de conteúdo (Reels, stories, posts)     | 🔜       |
| **Publicador** | Publica o conteúdo gerado nas plataformas configuradas (quando houver API)     | 🔜       |
| **Escuta**   | Monitora métricas, comentários e performance para feedback ao Caçador/Roteirista | 🔜       |

---

## Desenvolvimento local

```bash
cp .env.example .env   # preencha as 3 variáveis
npm install
LINKS="https://exemplo.com/produto" USUARIO_ID="uuid-aqui" npm run cacador
```

Crie um `.env.example` com:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GROQ_API_KEY=
```

---

## Licença

Uso interno do projeto de afiliados.
