// src/stages/stage4_brevo.js
// Stage 4: Brevo → Send personalized outreach emails to each verified contact
// API Docs: https://developers.brevo.com/reference/sendtransacemail

import logger from '../utils/logger.js';
import { apiCall, sleep } from '../utils/httpClient.js';
import { saveStageOutput, appendAuditLog } from '../utils/outputManager.js';
import { composeEmail } from '../utils/emailComposer.js';

const BREVO_BASE_URL = 'https://api.brevo.com/v3';
const STAGE = 'Stage4:Brevo';

/**
 * Send personalized outreach emails to all enriched contacts via Brevo.
 *
 * @param {Array<object>} contacts - Contacts with verified email addresses
 * @returns {Promise<object>} - Send summary
 */
export const sendOutreachEmails = async (contacts) => {
  logger.info(`[${STAGE}] Preparing to send ${contacts.length} personalized emails...`);

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey || apiKey.startsWith('your_')) {
    throw new Error(`[${STAGE}] BREVO_API_KEY is not configured in .env`);
  }

  const senderEmail = process.env.SENDER_EMAIL;
  const senderName = process.env.SENDER_NAME || 'Outreach Team';

  if (!senderEmail || senderEmail.startsWith('you@')) {
    throw new Error(`[${STAGE}] SENDER_EMAIL is not configured in .env`);
  }

  // --- Verify sender identity is set up in Brevo ---
  await verifySenderIdentity(apiKey, senderEmail);

  const results = {
    sent: [],
    failed: [],
  };

  const delay = Number(process.env.API_DELAY_MS) || 1000;

  for (const contact of contacts) {
    try {
      const { subject, htmlBody, textBody } = composeEmail(contact, senderName);

      logger.info(`[${STAGE}] Sending → ${contact.fullName} <${contact.email}>`);

      const result = await sendSingleEmail(
        { subject, htmlBody, textBody },
        contact,
        senderEmail,
        senderName,
        apiKey
      );

      if (result.success) {
        results.sent.push({
          to: contact.email,
          name: contact.fullName,
          company: contact.companyName,
          messageId: result.messageId,
          sentAt: new Date().toISOString(),
        });

        logger.info(`[${STAGE}]   → ✅ Sent (messageId: ${result.messageId})`);

        await appendAuditLog('emails_sent', {
          recipient: contact.email,
          name: contact.fullName,
          company: contact.companyName,
          subject,
          messageId: result.messageId,
          sentAt: new Date().toISOString(),
        });
      } else {
        results.failed.push({
          to: contact.email,
          name: contact.fullName,
          error: result.error,
        });
        logger.warn(`[${STAGE}]   → ❌ Failed: ${result.error}`);
      }

      await sleep(delay); // Brevo free tier: ~300 emails/day, no burst rate limit issues
    } catch (err) {
      logger.error(`[${STAGE}] Error sending to ${contact.email}: ${err.message}`);
      results.failed.push({ to: contact.email, name: contact.fullName, error: err.message });
    }
  }

  logger.info(
    `[${STAGE}] ✅ Done — Sent: ${results.sent.length} | Failed: ${results.failed.length}`
  );

  await saveStageOutput('stage4_sent', results);

  return results;
};

/**
 * Send a single transactional email via Brevo API
 * @param {{ subject, htmlBody, textBody }} emailContent
 * @param {object} contact
 * @param {string} senderEmail
 * @param {string} senderName
 * @param {string} apiKey
 */
const sendSingleEmail = async (emailContent, contact, senderEmail, senderName, apiKey) => {
  const payload = {
    sender: {
      email: senderEmail,
      name: senderName,
    },
    to: [
      {
        email: contact.email,
        name: contact.fullName,
      },
    ],
    subject: emailContent.subject,
    htmlContent: emailContent.htmlBody,
    textContent: emailContent.textBody,
    // Headers for better deliverability
    headers: {
      'X-Pipeline': 'vocallabs-outreach',
      'X-Contact-Company': contact.companyDomain || '',
    },
  };

  const result = await apiCall(
    {
      method: 'POST',
      url: `${BREVO_BASE_URL}/smtp/email`,
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: payload,
    },
    STAGE
  );

  if (result?.error) {
    return { success: false, error: result.detail };
  }

  // Brevo returns { messageId: '...' } on success
  const messageId = result?.messageId || result?.message_id || 'unknown';
  return { success: true, messageId };
};

/**
 * Verify that the sender email identity is set up in Brevo
 * (Brevo requires sender verification before you can send)
 * @param {string} apiKey
 * @param {string} senderEmail
 */
const verifySenderIdentity = async (apiKey, senderEmail) => {
  try {
    const result = await apiCall(
      {
        method: 'GET',
        url: `${BREVO_BASE_URL}/senders`,
        headers: {
          'api-key': apiKey,
          Accept: 'application/json',
        },
      },
      STAGE
    );

    if (result?.error) {
      logger.warn(`[${STAGE}] Could not verify sender identity: ${result.detail}`);
      return;
    }

    const senders = result?.senders || [];
    const verified = senders.some(
      (s) => s.email?.toLowerCase() === senderEmail.toLowerCase() && s.active === true
    );

    if (!verified) {
      logger.warn(
        `[${STAGE}] ⚠️  Sender "${senderEmail}" may not be verified in Brevo.\n` +
          `  → Go to app.brevo.com → Senders & IP → Senders → Add a Sender.\n` +
          `  → Emails will fail if the sender is not verified.`
      );
    } else {
      logger.info(`[${STAGE}] Sender identity verified: ${senderEmail}`);
    }
  } catch (err) {
    logger.warn(`[${STAGE}] Sender verification skipped: ${err.message}`);
  }
};
