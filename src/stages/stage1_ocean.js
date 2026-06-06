// src/stages/stage1_ocean.js
// Stage 1: Ocean.io → Find lookalike companies from a seed domain
// API Docs: https://docs.ocean.io/

import logger from '../utils/logger.js';
import { apiCall, sleep } from '../utils/httpClient.js';
import { saveStageOutput } from '../utils/outputManager.js';

const OCEAN_BASE_URL = 'https://api.ocean.io/v1';
const STAGE = 'Stage1:Ocean.io';

/**
 * Fetch lookalike companies from Ocean.io given a seed domain.
 *
 * Ocean.io's similarity search finds companies with matching:
 * - Industry / vertical
 * - Employee count range
 * - Revenue range
 * - Technology stack
 *
 * @param {string} seedDomain   - e.g. "stripe.com"
 * @param {number} limit        - Max lookalikes to return
 * @returns {Promise<string[]>} - Array of company domains
 */
export const findLookalikes = async (seedDomain, limit = 10) => {
  logger.info(`[${STAGE}] Searching lookalikes for seed domain: ${seedDomain}`);

  const apiKey = process.env.OCEAN_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new Error(`[${STAGE}] OCEAN_API_KEY is not configured in .env`);
  }

  // --- Step 1: Resolve seed domain to Ocean.io company ID ---
  logger.info(`[${STAGE}] Resolving seed domain to company record...`);

  const searchPayload = {
    filters: {
      website_domains: [seedDomain],
    },
    fields: ['id', 'name', 'website', 'employee_count', 'industry'],
    page: { size: 1 },
  };

  const searchResult = await apiCall(
    {
      method: 'POST',
      url: `${OCEAN_BASE_URL}/companies/search`,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      data: searchPayload,
    },
    STAGE
  );

  if (searchResult?.error) {
    throw new Error(`[${STAGE}] Failed to resolve seed domain: ${searchResult.detail}`);
  }

  const seedCompanies = searchResult?.data || searchResult?.companies || searchResult?.results || [];

  if (!seedCompanies.length) {
    logger.warn(`[${STAGE}] No company found for domain "${seedDomain}" in Ocean.io`);
    throw new Error(`[${STAGE}] Domain "${seedDomain}" not found in Ocean.io database. Try a well-known company domain.`);
  }

  const seedCompany = seedCompanies[0];
  logger.info(`[${STAGE}] Found seed: ${seedCompany.name || seedDomain} (ID: ${seedCompany.id})`);

  // --- Step 2: Find lookalike companies ---
  await sleep(Number(process.env.API_DELAY_MS) || 1000);

  logger.info(`[${STAGE}] Fetching up to ${limit} lookalike companies...`);

  const lookalikesResult = await apiCall(
    {
      method: 'GET',
      url: `${OCEAN_BASE_URL}/companies/${seedCompany.id}/lookalikes`,
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      params: {
        limit: Math.min(limit, 25), // Ocean.io max per request
        fields: 'id,name,website,employee_count,industry,country',
      },
    },
    STAGE
  );

  if (lookalikesResult?.error) {
    throw new Error(`[${STAGE}] Lookalike fetch failed: ${lookalikesResult.detail}`);
  }

  // Normalize response — Ocean.io returns data in different shapes depending on plan
  const rawCompanies =
    lookalikesResult?.data ||
    lookalikesResult?.companies ||
    lookalikesResult?.lookalikes ||
    lookalikesResult?.results ||
    [];

  if (!rawCompanies.length) {
    logger.warn(`[${STAGE}] No lookalikes returned for ${seedDomain}`);
    return [];
  }

  // Extract clean domain list, filtering out seed itself
  const lookalikeDomains = rawCompanies
    .map((c) => ({
      name: c.name || 'Unknown',
      domain: extractDomain(c.website || c.domain || ''),
      industry: c.industry || 'N/A',
      employeeCount: c.employee_count || 'N/A',
      country: c.country || 'N/A',
      oceanId: c.id,
    }))
    .filter((c) => c.domain && c.domain !== seedDomain)
    .slice(0, limit);

  logger.info(`[${STAGE}] ✅ Found ${lookalikeDomains.length} lookalike companies`);

  // Persist output for next stage
  const output = {
    seedDomain,
    seedCompany: {
      name: seedCompany.name,
      id: seedCompany.id,
    },
    lookalikes: lookalikeDomains,
    fetchedAt: new Date().toISOString(),
  };

  await saveStageOutput('stage1_lookalikes', output);

  return lookalikeDomains;
};

/**
 * Extract clean domain from a URL or domain string
 * @param {string} raw
 */
const extractDomain = (raw) => {
  if (!raw) return '';
  try {
    // Handle URLs with protocol
    const url = raw.startsWith('http') ? new URL(raw) : new URL(`https://${raw}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // Fallback: strip www. and trailing slashes
    return raw.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').toLowerCase().trim();
  }
};
