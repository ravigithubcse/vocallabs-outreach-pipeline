// src/utils/logger.js
// Centralized structured logger for the pipeline

import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(__dirname, '../../logs');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level}]: ${stack || message}`;
});

// Custom format for file output (JSON for easy parsing)
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    // Console transport — human-readable
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        errors({ stack: true }),
        consoleFormat
      ),
    }),
    // File transport — full JSON log for debugging
    new winston.transports.File({
      filename: path.join(logDir, 'pipeline.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
    }),
    // Separate error log
    new winston.transports.File({
      filename: path.join(logDir, 'errors.log'),
      level: 'error',
      format: fileFormat,
    }),
  ],
});

export default logger;
