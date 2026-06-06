// src/utils/httpClient.js
// Axios-based HTTP client with retry logic, rate limiting, and error normalization

import axios from 'axios';
import logger from './logger.js';

/**
 * Sleep for a given number of milliseconds
 * @param {number} ms
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalize API errors into consistent shape
 * @param {Error} err
 * @param {string} stage
 */
export const normalizeError = (err, stage) => {
  if (err.response) {
    // API responded with a non-2xx status
    const { status, data } = err.response;
    logger.error(`[${stage}] API error ${status}: ${JSON.stringify(data)}`);
    return {
      success: false,
      error: `HTTP ${status}`,
      detail: data?.message || data?.error || JSON.stringify(data),
    };
  } else if (err.request) {
    // Request made but no response received (network issue)
    logger.error(`[${stage}] No response received: ${err.message}`);
    return { success: false, error: 'NETWORK_ERROR', detail: err.message };
  } else {
    // Something else went wrong
    logger.error(`[${stage}] Unexpected error: ${err.message}`);
    return { success: false, error: 'UNKNOWN_ERROR', detail: err.message };
  }
};

/**
 * Make an API call with automatic retry on rate limit (429) or transient errors
 * @param {object} config     - Axios request config
 * @param {string} stage      - Stage name for logging
 * @param {number} retries    - Max retry attempts (default: 3)
 * @param {number} baseDelay  - Base delay in ms (default: 2000, doubles on each retry)
 */
export const apiCall = async (config, stage, retries = 3, baseDelay = 2000) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios(config);
      return response.data;
    } catch (err) {
      const isRateLimit = err.response?.status === 429;
      const isTransient = [502, 503, 504].includes(err.response?.status);

      if ((isRateLimit || isTransient) && attempt < retries) {
        const delay = baseDelay * attempt;
        logger.warn(
          `[${stage}] ${isRateLimit ? 'Rate limited' : 'Transient error'} — retrying in ${delay}ms (attempt ${attempt}/${retries})`
        );
        await sleep(delay);
        continue;
      }

      // Non-retryable or exhausted retries
      return normalizeError(err, stage);
    }
  }
};

/**
 * Create an Axios instance pre-configured with base URL and auth header
 * @param {string} baseURL
 * @param {string} authHeader  - e.g. 'Bearer token' or 'Token abc123'
 */
export const createClient = (baseURL, authHeader) =>
  axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    timeout: 30_000, // 30s timeout
  });
