/**
 * Embeddings Utility for Semantic Search
 * Simple TF-IDF based similarity for fast semantic search without external dependencies
 */

export interface TFMap {
  [token: string]: number;
}

export interface IDFMap {
  [token: string]: number;
}

export interface TFIDFVector {
  [token: string]: number;
}

export interface TextChunk {
  text: string;
  start: number;
  end: number;
}

export interface MemoryChunk {
  text: string;
  date: string;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  text: string;
  similarity: number;
  date: string;
  metadata: Record<string, unknown>;
}

export interface BoostedResult extends SearchResult {
  boostedScore: number;
  originalScore: number;
}

/**
 * Tokenize text into words
 * @param text - Text to tokenize
 * @returns Array of tokens
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2); // Filter out very short words
}

/**
 * Calculate term frequency for a document
 * @param tokens - Document tokens
 * @returns Term frequency map
 */
export function calculateTF(tokens: string[]): TFMap {
  const tf: TFMap = {};
  const total = tokens.length;

  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }

  // Normalize by document length
  for (const token in tf) {
    tf[token] = tf[token] / total;
  }

  return tf;
}

/**
 * Calculate inverse document frequency
 * @param documents - Array of tokenized documents
 * @returns IDF map
 */
export function calculateIDF(documents: string[][]): IDFMap {
  const idf: IDFMap = {};
  const numDocs = documents.length;

  // Count document frequency for each term
  const df: Record<string, number> = {};
  for (const doc of documents) {
    const uniqueTokens = new Set(doc);
    for (const token of uniqueTokens) {
      df[token] = (df[token] || 0) + 1;
    }
  }

  // Calculate IDF
  for (const token in df) {
    idf[token] = Math.log(numDocs / df[token]);
  }

  return idf;
}

/**
 * Calculate TF-IDF vector for a document
 * @param tokens - Document tokens
 * @param idf - IDF map
 * @returns TF-IDF vector
 */
export function calculateTFIDF(tokens: string[], idf: IDFMap): TFIDFVector {
  const tf = calculateTF(tokens);
  const tfidf: TFIDFVector = {};

  for (const token in tf) {
    tfidf[token] = tf[token] * (idf[token] || 0);
  }

  return tfidf;
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 * @param vec1 - First TF-IDF vector
 * @param vec2 - Second TF-IDF vector
 * @returns Cosine similarity (0-1)
 */
export function cosineSimilarity(vec1: TFIDFVector, vec2: TFIDFVector): number {
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  // Get all unique terms
  const allTerms = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);

  for (const term of allTerms) {
    const v1 = vec1[term] || 0;
    const v2 = vec2[term] || 0;

    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }

  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

/**
 * Split text into chunks
 * @param text - Text to chunk
 * @param chunkSize - Size of each chunk in characters
 * @param overlap - Overlap between chunks in characters
 * @returns Array of chunks
 */
export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 100
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunkText = text.substring(start, end);

    chunks.push({
      text: chunkText,
      start,
      end,
    });

    start += chunkSize - overlap;
  }

  return chunks;
}

/**
 * Search memory chunks using TF-IDF similarity
 * @param query - Search query
 * @param memoryChunks - Memory chunks to search
 * @param topK - Number of top results to return
 * @returns Top matching chunks
 */
export function searchMemoryChunks(
  query: string,
  memoryChunks: MemoryChunk[],
  topK: number = 5
): SearchResult[] {
  if (!memoryChunks || memoryChunks.length === 0) {
    return [];
  }

  // Tokenize query
  const queryTokens = tokenize(query);

  // Tokenize all chunks
  const chunksTokens = memoryChunks.map((chunk) => tokenize(chunk.text));

  // Calculate IDF across all chunks
  const idf = calculateIDF([queryTokens, ...chunksTokens]);

  // Calculate TF-IDF for query
  const queryTFIDF = calculateTFIDF(queryTokens, idf);

  // Calculate similarity for each chunk
  const results: SearchResult[] = memoryChunks.map((chunk, idx) => {
    const chunkTFIDF = calculateTFIDF(chunksTokens[idx], idf);
    const similarity = cosineSimilarity(queryTFIDF, chunkTFIDF);

    return {
      text: chunk.text,
      similarity,
      date: chunk.date,
      metadata: chunk.metadata || {},
    };
  });

  // Sort by similarity and return top K
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

/**
 * Simple keyword-based boosting for recency and relevance
 * @param results - Search results with similarity scores
 * @param currentDate - Current date for recency calculation
 * @param recencyBoost - Boost factor for recent results (0-1)
 * @returns Boosted results
 */
export function applyRecencyBoost(
  results: SearchResult[],
  currentDate: Date,
  recencyBoost: number = 0.2
): BoostedResult[] {
  const now = currentDate.getTime();

  return results
    .map((result) => {
      let boostedScore = result.similarity;

      // Parse date and calculate recency boost
      if (result.date) {
        try {
          const resultDate = new Date(result.date);
          const daysAgo = (now - resultDate.getTime()) / (1000 * 60 * 60 * 24);

          // Exponential decay: more recent = higher boost
          const recencyFactor = Math.exp(-daysAgo / 7); // Decay over ~1 week
          boostedScore += recencyBoost * recencyFactor;
        } catch {
          // Invalid date, skip boost
        }
      }

      return {
        ...result,
        boostedScore,
        originalScore: result.similarity,
      };
    })
    .sort((a, b) => b.boostedScore - a.boostedScore);
}
