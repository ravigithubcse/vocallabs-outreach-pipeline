// src/stages/stage3_eazyreach.js
// Stage 3: Eazyreach → Resolve LinkedIn URLs to verified work email addresses
// API Docs: https://eazyreach.app (check in-app API documentation)

import logger from '../utils/logger.js';
import { apiCall, sleep } from '../utils/httpClient.js';
import { saveStageOutput, appendAuditLog } from '../utils/outputManager.js';

const EAZYREACH_BASE_URL = 'https://api.eazyreach.app/v1';
const STAGE = 'Stage3:Eazyreach';

/**
 * Resolve LinkedIn profile URLs to verified work email addresses.
 *
 * Eazyreach uses LinkedIn profile data to find the person's
 * real, deliverable work email. Credits are consumed per lookup.
 *
 * @param {Array<object>} contacts - Contacts with linkedInUrl field
 * @returns {Promise<Array<object>>} - Contacts enriched with email field
 */
export const resolveEmails = async (contacts) => {
  logger.info(`[${STAGE}] Resolving emails for ${contacts.length} LinkedIn profiles...`);

  const apiKey = process.env.EAZYREACH_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new Error(`[${STAGE}] EAZYREACH_API_KEY is not configured in .env`);
  }

  // --- Check credit balance before consuming them ---
  await checkCreditBalance(apiKey);

  const enrichedContacts = [];
  const failed = [];
  const delay = Number(process.env.API_DELAY_MS) || 1000;

  for (const contact of contacts) {
    try {
      logger.info(`[${STAGE}] Resolving: ${contact.fullName} @ ${contact.companyDomain}`);

      const email = await resolveEmailForLinkedIn(contact.linkedInUrl, apiKey);

      if (email) {
        const enriched = { ...contact, email, emailVerified: true };
        enrichedContacts.push(enriched);
        logger.info(`[${STAGE}]   → ✅ ${email}`);

        // Audit every successful resolution
        await appendAuditLog('email_resolutions', {
          name: contact.fullName,
          domain: contact.companyDomain,
          linkedIn: contact.linkedInUrl,
          email,
          resolvedAt: new Date().toISOString(),
        });
      } else {
        logger.warn(`[${STAGE}]   → ❌ No email resolved for ${contact.fullName}`);
        failed.push({ ...contact, emailVerified: false, email: null });
      }

      await sleep(delay); // Respect rate limits & credit conservation
    } catch (err) {
      logger.error(`[${STAGE}] Error resolving ${contact.fullName}: ${err.message}`);
      failed.push({ ...contact, emailVerified: false, email: null, error: err.message });
    }
  }

  logger.info(
    `[${STAGE}] ✅ Resolved: ${enrichedContacts.length} | Failed: ${failed.length}`
  );

  // Persist full results (including failed, for reporting)
  const output = {
    resolved: enrichedContacts.length,
    failed: failed.length,
    contacts: enrichedContacts,
    skipped: failed,
    fetchedAt: new Date().toISOString(),
  };

  await saveStageOutput('stage3_emails', output);

  if (!enrichedContacts.length) {
    logger.warn(
      `[${STAGE}] Zero emails resolved. Check your Eazyreach credits and API key.`
    );
  }

  return enrichedContacts;
};

/**
 * Resolve a single LinkedIn URL to a verified email via Eazyreach API
 * @param {string} linkedInUrl
 * @param {string} apiKey
 * @returns {Promise<string|null>}
 */
const resolveEmailForLinkedIn = async (linkedInUrl, apiKey) => {
  const result = await apiCall(
    {
      method: 'POST',
      url: `${EAZYREACH_BASE_URL}/find-email`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      data: {
        linkedin_url: linkedInUrl,
        // Some plans support these enrichment flags
        verify_email: true,
        include_professional: true,
      },
    },
    STAGE
  );

  if (result?.error) {
    logger.warn(`[${STAGE}] API error for ${linkedInUrl}: ${result.detail}`);
    return null;
  }

  // Normalize Eazyreach response — may vary by API version
  const email =
    result?.email ||
    result?.data?.email ||
    result?.professional_email ||
    result?.work_email ||
    result?.emails?.[0]?.email ||
    null;

  // Basic email format validation
  if (email && isValidEmail(email)) {
    return email.toLowerCase().trim();
  }

  return null;
};

/**
 * Check remaining Eazyreach credits before starting bulk resolution
 * @param {string} apiKey
 */
const checkCreditBalance = async (apiKey) => {
  try {
    const result = await apiCall(
      {
        method: 'GET',
        url: `${EAZYREACH_BASE_URL}/credits`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
      STAGE
    );

    const credits =
      result?.credits ||
      result?.remaining ||
      result?.balance ||
      result?.data?.credits;

    if (credits !== undefined) {
      logger.info(`[${STAGE}] Available Eazyreach credits: ${credits}`);
      if (Number(credits) === 0) {
        throw new Error(
          `[${STAGE}] Zero Eazyreach credits remaining. Contact Vocallabs team for a top-up.`
        );
      }
    }
  } catch (err) {
    // Non-fatal — credit check may not be supported on all plans
    logger.warn(`[${STAGE}] Could not fetch credit balance: ${err.message}`);
  }
};

/**
 * Validate email format
 * @param {string} email
 */
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};
