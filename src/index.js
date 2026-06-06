// src/index.js
// ============================================================
// VOCALLABS OUTREACH PIPELINE
// Fully automated cold-outreach: one domain → emails sent.
// ============================================================
// Usage: node src/index.js
// ============================================================

import 'dotenv/config';
import ora from 'ora';
import chalk from 'chalk';
import Table from 'cli-table3';
import { createInterface } from 'readline';

import logger from './utils/logger.js';
import { savePipelineSummary } from './utils/outputManager.js';
import { findLookalikes } from './stages/stage1_ocean.js';
import { findDecisionMakers } from './stages/stage2_prospeo.js';
import { resolveEmails } from './stages/stage3_eazyreach.js';
import { sendOutreachEmails } from './stages/stage4_brevo.js';

// ─── ASCII Banner ──────────────────────────────────────────────────────────────

const printBanner = () => {
  console.log(chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════╗
║       VOCALLABS OUTREACH PIPELINE  v1.0               ║
║   Seed Domain → Lookalikes → Contacts → Emails        ║
╚═══════════════════════════════════════════════════════╝
`));
};

// ─── Config Validation ─────────────────────────────────────────────────────────

const validateConfig = () => {
  const required = [
    'OCEAN_API_KEY',
    'PROSPEO_API_KEY',
    'EAZYREACH_API_KEY',
    'BREVO_API_KEY',
    'SENDER_EMAIL',
    'SENDER_NAME',
  ];

  const missing = required.filter((k) => {
    const val = process.env[k];
    return !val || val.startsWith('your_') || val.startsWith('you@');
  });

  if (missing.length) {
    console.error(chalk.red('\n❌  Missing or unconfigured environment variables:'));
    missing.forEach((k) => console.error(chalk.red(`   • ${k}`)));
    console.error(chalk.yellow('\n   Copy .env.example → .env and fill in your API keys.\n'));
    process.exit(1);
  }

  logger.info('Configuration validated ✅');
};

// ─── CLI Input ─────────────────────────────────────────────────────────────────

const promptForDomain = () =>
  new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      chalk.bold('\n🌱  Enter the seed domain (e.g. stripe.com): '),
      (answer) => {
        rl.close();
        const domain = answer.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
        resolve(domain);
      }
    );
  });

// ─── Safety Checkpoint ─────────────────────────────────────────────────────────

/**
 * Show a summary table of contacts before actually sending emails.
 * Requires explicit confirmation — this is the safety gate.
 */
const safetyCheckpoint = async (contacts) => {
  console.log(chalk.yellow.bold('\n⚠️   SAFETY CHECKPOINT — Review before sending\n'));

  const table = new Table({
    head: [
      chalk.white('Name'),
      chalk.white('Title'),
      chalk.white('Company'),
      chalk.white('Email'),
    ],
    colWidths: [22, 26, 22, 30],
    style: { head: [], border: ['grey'] },
  });

  contacts.forEach((c) => {
    table.push([
      c.fullName || '—',
      (c.title || '—').substring(0, 24),
      (c.companyName || c.companyDomain || '—').substring(0, 20),
      c.email || '—',
    ]);
  });

  console.log(table.toString());
  console.log(
    chalk.cyan(`\n📧  ${contacts.length} email(s) will be sent from: ${process.env.SENDER_EMAIL}\n`)
  );

  const confirmed = await confirm(
    `Send outreach to all ${contacts.length} contacts above? (yes/no): `
  );

  if (!confirmed) {
    console.log(chalk.yellow('\n🛑  Aborted by user. No emails were sent.'));
    process.exit(0);
  }
};

const confirm = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.bold(question), (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === 'yes' || ans.trim().toLowerCase() === 'y');
    });
  });

// ─── Stage Runner ──────────────────────────────────────────────────────────────

const runStage = async (label, fn) => {
  const spinner = ora({ text: chalk.blue(label), spinner: 'dots' }).start();
  const startTime = Date.now();

  try {
    const result = await fn();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    spinner.succeed(chalk.green(`${label} — done (${elapsed}s)`));
    return result;
  } catch (err) {
    spinner.fail(chalk.red(`${label} — failed`));
    throw err;
  }
};

// ─── Pipeline Orchestrator ─────────────────────────────────────────────────────

const run = async () => {
  printBanner();

  // 1. Validate env config
  validateConfig();

  // 2. Get seed domain from user
  const seedDomain = await promptForDomain();
  if (!seedDomain) {
    console.error(chalk.red('❌  No domain entered. Exiting.'));
    process.exit(1);
  }

  const maxLookalikes = Number(process.env.MAX_LOOKALIKES) || 10;
  const maxProspectsPerCompany = Number(process.env.MAX_PROSPECTS_PER_COMPANY) || 3;

  console.log(chalk.dim(`\n  Seed: ${seedDomain}`));
  console.log(chalk.dim(`  Max lookalikes: ${maxLookalikes}`));
  console.log(chalk.dim(`  Max contacts/company: ${maxProspectsPerCompany}\n`));

  const pipelineStart = Date.now();

  try {
    // ── Stage 1: Ocean.io — Find lookalike companies ──────────────────────────
    const lookalikes = await runStage(
      `Stage 1/4 — Ocean.io: Finding lookalikes for ${seedDomain}`,
      () => findLookalikes(seedDomain, maxLookalikes)
    );

    if (!lookalikes.length) {
      console.error(chalk.red('\n❌  Stage 1 returned 0 lookalike companies. Cannot continue.'));
      process.exit(1);
    }

    printStageResult('Lookalike Companies', lookalikes.length, lookalikes.slice(0, 5).map(
      (c) => `${c.name} (${c.domain})`
    ));

    // ── Stage 2: Prospeo — Find decision-makers ───────────────────────────────
    const decisionMakers = await runStage(
      `Stage 2/4 — Prospeo: Finding decision-makers at ${lookalikes.length} companies`,
      () => findDecisionMakers(lookalikes, maxProspectsPerCompany)
    );

    if (!decisionMakers.length) {
      console.error(chalk.red('\n❌  Stage 2 found 0 decision-makers. Cannot continue.'));
      console.log(chalk.yellow('  Tip: Try a different seed domain or increase MAX_LOOKALIKES in .env'));
      process.exit(1);
    }

    printStageResult('Decision-Makers Found', decisionMakers.length, decisionMakers.slice(0, 5).map(
      (c) => `${c.fullName} — ${c.title} @ ${c.companyName}`
    ));

    // ── Stage 3: Eazyreach — Resolve emails ───────────────────────────────────
    const enrichedContacts = await runStage(
      `Stage 3/4 — Eazyreach: Resolving ${decisionMakers.length} LinkedIn profiles → emails`,
      () => resolveEmails(decisionMakers)
    );

    if (!enrichedContacts.length) {
      console.error(chalk.red('\n❌  Stage 3 resolved 0 emails. Cannot send any outreach.'));
      console.log(chalk.yellow('  Tip: Check your Eazyreach credits and API key.'));
      process.exit(1);
    }

    printStageResult('Emails Resolved', enrichedContacts.length, enrichedContacts.slice(0, 5).map(
      (c) => `${c.fullName} → ${c.email}`
    ));

    // ── Safety Checkpoint ─────────────────────────────────────────────────────
    await safetyCheckpoint(enrichedContacts);

    // ── Stage 4: Brevo — Send emails ──────────────────────────────────────────
    const sendResults = await runStage(
      `Stage 4/4 — Brevo: Sending ${enrichedContacts.length} personalized emails`,
      () => sendOutreachEmails(enrichedContacts)
    );

    // ── Final Summary ─────────────────────────────────────────────────────────
    const totalTime = ((Date.now() - pipelineStart) / 1000).toFixed(1);

    const summary = {
      seedDomain,
      runAt: new Date().toISOString(),
      durationSeconds: Number(totalTime),
      stages: {
        stage1_lookalikes: lookalikes.length,
        stage2_decisionMakers: decisionMakers.length,
        stage3_emailsResolved: enrichedContacts.length,
        stage4_emailsSent: sendResults.sent.length,
        stage4_emailsFailed: sendResults.failed.length,
      },
    };

    const summaryPath = await savePipelineSummary(summary);

    console.log(chalk.green.bold(`
╔═══════════════════════════════════════════════════════╗
║   ✅  PIPELINE COMPLETE                               ║
╚═══════════════════════════════════════════════════════╝
`));
    console.log(chalk.white(`  Seed domain      : ${seedDomain}`));
    console.log(chalk.white(`  Lookalikes found  : ${lookalikes.length}`));
    console.log(chalk.white(`  Decision-makers   : ${decisionMakers.length}`));
    console.log(chalk.white(`  Emails resolved   : ${enrichedContacts.length}`));
    console.log(chalk.green(`  Emails sent       : ${sendResults.sent.length}`));
    if (sendResults.failed.length) {
      console.log(chalk.red(`  Emails failed     : ${sendResults.failed.length}`));
    }
    console.log(chalk.dim(`  Total time        : ${totalTime}s`));
    console.log(chalk.dim(`  Summary saved     : ${summaryPath}\n`));

  } catch (err) {
    logger.error(`Pipeline failed: ${err.message}`);
    console.error(chalk.red(`\n❌  Pipeline error: ${err.message}\n`));
    console.error(chalk.dim('  Check logs/pipeline.log for details.'));
    process.exit(1);
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

const printStageResult = (label, count, samples) => {
  console.log(chalk.dim(`\n  ${chalk.cyan.bold(label)}: ${count}`));
  samples.forEach((s) => console.log(chalk.dim(`    • ${s}`)));
  if (count > samples.length) {
    console.log(chalk.dim(`    … and ${count - samples.length} more`));
  }
  console.log();
};

// ─── Entry Point ───────────────────────────────────────────────────────────────

run().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
