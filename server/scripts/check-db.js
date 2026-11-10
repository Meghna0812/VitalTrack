// Diagnose a database connection without revealing the password.
//
//   MYSQL_URL='mysql://USER:PASSWORD@HOST:4000/vitaltrack' MYSQL_SSL=true node scripts/check-db.js
//
// Prints what the app will actually use (host, port, user, database, password length),
// warns about common mistakes, then tries to connect and explains any error.
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';

const c = config.mysql;
const raw = process.env.MYSQL_URL;

console.log('Source  :', raw ? 'MYSQL_URL' : 'MYSQL_HOST / MYSQL_USER / … (from .env or the environment)');
console.log('Host    :', c.host);
console.log('Port    :', c.port);
console.log('User    :', c.user);
console.log('Database:', c.database);
console.log('Password:', c.password ? `${c.password.length} characters` : '(empty!)');
console.log('TLS     :', c.ssl ? 'on' : 'off');
console.log();

// Common mistakes, checked before connecting
const warnings = [];
if (!raw && ['127.0.0.1', 'localhost'].includes(c.host)) warnings.push('This is your LOCAL database (127.0.0.1), not the cloud one.');
if (raw && !raw.startsWith('mysql://')) warnings.push('The URL must start with mysql://');
if (c.host.includes('tidbcloud.com') && !c.user.includes('.')) {
  warnings.push(`TiDB users look like "3xAbCdEf123.root" (prefix + ".root"). "${c.user}" has no prefix.`);
}
if (c.host.includes('tidbcloud.com') && c.port !== 4000) warnings.push(`TiDB uses port 4000, not ${c.port}.`);
if (c.host.includes('tidbcloud.com') && !c.ssl) warnings.push('TiDB requires MYSQL_SSL=true.');
if (raw) {
  const pwPart = raw.slice(raw.indexOf('://') + 3, raw.lastIndexOf('@'));
  const pw = pwPart.slice(pwPart.indexOf(':') + 1);
  if (/[@/?#\s]/.test(pw)) warnings.push('The password contains @ / ? # or a space. URL-encode it (@ -> %40) or reset to a simpler password.');
  if ((raw.match(/@/g) ?? []).length > 1) warnings.push('The URL contains more than one "@" – a password with "@" breaks the URL. Encode it as %40.');
}
if (c.password && c.password.length < 8) warnings.push('Password is very short – it may have been cut off by the shell (did you use single quotes?).');
for (const w of warnings) console.log('⚠️ ', w);
if (warnings.length) console.log();

try {
  const conn = await mysql.createConnection({ ...c, connectTimeout: 10_000 });
  const [[row]] = await conn.query('SELECT VERSION() AS version, DATABASE() AS db');
  console.log('✅ Connected!', row);
  await conn.end();
} catch (e) {
  console.log('❌', e.code ?? '', '-', e.message);
  const hints = {
    ER_ACCESS_DENIED_ERROR: 'Username or password rejected. Check the full user (with prefix), or reset the password in TiDB (Connect → Reset password) and paste it again.',
    ER_BAD_DB_ERROR: 'Connected, but the database does not exist. Run in TiDB SQL Editor: CREATE DATABASE vitaltrack;',
    ENOTFOUND: 'Host name is wrong – copy it again from TiDB → Connect.',
    ETIMEDOUT: 'No answer – is the connection type "Public"? Is port 4000 blocked on this network?',
    ECONNREFUSED: 'Nothing is listening at that host/port.',
  };
  // TiDB reports a wrong login as ER_UNKNOWN_ERROR with the text "Access denied", so match the text too.
  const hint = hints[e.code]
    ?? (/access denied/i.test(e.message) ? hints.ER_ACCESS_DENIED_ERROR : null)
    ?? (/insecure transport/i.test(e.message) ? 'Add MYSQL_SSL=true.' : null);
  if (hint) console.log('💡', hint);
  process.exitCode = 1;
}
