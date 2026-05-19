'use strict';
/**
 * Custom DB deployer for BTP PostgreSQL Hyperscaler Option.
 *
 * Problem this solves:
 *   Each CF binding to the same PG service instance gets a UNIQUE DB user.
 *   @cap-js/postgres defaults to using the username as the PostgreSQL schema,
 *   so tables deployed by the deployer are invisible to the srv binding.
 *
 * Fix — shared fixed schema "btppgpoc":
 *   1. Deployer creates schema "btppgpoc" (idempotent CREATE IF NOT EXISTS)
 *   2. Pre-seed cds_model with the NORMALIZED current CSN (afterImage format)
 *      so cds-deploy computes an empty delta — no CREATE, no DROP.
 *   3. Run cds-deploy (no-op schema migration, just updates cds_model)
 *   4. GRANT PUBLIC access so srv's different DB user can read/write all tables
 *   5. srv uses schema "btppgpoc" via CDS_REQUIRES_DB_CREDENTIALS_SCHEMA (mta.yaml)
 *
 * Why normalized (afterImage) CSN, not raw csn.json?
 *   The delta function needs the prior model in the same internal format it
 *   produces. Using raw csn.json causes "Unexpected non-primitive type" errors
 *   because type references haven't been flattened yet.
 *   Solution: compute delta(current, undefined) → use its afterImage as prior.
 *   Then delta(current, afterImage) = empty → zero SQL changes.
 *
 * NOTE: PUBLIC grants are acceptable for a shared POC instance.
 *       In production use a dedicated PG instance (no sharing needed).
 */

const { spawnSync } = require('child_process');
const path = require('path');

const SCHEMA = 'btppgpoc';

async function main() {
  const vcap = JSON.parse(process.env.VCAP_SERVICES || '{}');
  const pgBinding = vcap['postgresql-db']?.[0];

  if (!pgBinding) {
    console.error('[db-setup] ERROR: No postgresql-db binding found in VCAP_SERVICES');
    process.exit(1);
  }

  const creds = pgBinding.credentials;
  const { Client } = require('pg');

  // Step 1: Create the shared schema
  console.log(`[db-setup] Connecting to PostgreSQL...`);
  const setupClient = new Client({ connectionString: creds.uri, ssl: { rejectUnauthorized: false } });
  await setupClient.connect();
  console.log(`[db-setup] Creating schema "${SCHEMA}" if not exists...`);
  await setupClient.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await setupClient.end();
  console.log(`[db-setup] Schema "${SCHEMA}" is ready`);

  // Step 2: Pre-seed cds_model with the normalized (afterImage) CSN.
  //
  //   cds-deploy uses cds_model as the "prior model" for delta migration.
  //   We want delta(current, prior) = empty so no CREATE/DROP is attempted.
  //
  //   Raw srv/csn.json has unresolved type references which crash the delta
  //   compiler ("Unexpected non-primitive type"). We must use the same
  //   internal "afterImage" format that the delta function produces.
  //
  //   Trick: run delta(csn, undefined) ourselves to get afterImage, then
  //   store it as prior. Next delta(csn, afterImage) = empty.
  const cds = require('@sap/cds');
  const deploy = require('@sap/cds/lib/dbs/cds-deploy');
  const csnPath = path.join(__dirname, 'srv', 'csn.json');

  // Replicate the exact model preparation pipeline used by cds-deploy CLI:
  //   1. cds.load().then(cds.minify) — strips unreferenced types (e.g. sap.common.*)
  //   2. exclude_external_entities_in — marks external service entities as skip
  // Without this, afterImage would include sap.common.Languages etc. which
  // cds-deploy's minified model excludes, causing spurious "DROP" in the delta.
  const csn = await cds.load(csnPath).then(cds.minify);
  deploy.exclude_external_entities_in(csn);

  // Compute the normalized afterImage by diffing against no prior model.
  // drops = [] (nothing to drop from scratch), createsAndAlters has CREATE TABLE
  // statements - but we ONLY want afterImage, not the SQL.
  const { afterImage } = cds.compile.to.sql.delta(csn, { kind: 'postgres', dialect: 'postgres' }, undefined);
  const normalizedCsn = JSON.stringify(afterImage);

  const modelClient = new Client({ connectionString: creds.uri, ssl: { rejectUnauthorized: false } });
  await modelClient.connect();
  await modelClient.query(`SET search_path TO "${SCHEMA}"`);
  await modelClient.query(`CREATE TABLE IF NOT EXISTS cds_model (csn TEXT)`);

  const { rows } = await modelClient.query('SELECT 1 FROM cds_model LIMIT 1');
  if (rows.length > 0) {
    await modelClient.query('UPDATE cds_model SET csn = $1', [normalizedCsn]);
    console.log('[db-setup] Updated cds_model with normalized CSN (delta will be empty)');
  } else {
    await modelClient.query('INSERT INTO cds_model (csn) VALUES ($1)', [normalizedCsn]);
    console.log('[db-setup] Seeded cds_model with normalized CSN (delta will be empty)');
  }
  await modelClient.end();

  // Step 3: Run cds-deploy (delta = current vs afterImage = empty → no SQL)
  process.env.CDS_REQUIRES_DB_CREDENTIALS_SCHEMA = SCHEMA;
  console.log(`[db-setup] Running cds-deploy into schema "${SCHEMA}"...`);
  const result = spawnSync('npx', ['cds-deploy'], { stdio: 'inherit', env: { ...process.env } });

  if (result.status !== 0) {
    console.error(`[db-setup] cds-deploy failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  // Step 4: Grant all PG users (PUBLIC) access so the srv binding user
  //         (different from deployer user) can read and write all tables.
  console.log(`[db-setup] Granting PUBLIC access to schema "${SCHEMA}"...`);
  const grantClient = new Client({ connectionString: creds.uri, ssl: { rejectUnauthorized: false } });
  await grantClient.connect();

  for (const sql of [
    `GRANT USAGE ON SCHEMA "${SCHEMA}" TO PUBLIC`,
    `GRANT ALL ON ALL TABLES IN SCHEMA "${SCHEMA}" TO PUBLIC`,
    `GRANT ALL ON ALL SEQUENCES IN SCHEMA "${SCHEMA}" TO PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${SCHEMA}" GRANT ALL ON TABLES TO PUBLIC`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA "${SCHEMA}" GRANT ALL ON SEQUENCES TO PUBLIC`
  ]) {
    await grantClient.query(sql);
    console.log(`[db-setup]   OK: ${sql}`);
  }

  await grantClient.end();
  console.log('[db-setup] Schema deployment complete.');
  process.exit(0);
}

main().catch(err => {
  console.error('[db-setup] Unhandled error:', err);
  process.exit(1);
});
