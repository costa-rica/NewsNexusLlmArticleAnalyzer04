import * as fs from "fs";
import * as path from "path";

/**
 * Overrides console.log, console.error, console.warn, and console.info
 * to write output to both the console and a log file.
 *
 * The log file is overwritten on each run (not appended).
 */
export function initializeConsoleLogger(logFilePath: string = "microservice-output.log"): void {
  // Create write stream - 'w' flag overwrites file each time
  const logStream = fs.createWriteStream(logFilePath, { flags: 'w' });

  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  // Override console.log
  console.log = (...args: any[]) => {
    originalLog(...args);
    logStream.write(formatLogEntry('LOG', args) + '\n');
  };

  // Override console.error
  console.error = (...args: any[]) => {
    originalError(...args);
    logStream.write(formatLogEntry('ERROR', args) + '\n');
  };

  // Override console.warn
  console.warn = (...args: any[]) => {
    originalWarn(...args);
    logStream.write(formatLogEntry('WARN', args) + '\n');
  };

  // Override console.info
  console.info = (...args: any[]) => {
    originalInfo(...args);
    logStream.write(formatLogEntry('INFO', args) + '\n');
  };

  // Handle process exit to close the stream cleanly
  process.on('exit', () => {
    logStream.end();
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    const errorMsg = formatLogEntry('UNCAUGHT EXCEPTION', [error.stack || error.message]);
    logStream.write(errorMsg + '\n');
    logStream.end();
    originalError('Uncaught Exception:', error);
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = formatLogEntry('UNHANDLED REJECTION', [reason]);
    logStream.write(errorMsg + '\n');
    originalError('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  console.log(`Console logger initialized - writing to ${logFilePath}`);
}

/**
 * Format log entry with timestamp and level
 */
function formatLogEntry(level: string, args: any[]): string {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');

  return `[${timestamp}] [${level}] ${message}`;
}
