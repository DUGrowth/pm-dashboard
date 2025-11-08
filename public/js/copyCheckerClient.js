const ENDPOINT = '/api/copy-check';

async function requestCopyCheck(payload) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = await response.json();
      detail = typeof errorBody?.error === 'string' ? `: ${errorBody.error}` : '';
    } catch {
      // ignore
    }
    throw new Error(`Copy checker request failed (${response.status})${detail}`);
  }
  return response.json();
}

/**
 * Run the copy checker against the serverless endpoint.
 * @param {Object} params
 * @param {string} params.text
 * @param {string} params.platform
 * @param {string} params.assetType
 * @param {{ maxChars: number, maxHashtags?: number, requireCTA?: boolean }} params.constraints
 * @param {{ bannedWords: string[], requiredPhrases: string[], tone: { confident: number, compassionate: number, evidenceLed: number } }} params.brand
 * @param {string=} params.readingLevelTarget
 */
export async function runCopyCheck(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('runCopyCheck requires a params object');
  }
  return requestCopyCheck(params);
}

// Optionally expose a safe global for non-module scripts
try {
  if (typeof window !== 'undefined') {
    window.copyChecker = Object.freeze({
      ...(window.copyChecker || {}),
      runCopyCheck,
    });
  }
} catch {/* noop */}
