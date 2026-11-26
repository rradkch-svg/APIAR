# ANTIGRAVITY MASTER SPEC — AI SOCIAL NETWORK (CIRCLE / ORBIT / CHARM)

> **Instrução para o Agente (Antigravity):** Leia todos os arquivos desta pasta (`02_schema.sql`, `03_seed_personas.json`, `04_seed_graph_edges.json`, `05_prompts_and_schemas.json`, `06_api_and_workers.yaml`) antes de escrever código. Implemente o projeto completo seguindo rigorosamente a arquitetura, o grafo direcionado de 22 personagens e os contratos de API definidos abaixo.

---

## 1. Visão do Produto & Diferencial
Um simulador de rede social **single-player** mobile-first no padrão de **Circle**, **Orbit** e **Charm**, onde o usuário vive dentro de um ecossistema de **22 personas autônomas de IA** organizadas em **5 núcleos sociais** conectados por um **grafo direcionado e ponderado**.

O que faz o app parecer real (e não um chatbot comum):
1. **Respostas em múltiplos balões (Multi-bubble DMs)** com atrasos proporcionais ao tamanho do texto e indicador `digitando...` real via WebSocket/SSE.
2. **Grafo de Relacionamentos Assimétrico:** Personagens têm amizades, rivalidades, ex-namoros, crushes secretos e confiança de fofoca diferentes em cada direção (`A -> B != B -> A`).
3. **Cascata de Comentários por Atrito:** Quando o usuário posta, bots reagem de forma assíncrona e **brigam ou concordam entre si nos comentários** com base nos pesos `friction` e `affinity` do grafo.
4. **Motor de Propagação de Fofoca (Graph Traversal):** Se o usuário conta algo suculento para um bot fofoqueiro (ex: Bia, `gossip_propensity: 0.95`), o sistema percorre `v_gossip_routes` e vaza o fato para a memória de vizinhos (ex: Jade -> Sofia), que podem confrontar o usuário depois na DM.
5. **Detecção de Print / Eventos Reativos:** Botão/evento simulado (ou nativo no mobile) de `screenshot_alert` na DM fazendo a persona reagir na hora.
6. **Aba de Afinidade & Grafo Interativo:** Mostra anel de afinidade, humor atual, pensamento interno atualizado a cada DM, fatos lembrados e um mapa visual das relações entre os 22 personagens.

---

## 2. Stack Recomendada (Implementação Rápida e Escalável)

| Camada | Tecnologia | Motivo |
| :--- | :--- | :--- |
| **Frontend** | Next.js 15 (App Router) + Tailwind CSS + Framer Motion | UI mobile-first estilo Instagram/Circle, PWA instalável no celular, animações suaves de balões e feed. |
| **Visualização do Grafo** | `react-force-graph-2d` ou Cytoscape.js | Renderiza os 22 nós coloridos por núcleo e as arestas (rivalidade/crush/bestie) na aba Turma. |
| **Backend** | FastAPI (Python) **ou** Next.js Route Handlers + Worker Node/TS | Escolha uma stack única (preferência: **Next.js Fullstack + TypeScript** ou **FastAPI + React**) com validação Zod/Pydantic. |
| **Banco & Vetor** | PostgreSQL + `pgvector` (Supabase ou Docker local) | Usa `02_schema.sql` diretamente sem alterações. |
| **Tempo Real** | Server-Sent Events (SSE) ou Socket.io | Entrega de `typing:start`, `dm:bubble` e `feed:comment` em tempo real. |
| **LLM & Embeddings** | Google Gemini API (`gemini-2.5-flash` + `gemini-2.5-flash-lite` + `text-embedding-004`) | Suporte nativo a Structured Outputs (JSON Schema de `05_prompts_and_schemas.json`) e baixíssimo custo. |

---

## 3. Estrutura de Pastas Alvo

```text
/
├── prisma/ ou db/
│   ├── schema.sql                  # Copiado de 02_schema.sql
│   └── seed.ts / seed.py           # Carrega 03_seed_personas.json e 04_seed_graph_edges.json
├── src/
│   ├── lib/
│   │   ├── llm/
│   │   │   ├── router.ts           # Roteamento fast_tier vs roleplay_tier + Structured Outputs
│   │   │   ├── prompts.ts          # Templates de 05_prompts_and_schemas.json
│   │   │   └── embeddings.ts       # RAG com pgvector (Top-5 memórias por cosseno)
│   │   ├── graph/
│   │   │   ├── selector.ts         # Seleciona comentaristas e pares de briga por friction/affinity
│   │   │   └── gossip.ts           # Traversal de até 2 hops em v_gossip_routes
│   │   └── workers/
│   │       └── scheduler.ts        # Poller de scheduled_jobs (5s) + Lazy Feed Generation
│   ├── app/
│   │   ├── (onboarding)/page.tsx   # Setup de nome, handle, bio e contexto
│   │   ├── feed/page.tsx           # Feed estilo Circle/Instagram + composer + comentários aninhados
│   │   ├── dms/page.tsx            # Inbox com badges de não lidas e preview
│   │   ├── dms/[id]/page.tsx       # Chat multi-bubble, typing indicator e botão de simular print
│   │   ├── crew/page.tsx           # Lista dos 22 bots + filtro por núcleo + Grafo Interativo
│   │   └── profile/page.tsx        # Energia diária, plano, modo dev ("Simular +24h") e API Key
```

---

## 4. Regras de UI/UX (O que NÃO fazer)
- **Visual Dark-First Premium:** Fundo `#0B0A10`, cards `#151320`, bordas sutis `#262338`, acentos vibrantes por persona (`accent_color` do JSON). Nada de visual genérico de formulário branco.
- **Avatares com Anel de Afinidade:** Progresso circular (`conic-gradient`) + bolinha de status online quando a persona está no horário ativo.
- **Ritmo Humano na DM:** Nunca renderizar os 3 balões da resposta da IA no mesmo milissegundo. Emitir `typing:start`, aguardar `Math.min(4000, bubble.length * 45)` ms, enviar o balão 1, repetir para o balão 2 e 3.
- **Controle de Custo Integrado:**
  - Likes e views são calculados algoritmicamente (custo zero de LLM).
  - Contexto da DM limitado às últimas 15 mensagens + Top-5 memórias via `pgvector` + 2 últimos posts do usuário.
  - Modo **Mock/Fallback** automático caso `GEMINI_API_KEY` não esteja configurada, para testar UI e grafo sem gastar tokens.

---

## 5. Ordem de Execução para o Agente
1. Subir estrutura do projeto + Docker Compose (PostgreSQL com `pgvector/pgvector:pg16`).
2. Executar `02_schema.sql` e criar script de seed lendo `03_seed_personas.json` (22 nós) e `04_seed_graph_edges.json` (48 arestas direcionadas).
3. Implementar camada LLM (`router.ts`, `prompts.ts`, `embeddings.ts`) usando os JSON Schemas de `05_prompts_and_schemas.json`.
4. Implementar motor de grafo (`selector.ts` para cascata de comentários e `gossip.ts` para vazamento de fofoca) + worker `scheduled_jobs`.
5. Construir endpoints de `06_api_and_workers.yaml` e stream SSE/WebSocket.
6. Construir interface mobile-first completa (Onboarding, Feed, DMs multi-bubble, Aba Turma com Grafo Interativo e Perfil com botão `+24h`).
7. Validar fluxo ponta a ponta: Onboarding -> Postar no Feed -> Ver cascata de comentários/briga entre bots -> Abrir DM com a Bia e contar um segredo -> Verificar propagação de fofoca no banco -> Testar `+24h`.
