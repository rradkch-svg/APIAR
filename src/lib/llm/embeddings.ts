import { getRuntimeConfig } from "../config/runtime";
import { dbQuery } from "../db/client";

export const EMBEDDING_DIM = 768;

function fnv1a(str: string, seed = 2166136261): number {
  let h = seed;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic 768-dimensional local semantic embedding for Zero-Cost Mock/Fallback mode.
 * Projects normalized words, word bigrams, character trigrams, and semantic concept buckets
 * onto a unit-length 768-d vector so pgvector HNSW cosine distance (<=>) genuinely retrieves
 * relevant memories (names, secrets, pets, coffee, crushes, drama, etc.) offline.
 */
export function computeDeterministicEmbedding(text: string): number[] {
  const vec = new Float32Array(EMBEDDING_DIM);
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9@#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    vec[0] = 1;
    return Array.from(vec);
  }

  const tokens = cleaned.split(" ").filter((t) => t.length >= 2);
  const addFeature = (feat: string, weight: number) => {
    const idx1 = fnv1a(feat, 2166136261) % EMBEDDING_DIM;
    const idx2 = fnv1a(feat, 2654435761) % EMBEDDING_DIM;
    const sign1 = (fnv1a(feat, 1315423911) & 1) === 0 ? 1 : -1;
    const sign2 = (fnv1a(feat, 97531) & 1) === 0 ? 1 : -1;
    vec[idx1] += sign1 * weight;
    vec[idx2] += sign2 * weight * 0.65;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    addFeature(`w:${tok}`, 2.5);
    if (i + 1 < tokens.length) {
      addFeature(`b:${tok}_${tokens[i + 1]}`, 1.8);
    }
    if (tok.length >= 4) {
      for (let j = 0; j <= tok.length - 3; j++) {
        addFeature(`c:${tok.slice(j, j + 3)}`, 0.45);
      }
    }
  }

  // Domain concept boosts so synonyms cluster cleanly in cosine space
  const conceptGroups: Record<string, string[]> = {
    romance: ["crush", "kiss", "kissed", "dating", "hooked", "flirt", "love", "date", "situationship", "ex"],
    gossip: ["secret", "gossip", "tea", "rumor", "leaked", "tell", "nobody", "hide", "spotted", "drama"],
    campus: ["exam", "calc", "study", "class", "midterm", "dorm", "campus", "library", "professor"],
    party: ["party", "tailgate", "friday", "dj", "afterparty", "drinks", "club", "hangout", "flaked"],
    coffee: ["coffee", "latte", "espresso", "matcha", "cafe"],
    pet: ["dog", "cat", "puppy", "kitten", "pet"],
    arts: ["band", "guitar", "tattoo", "film", "movie", "music", "art", "sketch"],
    tech: ["code", "game", "gaming", "dnd", "figma", "design", "lab", "valorant"],
  };

  for (const [concept, words] of Object.entries(conceptGroups)) {
    if (words.some((w) => tokens.includes(w))) {
      addFeature(`concept:${concept}`, 3.0);
    }
  }

  let normSq = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) normSq += vec[i] * vec[i];
  const norm = Math.sqrt(normSq) || 1;
  const normalized = new Array<number>(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    normalized[i] = Number((vec[i] / norm).toFixed(6));
  }
  return normalized;
}

function fitToDim(values: number[], targetDim = EMBEDDING_DIM): number[] {
  if (values.length === targetDim) return values;
  if (values.length > targetDim) {
    const sliced = values.slice(0, targetDim);
    const norm = Math.sqrt(sliced.reduce((acc, v) => acc + v * v, 0)) || 1;
    return sliced.map((v) => v / norm);
  }
  const padded = [...values];
  while (padded.length < targetDim) padded.push(0);
  return padded;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const cfg = getRuntimeConfig();

  if (cfg.geminiApiKey && (cfg.llmProvider === "gemini" || !cfg.llmEmbeddingModel)) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
      const model = cfg.geminiEmbeddingModel || "gemini-embedding-001";
      const res = await ai.models.embedContent({
        model,
        contents: text,
        config: { outputDimensionality: EMBEDDING_DIM },
      });
      const values = res.embeddings?.[0]?.values;
      if (values && values.length > 0) {
        return fitToDim(values, EMBEDDING_DIM);
      }
    } catch (err) {
      console.warn("[embeddings] Gemini embedContent failed, using deterministic 768d fallback:", err);
    }
  } else if (
    cfg.llmProvider === "openai_compatible" &&
    cfg.llmApiKey &&
    cfg.llmBaseUrl &&
    cfg.llmEmbeddingModel
  ) {
    try {
      const res = await fetch(`${cfg.llmBaseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.llmApiKey}`,
        },
        body: JSON.stringify({
          model: cfg.llmEmbeddingModel,
          input: text,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
        const values = data.data?.[0]?.embedding;
        if (values && values.length > 0) {
          return fitToDim(values, EMBEDDING_DIM);
        }
      }
    } catch (err) {
      console.warn("[embeddings] OpenAI-compatible embed failed, using deterministic 768d fallback:", err);
    }
  }

  return computeDeterministicEmbedding(text);
}

export function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => (Number.isFinite(v) ? v.toFixed(6) : "0")).join(",")}]`;
}

export interface StoredMemoryRow {
  id: string;
  user_id: string;
  persona_id: string;
  fact: string;
  category: string;
  importance: number;
  source_type: "direct" | "feed" | "gossip";
  leaked_by_persona: string | null;
  created_at: string;
  similarity?: number;
}

export async function storeMemoryWithEmbedding(params: {
  userId: string;
  personaId: string;
  fact: string;
  category: string;
  importance: number;
  sourceType: "direct" | "feed" | "gossip";
  leakedByPersona?: string | null;
}): Promise<StoredMemoryRow | null> {
  const cleanFact = params.fact.trim();
  if (!cleanFact) return null;

  // Deduplicate exact/near-identical fact for the same persona
  const existing = await dbQuery<{ id: string }>(
    `SELECT id FROM memories
     WHERE user_id = $1 AND persona_id = $2 AND LOWER(fact) = LOWER($3)
     LIMIT 1`,
    [params.userId, params.personaId, cleanFact]
  );
  if (existing.rows.length > 0) return null;

  const vec = await generateEmbedding(cleanFact);
  const literal = toPgVectorLiteral(vec);

  const res = await dbQuery<StoredMemoryRow>(
    `INSERT INTO memories (
      user_id, persona_id, fact, category, importance, source_type, leaked_by_persona, embedding
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
    RETURNING id, user_id, persona_id, fact, category, importance, source_type, leaked_by_persona, created_at`,
    [
      params.userId,
      params.personaId,
      cleanFact,
      params.category,
      Math.max(1, Math.min(10, Math.round(params.importance))),
      params.sourceType,
      params.leakedByPersona ?? null,
      literal,
    ]
  );
  return res.rows[0] ?? null;
}

export async function retrieveTopMemories(
  userId: string,
  personaId: string,
  queryText: string,
  limit = 5
): Promise<StoredMemoryRow[]> {
  const vec = await generateEmbedding(queryText);
  const literal = toPgVectorLiteral(vec);

  const res = await dbQuery<StoredMemoryRow>(
    `SELECT
       id, user_id, persona_id, fact, category, importance,
       source_type, leaked_by_persona, created_at,
       (1 - (embedding <=> $3::vector))::float AS similarity
     FROM memories
     WHERE user_id = $1 AND persona_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $3::vector ASC, importance DESC
     LIMIT $4`,
    [userId, personaId, literal, limit]
  );
  return res.rows;
}
