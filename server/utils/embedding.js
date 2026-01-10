import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function embed(text) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("embed(): input text is empty or invalid");
  }

  const response = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000), // safety cap
  });

  const embedding = response.data?.[0]?.embedding;

  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("embed(): failed to generate embedding");
  }

  return embedding;
}

export function cosineSimilarity(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length
  ) {
    throw new Error("cosineSimilarity(): vectors must be same length arrays");
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;

  return dot / (magA * magB);
}
