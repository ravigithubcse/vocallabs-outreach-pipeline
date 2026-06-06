// src/utils/outputManager.js
// Manages writing stage outputs to disk and reading them back as pipeline state

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../../output');

// Ensure output directory exists
await fs.mkdir(OUTPUT_DIR, { recursive: true });

const filePath = (name) => path.join(OUTPUT_DIR, `${name}.json`);

/**
 * Save stage output to a JSON file
 * @param {string} stageName
 * @param {any} data
 */
export const saveStageOutput = async (stageName, data) => {
  const fp = filePath(stageName);
  await fs.writeFile(fp, JSON.stringify(data, null, 2), 'utf-8');
  logger.info(`[OutputManager] Saved ${stageName} → ${fp}`);
};

/**
 * Load a previously saved stage output
 * @param {string} stageName
 * @returns {any | null}
 */
export const loadStageOutput = async (stageName) => {
  try {
    const raw = await fs.readFile(filePath(stageName), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Append a record to a JSONL (newline-delimited JSON) audit log
 * @param {string} filename
 * @param {object} record
 */
export const appendAuditLog = async (filename, record) => {
  const fp = path.join(OUTPUT_DIR, `${filename}.jsonl`);
  await fs.appendFile(fp, JSON.stringify(record) + '\n', 'utf-8');
};

/**
 * Save the full pipeline run summary
 * @param {object} summary
 */
export const savePipelineSummary = async (summary) => {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fp = path.join(OUTPUT_DIR, `run-summary-${ts}.json`);
  await fs.writeFile(fp, JSON.stringify(summary, null, 2), 'utf-8');
  logger.info(`[OutputManager] Pipeline summary saved → ${fp}`);
  return fp;
};
