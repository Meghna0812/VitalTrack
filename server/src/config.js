// One place that reads environment variables, so the rest of the code never
// touches process.env directly. Changing a setting = editing .env, not code.
//
// Locally the separate MYSQL_HOST/REDIS_HOST… values are used. Hosting providers usually
// hand you ONE connection URL instead, so MYSQL_URL / REDIS_URL win when they are set.
import 'dotenv/config';

const env = process.env;

function mysqlConfig() {
  // Cloud databases require an encrypted (TLS) connection; local MySQL doesn't.
  const ssl = env.MYSQL_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined;
  if (env.MYSQL_URL) {
    // mysql://user:password@host:4000/database
    const u = new URL(env.MYSQL_URL);
    return {
      host: u.hostname, port: Number(u.port || 3306),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.slice(1), ssl,
    };
  }
  return {
    host: env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(env.MYSQL_PORT ?? 3306),
    user: env.MYSQL_USER ?? 'vitaltrack',
    password: env.MYSQL_PASSWORD ?? 'vitaltrack',
    database: env.MYSQL_DATABASE ?? 'vitaltrack',
    ssl,
  };
}

function redisConfig() {
  // Required by BullMQ for workers: never give up retrying a Redis command.
  const base = { maxRetriesPerRequest: null };
  if (env.REDIS_URL) {
    // redis://user:password@host:6379   (rediss:// = encrypted)
    const u = new URL(env.REDIS_URL);
    return {
      ...base, host: u.hostname, port: Number(u.port || 6379),
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      tls: u.protocol === 'rediss:' ? {} : undefined,
    };
  }
  return { ...base, host: env.REDIS_HOST ?? '127.0.0.1', port: Number(env.REDIS_PORT ?? 6379) };
}

export const config = {
  production: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 4000),
  mysql: mysqlConfig(),
  redis: redisConfig(),
  deepseek: {
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  },
  // OAuth client ID from Google Cloud Console (optional – without it only username/password sign-in is offered)
  googleClientId: env.GOOGLE_CLIENT_ID ?? '',
  confidenceThreshold: Number(env.CONFIDENCE_THRESHOLD ?? 0.8),
  uploadDir: env.UPLOAD_DIR ?? new URL('../uploads/', import.meta.url).pathname,
  // Delete each uploaded PDF once it has been processed (privacy + works on hosts without a permanent disk).
  keepUploads: env.KEEP_UPLOADS === 'true',
  // Run the background worker inside the API process (for hosts where a separate worker costs extra).
  runWorker: env.RUN_WORKER === 'true',
  // Only needed when the frontend is served from a different address than the API (local dev with Vite).
  clientOrigin: env.CLIENT_ORIGIN ?? 'http://localhost:5173',
};
