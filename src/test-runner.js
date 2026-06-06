// src/test-runner.js
// ============================================================
// STAGE TESTER — Run individual stages with mock data
// to verify API connectivity before running the full pipeline.
//
// Usage:
//   node src/test-runner.js 1       → Test Stage 1 (Ocean.io)
//   node src/test-runner.js 2       → Test Stage 2 (Prospeo)
//   node src/test-runner.js 3       → Test Stage 3 (Eazyreach)
//   node src/test-runner.js 4       → Test Stage 4 (Brevo)
//   node src/test-runner.js all     → Test all stages sequentially
//   node src/test-runner.js health  → Check all API keys are present
// ============================================================

import 'dotenv/config';
import chalk from 'chalk';

// ─── Health Check ──────────────────────────────────────────────────────────────

const healthCheck = () => {
  console.log(chalk.cyan.bold('\n🔍  API Key Health Check\n'));

  const keys = {
    'OCEAN_API_KEY (Stage 1)': process.env.OCEAN_API_KEY,
    'PROSPEO_API_KEY (Stage 2)': process.env.PROSPEO_API_KEY,
    'EAZYREACH_API_KEY (Stage 3)': process.env.EAZYREACH_API_KEY,
    'BREVO_API_KEY (Stage 4)': process.env.BREVO_API_KEY,
    'SENDER_EMAIL': process.env.SENDER_EMAIL,
    'SENDER_NAME': process.env.SENDER_NAME,
  };

  let allGood = true;

  for (const [name, value] of Object.entries(keys)) {
    const isMissing = !value || value.startsWith('your_') || value.startsWith('you@');
    const status = isMissing ? chalk.red('❌  NOT SET') : chalk.green('✅  SET');
    const display = isMissing ? '' : chalk.dim(`(${value.substring(0, 8)}...)`);
    console.log(`  ${name.padEnd(32)} ${status} ${display}`);
    if (isMissing) allGood = false;
  }

  console.log();
  if (allGood) {
    console.log(chalk.green('  All keys configured. Ready to run.\n'));
  } else {
    console.log(chalk.yellow('  Fill in missing keys in your .env file before running.\n'));
  }
};

// ─── Stage Tests ───────────────────────────────────────────────────────────────

const testStage1 = async () => {
  console.log(chalk.cyan.bold('\n🧪  Testing Stage 1 — Ocean.io\n'));
  const { findLookalikes } = await import('./stages/stage1_ocean.js');
  const TEST_DOMAIN = 'stripe.com'; // Well-known domain for testing
  console.log(`  Seed domain: ${TEST_DOMAIN}\n`);
  const result = await findLookalikes(TEST_DOMAIN, 3);
  console.log(chalk.green(`\n  ✅ Stage 1 OK — Got ${result.length} lookalikes:`));
  result.forEach((c) => console.log(`     • ${c.name} (${c.domain})`));
  return result;
};

const testStage2 = async (domains) => {
  console.log(chalk.cyan.bold('\n🧪  Testing Stage 2 — Prospeo\n'));
  const { findDecisionMakers } = await import('./stages/stage2_prospeo.js');

  // Use provided domains or fall back to mock data
  const testCompanies = domains?.slice(0, 2) || [
    { name: 'Test Company', domain: 'hubspot.com' },
    { name: 'Another Company', domain: 'zendesk.com' },
  ];

  console.log(`  Testing with ${testCompanies.length} companies...\n`);
  const result = await findDecisionMakers(testCompanies, 2);
  console.log(chalk.green(`\n  ✅ Stage 2 OK — Got ${result.length} decision-makers:`));
  result.forEach((c) => console.log(`     • ${c.fullName} — ${c.title} @ ${c.companyName}`));
  return result;
};

const testStage3 = async (contacts) => {
  console.log(chalk.cyan.bold('\n🧪  Testing Stage 3 — Eazyreach\n'));
  const { resolveEmails } = await import('./stages/stage3_eazyreach.js');

  // Use provided contacts or mock 1 contact to minimize credit usage
  const testContacts = contacts?.slice(0, 1) || [
    {
      fullName: 'John Doe',
      firstName: 'John',
      title: 'CEO',
      companyName: 'Test Corp',
      companyDomain: 'testcorp.com',
      linkedInUrl: 'https://www.linkedin.com/in/johndoe',
    },
  ];

  console.log(`  Resolving ${testContacts.length} profile(s) (minimal to conserve credits)...\n`);
  const result = await resolveEmails(testContacts);
  console.log(chalk.green(`\n  ✅ Stage 3 OK — Got ${result.length} resolved emails:`));
  result.forEach((c) => console.log(`     • ${c.fullName} → ${c.email}`));
  return result;
};

const testStage4 = async (contacts) => {
  console.log(chalk.cyan.bold('\n🧪  Testing Stage 4 — Brevo\n'));
  const { sendOutreachEmails } = await import('./stages/stage4_brevo.js');

  // Use resolved contacts or send 1 test email to yourself
  const testContacts = contacts?.slice(0, 1) || [
    {
      fullName: 'Test Contact',
      firstName: 'Test',
      title: 'CEO',
      companyName: 'Test Corp',
      companyDomain: 'testcorp.com',
      email: process.env.SENDER_EMAIL, // Send test email to yourself
      emailVerified: true,
    },
  ];

  console.log(`  Sending ${testContacts.length} test email(s)...\n`);
  const result = await sendOutreachEmails(testContacts);
  console.log(chalk.green(`\n  ✅ Stage 4 OK — Sent: ${result.sent.length} | Failed: ${result.failed.length}`));
  result.sent.forEach((r) => console.log(`     • ${r.name} → ${r.to} (messageId: ${r.messageId})`));
  return result;
};

// ─── Main ──────────────────────────────────────────────────────────────────────

const arg = process.argv[2];

if (!arg) {
  console.log(chalk.yellow(`
Usage:
  node src/test-runner.js health    → Check API key configuration
  node src/test-runner.js 1         → Test Stage 1 (Ocean.io)
  node src/test-runner.js 2         → Test Stage 2 (Prospeo)
  node src/test-runner.js 3         → Test Stage 3 (Eazyreach)
  node src/test-runner.js 4         → Test Stage 4 (Brevo)
  node src/test-runner.js all       → Run all stages end-to-end (uses real credits)
`));
  process.exit(0);
}

try {
  if (arg === 'health') {
    healthCheck();
  } else if (arg === '1') {
    await testStage1();
  } else if (arg === '2') {
    await testStage2();
  } else if (arg === '3') {
    await testStage3();
  } else if (arg === '4') {
    await testStage4();
  } else if (arg === 'all') {
    console.log(chalk.bold('\n🚀  Running all stages end-to-end test...\n'));
    const lookalikes = await testStage1();
    const contacts = await testStage2(lookalikes);
    const enriched = await testStage3(contacts);
    await testStage4(enriched);
    console.log(chalk.green.bold('\n✅  All stages passed!\n'));
  } else {
    console.error(chalk.red(`Unknown argument: ${arg}`));
    process.exit(1);
  }
} catch (err) {
  console.error(chalk.red(`\n❌  Test failed: ${err.message}\n`));
  console.error(chalk.dim(err.stack));
  process.exit(1);
}
