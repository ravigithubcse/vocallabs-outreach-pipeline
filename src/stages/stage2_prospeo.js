// src/stages/stage2_prospeo.js
// Stage 2: Prospeo → Find C-suite / VP decision-makers + LinkedIn URLs per domain
// API Docs: https://app.prospeo.io/api

import logger from '../utils/logger.js';
import { apiCall, sleep } from '../utils/httpClient.js';
import { saveStageOutput } from '../utils/outputManager.js';

const PROSPEO_BASE_URL = 'https://api.prospeo.io';
const STAGE = 'Stage2:Prospeo';

// Decision-maker seniority levels we target
const TARGET_SENIORITIES = [
  'C_LEVEL', 'CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CPO', 'FOUNDER',
  'CO_FOUNDER', 'VP', 'VICE_PRESIDENT', 'DIRECTOR', 'HEAD',
];

// Titles we DON'T want (to filter noise)
const EXCLUDED_TITLE_PATTERNS = [
  /intern/i, /assistant/i, /junior/i, /trainee/i, /student/i,
];

/**
 * Find decision-makers at each company using Prospeo's domain search.
 *
 * @param {Array<{domain: string, name: string}>} companies
 * @param {number} maxPerCompany - Max contacts to pull per company
 * @returns {Promise<Array>} - Contacts with LinkedIn URLs
 */
export const findDecisionMakers = async (companies, maxPerCompany = 3) => {
  logger.info(`[${STAGE}] Finding decision-makers for ${companies.length} companies...`);

  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new Error(`[${STAGE}] PROSPEO_API_KEY is not configured in .env`);
  }

  const allContacts = [];
  const delay = Number(process.env.API_DELAY_MS) || 1000;

  for (const company of companies) {
    try {
      logger.info(`[${STAGE}] Processing: ${company.name} (${company.domain})`);

      const contacts = await fetchProspectsForDomain(company.domain, apiKey, maxPerCompany);

      if (!contacts.length) {
        logger.warn(`[${STAGE}]   → No decision-makers found for ${company.domain}`);
      } else {
        logger.info(`[${STAGE}]   → Found ${contacts.length} contacts at ${company.name}`);
        allContacts.push(
          ...contacts.map((c) => ({
            ...c,
            companyName: company.name,
            companyDomain: company.domain,
          }))
        );
      }

      await sleep(delay); // Respect Prospeo rate limits
    } catch (err) {
      logger.error(`[${STAGE}] Failed to process ${company.domain}: ${err.message}`);
      // Don't crash — continue with remaining companies
    }
  }

  logger.info(`[${STAGE}] ✅ Total decision-makers found: ${allContacts.length}`);

  // Deduplicate by LinkedIn URL
  const deduplicated = deduplicateByLinkedIn(allContacts);
  logger.info(`[${STAGE}] After deduplication: ${deduplicated.length} unique contacts`);

  // Persist for next stage
  const output = {
    totalContacts: deduplicated.length,
    contacts: deduplicated,
    fetchedAt: new Date().toISOString(),
  };

  await saveStageOutput('stage2_prospects', output);

  return deduplicated;
};

/**
 * Fetch prospects for a single domain via Prospeo API
 * @param {string} domain
 * @param {string} apiKey
 * @param {number} limit
 */
const fetchProspectsForDomain = async (domain, apiKey, limit) => {
  // Prospeo domain search endpoint
  const result = await apiCall(
    {
      method: 'POST',
      url: `${PROSPEO_BASE_URL}/domain-search`,
      headers: {
        'Content-Type': 'application/json',
        'X-KEY': apiKey,
      },
      data: {
        company: domain,
        limit: Math.min(limit * 4, 20), // Fetch more, then filter to target seniority
        type: 'PROFESSIONAL', // Only professional contacts
      },
    },
    STAGE
  );

  if (result?.error) {
    logger.warn(`[${STAGE}] Prospeo error for ${domain}: ${result.detail}`);
    return [];
  }

  // Normalize Prospeo's response format
  const rawContacts =
    result?.contacts ||
    result?.data?.contacts ||
    result?.people ||
    result?.response?.contacts ||
    [];

  // Filter to decision-maker titles and validate LinkedIn presence
  const filtered = rawContacts
    .filter((c) => isDecisionMaker(c))
    .filter((c) => {
      const linkedIn = extractLinkedIn(c);
      return !!linkedIn; // Must have a LinkedIn URL for Stage 3
    })
    .slice(0, limit)
    .map((c) => ({
      firstName: c.first_name || c.firstName || '',
      lastName: c.last_name || c.lastName || '',
      fullName: c.full_name || c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
      title: c.title || c.job_title || c.position || '',
      linkedInUrl: extractLinkedIn(c),
      seniority: c.seniority || 'UNKNOWN',
      location: c.location || c.city || '',
    }));

  return filtered;
};

/**
 * Determine if a contact qualifies as a decision-maker
 * @param {object} contact
 */
const isDecisionMaker = (contact) => {
  const title = (contact.title || contact.job_title || contact.position || '').toUpperCase();
  const seniority = (contact.seniority || '').toUpperCase();

  // Check seniority field
  const seniorityMatch = TARGET_SENIORITIES.some((s) => seniority.includes(s));

  // Check title field for common DM keywords
  const titleMatch =
    /\b(CEO|CTO|CFO|COO|CMO|CPO|FOUNDER|VP|VICE PRES|DIRECTOR|HEAD|PRESIDENT|OWNER|PARTNER|PRINCIPAL)\b/i.test(
      title
    );

  // Filter out explicitly excluded titles
  const excluded = EXCLUDED_TITLE_PATTERNS.some((p) => p.test(title));

  return (seniorityMatch || titleMatch) && !excluded;
};

/**
 * Extract LinkedIn URL from a Prospeo contact object
 * @param {object} contact
 */
const extractLinkedIn = (contact) => {
  const raw =
    contact.linkedin_url ||
    contact.linkedinUrl ||
    contact.linkedin ||
    contact.profile_url ||
    '';
  if (!raw) return null;

  // Normalize to standard linkedin.com format
  if (raw.includes('linkedin.com')) return raw;
  return `https://www.linkedin.com/in/${raw}`;
};

/**
 * Remove duplicate contacts by LinkedIn URL
 * @param {Array} contacts
 */
const deduplicateByLinkedIn = (contacts) => {
  const seen = new Set();
  return contacts.filter((c) => {
    if (seen.has(c.linkedInUrl)) return false;
    seen.add(c.linkedInUrl);
    return true;
  });
};
