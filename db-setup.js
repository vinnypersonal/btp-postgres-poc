'use strict';
/**
 * Custom DB deployer for BTP PostgreSQL Hyperscaler Option.
 *
 * The BTP PG credentials have no explicit "username" key — only a "uri".
 * @cap-js/postgres falls back to schema "public" when username is missing,
 * causing all CAP apps on the same DB instance to share cds_model and
 * conflict during delta migrations.
 *
 * This script:
 *   1. Extracts the username from the VCAP uri
 *   2. Creates a dedicated schema for this binding user (idempotent)
 *   3. Sets CDS_REQUIRES_DB_CREDENTIALS_SCHEMA so cds-deploy uses it
 */

const { spawnSync } = require('child_process');

async function main() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
  const pgBinding = vcap['postgresql-db']?.[0];

  if (!pgBinding) {
    console.error('[db-setup] ERROR: No postgresql-db service binding found in VCAP_SERVICES');
    process.exit(1);
  }

  const creds = pgBinding.credentials;

  // BTP PG Hyperscaler: username is only in the uri, not as a separate key
  let username = creds.username || creds.user;
  if (!username && creds.uri) {
    const m = creds.uri.match(/^postgres:\/\/([^:@]+):/);
    if (m) username = m[1];
  }

  if (!username) {
    console.error('[db-setup] ERROR: Cannot determine PostgreSQL username from credentials');
    process.exit(1);
  }

  console.log(`[db-setup] Deploying into schema: "${username}"`);

  // Create the schema if it doesn't already exist
  try {
    const { Client } = require('pg');
    const client = new Client({
      connectionString: creds.uri,
      ssl: { rejectUnauthorized: false }
    });
    await client.connect();
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${username}"`);
    await client.end();
    console.log(`[db-setup] Schema "${username}" is ready`);
  } catch (err) {
    // Non-fatal: schema might already exist or user already has default schema
    console.warn(`[db-setup] Schema setup warning: ${err.message}`);
  }

  // Tell @cap-js/postgres to use this user's schema
  process.env.CDS_REQUIRES_DB_CREDENTIALS_SCHEMA = username;

  console.log('[db-setup] Running cds-deploy...');
  const result = spawnSync('npx', ['cds-deploy'], {
    stdio: 'inherit',
    env: { ...process.env }
  });

  process.exit(result.status ?? 0);
}

main().catch(err => {
  console.error('[db-setup] Unhandled error:', err);
  process.exit(1);
});
