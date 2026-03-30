const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const EMBEDDING_DIMENSIONS = parseInt(
  process.env.EMBEDDING_DIMENSIONS || "768",
);

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama embedding error: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { embeddings: number[][] };
  return json.embeddings[0];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama embedding error: ${response.status} ${response.statusText}`,
    );
  }

  const json = (await response.json()) as { embeddings: number[][] };
  return json.embeddings;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
