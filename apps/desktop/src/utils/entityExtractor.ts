/**
 * Entity Extractor
 * Fast regex-based entity extraction before expensive LLM calls
 */

export interface ExtractedEntities {
  people: string[];
  dates: string[];
  times: string[];
  references: string[];
}

export interface EntityCacheKey {
  type: 'person' | 'date' | 'time';
  value: string;
  cacheKey: string;
}

export interface UncachedEntities {
  people: string[];
  dates: string[];
  times: string[];
}

export interface LLMResolutions {
  people?: Record<string, unknown>;
  dates?: Record<string, unknown>;
  times?: Record<string, unknown>;
}

export interface ResolvedEntitiesResult {
  entities: Record<string, unknown>;
  allCached: boolean;
  cacheHits: number;
  cacheMisses: number;
}

export interface EntityCache {
  getEntity(userId: string, entityType: string, entityValue: string): unknown | null;
  cacheEntity(
    userId: string,
    entityType: string,
    entityValue: string,
    resolution: unknown
  ): void;
}

/**
 * Extract potential entities from query using regex patterns
 * @param query - User query
 * @returns Extracted entities by type
 */
export function extractEntitiesRegex(query: string): ExtractedEntities {
  const entities: ExtractedEntities = {
    people: [],
    dates: [],
    times: [],
    references: [],
  };

  // ─────────────────────────────────────────────────────────────────────────
  // People/Relationship References
  // ─────────────────────────────────────────────────────────────────────────

  // Personal relationships
  const peoplePatterns = [
    /\b(my )?(?:boss|manager|supervisor|ceo|cto|cfo)\b/gi,
    /\b(my )?(?:wife|husband|spouse|partner)\b/gi,
    /\b(my )?(?:mom|mother|dad|father|parents|parent)\b/gi,
    /\b(my )?(?:son|daughter|child|children|kid|kids)\b/gi,
    /\b(my )?(?:brother|sister|sibling)\b/gi,
    /\b(my )?(?:friend|colleague|coworker|teammate)\b/gi,
    /\b(my )?(?:assistant|secretary|agent)\b/gi,
    /\b(my )?(?:doctor|dentist|lawyer|accountant|contractor)\b/gi,
  ];

  for (const pattern of peoplePatterns) {
    const matches = query.match(pattern);
    if (matches) {
      entities.people.push(...matches.map((m) => m.trim()));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Relative Date References
  // ─────────────────────────────────────────────────────────────────────────

  const datePatterns = [
    /\btoday\b/gi,
    /\btomorrow\b/gi,
    /\byesterday\b/gi,
    /\bthis\s+(?:week|month|year)\b/gi,
    /\bnext\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\blast\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // 1/15 or 1/15/2024
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi, // Jan 15
  ];

  for (const pattern of datePatterns) {
    const matches = query.match(pattern);
    if (matches) {
      entities.dates.push(...matches.map((m) => m.trim()));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Time References
  // ─────────────────────────────────────────────────────────────────────────

  const timePatterns = [
    /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, // 3:30pm, 14:30
    /\b\d{1,2}\s*(?:am|pm)\b/gi, // 3pm
    /\bnoon\b/gi,
    /\bmidnight\b/gi,
    /\bin\s+\d+\s+(?:minutes?|hours?|days?)\b/gi, // in 30 minutes
    /\b(?:this\s+)?(?:morning|afternoon|evening|night)\b/gi,
  ];

  for (const pattern of timePatterns) {
    const matches = query.match(pattern);
    if (matches) {
      entities.times.push(...matches.map((m) => m.trim()));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pronouns and References
  // ─────────────────────────────────────────────────────────────────────────

  const referencePatterns = [
    /\b(?:him|her|them|they|he|she)\b/gi,
    /\b(?:that|those|these|this)\s+(?:message|email|person|meeting|event|task)\b/gi,
    /\bthe\s+(?:last|previous|recent)\s+(?:message|email|conversation)\b/gi,
    /\bit\b/gi,
  ];

  for (const pattern of referencePatterns) {
    const matches = query.match(pattern);
    if (matches) {
      entities.references.push(...matches.map((m) => m.trim()));
    }
  }

  // Remove duplicates
  entities.people = [...new Set(entities.people)];
  entities.dates = [...new Set(entities.dates)];
  entities.times = [...new Set(entities.times)];
  entities.references = [...new Set(entities.references)];

  return entities;
}

/**
 * Check if query has entities that need resolution
 * @param entities - Extracted entities
 * @returns True if there are entities to resolve
 */
export function hasEntitiesToResolve(entities: ExtractedEntities): boolean {
  return (
    entities.people.length > 0 ||
    entities.dates.length > 0 ||
    entities.times.length > 0 ||
    entities.references.length > 0
  );
}

/**
 * Get cache keys for entities
 * @param userId - User ID
 * @param entities - Extracted entities
 * @returns Array of cache key objects
 */
export function getEntityCacheKeys(
  userId: string,
  entities: ExtractedEntities
): EntityCacheKey[] {
  const keys: EntityCacheKey[] = [];

  for (const person of entities.people) {
    keys.push({
      type: 'person',
      value: person,
      cacheKey: `${userId}:person:${person.toLowerCase().trim()}`,
    });
  }

  for (const date of entities.dates) {
    keys.push({
      type: 'date',
      value: date,
      cacheKey: `${userId}:date:${date.toLowerCase().trim()}`,
    });
  }

  for (const time of entities.times) {
    keys.push({
      type: 'time',
      value: time,
      cacheKey: `${userId}:time:${time.toLowerCase().trim()}`,
    });
  }

  return keys;
}

/**
 * Resolve entities with caching
 * @param query - User query
 * @param userId - User ID
 * @param entityCache - Entity cache instance
 * @param llmResolver - Function to resolve uncached entities via LLM
 * @returns Resolved entities with cache statistics
 */
export async function resolveEntitiesWithCache(
  query: string,
  userId: string,
  entityCache: EntityCache,
  llmResolver: (uncached: UncachedEntities) => Promise<LLMResolutions>
): Promise<ResolvedEntitiesResult> {
  // Step 1: Extract entities using regex
  const extractedEntities = extractEntitiesRegex(query);

  // If no entities to resolve, skip
  if (!hasEntitiesToResolve(extractedEntities)) {
    return {
      entities: {},
      allCached: true,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  // Step 2: Check cache for each entity
  const resolvedEntities: Record<string, unknown> = {};
  const uncachedEntities: UncachedEntities = {
    people: [],
    dates: [],
    times: [],
  };

  let cacheHits = 0;
  let cacheMisses = 0;

  // Check people
  for (const person of extractedEntities.people) {
    const cached = entityCache.getEntity(userId, 'person', person);
    if (cached) {
      resolvedEntities[person] = cached;
      cacheHits++;
      // Cache hit for person entity
    } else {
      uncachedEntities.people.push(person);
      cacheMisses++;
    }
  }

  // Check dates
  for (const date of extractedEntities.dates) {
    const cached = entityCache.getEntity(userId, 'date', date);
    if (cached) {
      resolvedEntities[date] = cached;
      cacheHits++;
      // Cache hit for date entity
    } else {
      uncachedEntities.dates.push(date);
      cacheMisses++;
    }
  }

  // Check times
  for (const time of extractedEntities.times) {
    const cached = entityCache.getEntity(userId, 'time', time);
    if (cached) {
      resolvedEntities[time] = cached;
      cacheHits++;
      // Cache hit for time entity
    } else {
      uncachedEntities.times.push(time);
      cacheMisses++;
    }
  }

  // Step 3: Resolve uncached entities via LLM if needed
  if (cacheMisses > 0) {
    // Calling LLM to resolve uncached entities

    const llmResolutions = await llmResolver(uncachedEntities);

    // Cache the new resolutions
    if (llmResolutions.people) {
      for (const [person, resolution] of Object.entries(llmResolutions.people)) {
        entityCache.cacheEntity(userId, 'person', person, resolution);
        resolvedEntities[person] = resolution;
      }
    }

    if (llmResolutions.dates) {
      for (const [date, resolution] of Object.entries(llmResolutions.dates)) {
        entityCache.cacheEntity(userId, 'date', date, resolution);
        resolvedEntities[date] = resolution;
      }
    }

    if (llmResolutions.times) {
      for (const [time, resolution] of Object.entries(llmResolutions.times)) {
        entityCache.cacheEntity(userId, 'time', time, resolution);
        resolvedEntities[time] = resolution;
      }
    }
  }

  // Entity resolution complete

  return {
    entities: resolvedEntities,
    allCached: cacheMisses === 0,
    cacheHits,
    cacheMisses,
  };
}
