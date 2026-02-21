/**
 * Retry Utility for API Calls
 * Provides exponential backoff retry logic for LLM and integration API calls
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelay?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelay?: number;
  /** Function to determine if error should be retried */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * Call a function with retry logic and exponential backoff
 * @param fn - Async function to call
 * @param options - Retry options
 * @returns Result from function
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    shouldRetry = defaultShouldRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry if this is the last attempt
      if (attempt === maxRetries - 1) {
        break;
      }

      // Check if we should retry this error
      if (!shouldRetry(lastError, attempt)) {
        throw lastError;
      }

      // Calculate backoff delay with exponential increase and jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
      const delay = exponentialDelay + jitter;

      // Retrying after delay with exponential backoff

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Default function to determine if an error should be retried
 * @param error - The error that occurred
 * @param attempt - Current attempt number (0-indexed)
 * @returns True if should retry
 */
export function defaultShouldRetry(error: Error, attempt: number): boolean {
  // Retry on network errors
  if (error.message?.includes('fetch') || error.message?.includes('network')) {
    return true;
  }

  // Check for HTTP status codes in error message
  const statusMatch = error.message?.match(/HTTP (\d+)/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10);

    // Retry on rate limits (429)
    if (status === 429) {
      return true;
    }

    // Retry on server errors (5xx)
    if (status >= 500 && status < 600) {
      return true;
    }

    // Don't retry on client errors (4xx except 429)
    if (status >= 400 && status < 500) {
      return false;
    }
  }

  // Default: retry on first attempt, be more conservative after
  return attempt === 0;
}

/**
 * Call LLM API with retry logic
 * Specialized wrapper for LLM API calls
 * @param apiCallFn - Async function that makes the API call
 * @param options - Retry options
 * @returns API response
 */
export async function callLLMWithRetry<T>(
  apiCallFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return callWithRetry(apiCallFn, {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    shouldRetry: (error: Error, attempt: number): boolean => {
      // Parse HTTP status from error if available
      const statusMatch = error.message?.match(/(\d{3})/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : null;

      // Always retry on rate limits
      if (status === 429) {
        return true;
      }

      // Retry on server errors
      if (status !== null && status >= 500) {
        return true;
      }

      // Retry on network errors
      if (
        error.message?.includes('fetch') ||
        error.message?.includes('network') ||
        error.message?.includes('ECONNRESET') ||
        error.message?.includes('ETIMEDOUT')
      ) {
        return true;
      }

      // Don't retry on client errors (except 429)
      if (status !== null && status >= 400 && status < 500) {
        return false;
      }

      // Default: retry once for unknown errors
      return attempt === 0;
    },
    ...options,
  });
}
