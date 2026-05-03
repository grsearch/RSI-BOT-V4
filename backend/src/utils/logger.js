import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.server.logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

export function child(name) {
  return logger.child({ module: name });
}
