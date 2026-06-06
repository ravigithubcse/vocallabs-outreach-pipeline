// src/utils/emailComposer.js
// Generates personalized outreach email copy for each contact.
// Personalization variables: firstName, title, companyName, companyDomain

/**
 * Compose a personalized cold outreach email for a single contact.
 *
 * The copy is designed to:
 * 1. Not read like a mass blast (first name + company in subject)
 * 2. Lead with a value statement, not a pitch
 * 3. End with a single, low-friction CTA
 * 4. Be short (3-4 short paragraphs max) — DMs don't read long emails
 *
 * @param {object} contact - Enriched contact object from Stage 3
 * @param {string} senderName - Sender's full name from .env
 * @returns {{ subject: string, htmlBody: string, textBody: string }}
 */
export const composeEmail = (contact, senderName) => {
  const { firstName, fullName, title, companyName, companyDomain } = contact;
  const name = firstName || fullName?.split(' ')[0] || 'there';
  const company = companyName || companyDomain;

  // Personalize the opening line based on their role
  const openingLine = getPersonalizedOpening(title, company);

  // Subject line — short, specific, avoids spam triggers
  const subject = `Quick question for ${company}`;

  // Plain-text version (always include for deliverability)
  const textBody = `Hi ${name},

${openingLine}

We've been working with companies like yours on one specific problem: getting qualified leads into the pipeline without burning your team on manual research or cold lists that go nowhere.

Most of the ${title ? title + 's' : 'leaders'} we talk to tell us the same thing — they know who they want to reach, but the process from "this looks like our customer" to "they're on a call" is broken. We built something to fix exactly that.

Worth a 15-minute chat this week to see if it's relevant for ${company}? Happy to send over a quick overview first if that helps.

Best,
${senderName}

--
Sent via Vocallabs Outreach Pipeline
`;

  // HTML version — simple, plain-styled for inbox friendliness
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333333; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>Hi ${name},</p>

  <p>${openingLine}</p>

  <p>
    We've been working with companies like yours on a specific problem: getting qualified leads into the pipeline 
    <em>without</em> burning your team on manual research or cold lists that go nowhere.
  </p>

  <p>
    Most of the ${title ? `<strong>${title}s</strong>` : 'leaders'} we talk to say the same thing — they know 
    who they want to reach, but the path from "this looks like our customer" to "they're on a call" 
    is broken. We built something to fix exactly that.
  </p>

  <p>
    Worth a quick 15-minute conversation this week to see if it's relevant for <strong>${company}</strong>?  
    Happy to send a brief overview first if that's easier.
  </p>

  <p>
    Best,<br>
    <strong>${senderName}</strong>
  </p>

  <hr style="border: none; border-top: 1px solid #eeeeee; margin-top: 30px;">
  <p style="font-size: 12px; color: #999999;">
    You're receiving this because your profile matches companies we work with in your space.<br>
    If this isn't relevant, just reply and I'll make sure you're not contacted again.
  </p>

</body>
</html>
`;

  return { subject, htmlBody, textBody };
};

/**
 * Generate a personalized opening line based on the contact's title
 * @param {string} title
 * @param {string} company
 */
const getPersonalizedOpening = (title, company) => {
  const t = (title || '').toLowerCase();

  if (t.includes('ceo') || t.includes('founder') || t.includes('president')) {
    return `Saw ${company} is doing interesting things in your space — reaching out directly because I think what we're building could genuinely move the needle for you.`;
  } else if (t.includes('cto') || t.includes('technical') || t.includes('engineering')) {
    return `Your engineering team's work on ${company}'s product caught my attention — reaching out because we solve a problem that usually lands in technical leaders' laps.`;
  } else if (t.includes('vp') || t.includes('vice president')) {
    return `Came across ${company} while looking at companies doing strong work in your vertical — wanted to reach out directly rather than go through a generic form.`;
  } else if (t.includes('director')) {
    return `Noticed ${company} has been making some solid moves recently — reaching out because we're working with Director-level folks in your space on a specific challenge.`;
  } else if (t.includes('marketing') || t.includes('growth') || t.includes('demand')) {
    return `${company}'s growth trajectory stood out to me — reaching out because what we're doing maps directly to what marketing and growth teams in your space are trying to solve.`;
  } else if (t.includes('sales') || t.includes('revenue') || t.includes('business')) {
    return `Reaching out because ${company} fits exactly the profile of companies we're helping grow their pipeline right now.`;
  } else {
    return `Came across ${company} and wanted to reach out directly — I think what we're building could be relevant for your team.`;
  }
};
