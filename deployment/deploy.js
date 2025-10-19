#!/usr/bin/env node
/**
 * ============================================================
 * deployment/deploy.js
 * Aid Access Escrow V2 — Hardhat / Ethers Deployment Script
 * ------------------------------------------------------------
 * • Deploys AidAccessEscrowV2 to a configured network (mainnet, testnet, or L2)
 * • Accepts env vars or CLI overrides for constructor params
 * • Saves deployment metadata to ./deployment/deployments/<network>.json
 *
 * Usage:
 *   npx hardhat run deployment/deploy.js --network arbitrum
 *
 * Env or CLI:
 *   STABLE=<erc20 address>
 *   ATTESTORS=<registry address>
 *   GUARDIAN=<multisig address>
 *   SOURCE_HASH=<0xsha256...>
 *   HOURS_TARGET=<int>
 *   KG_TARGET=<int>
 *   TRANCHE=<int>
 *   TIMELOCK_SECS=<int>
 *
 * Example:
 *   STABLE=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
 *   ATTESTORS=0xAttestorRegistryAddr \
 *   GUARDIAN=0xGuardianSafe \
 *   SOURCE_HASH=0x1234abcd... \
 *   HOURS_TARGET=60 \
 *   KG_TARGET=1500000 \
 *   TRANCHE=1000000000 \
 *   TIMELOCK_SECS=259200 \
 *   npx hardhat run deployment/deploy.js --network arbitrum
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  console.log('==========================================================');
  console.log(' Aid Access Escrow V2 — Deployment Script');
  console.log('==========================================================');

  const networkName = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log('[network]', networkName);
  console.log('[deployer]', deployer.address);
  console.log('[balance]', (await deployer.provider.getBalance(deployer.address)).toString());

  // ------------------------------------------------------------
  // Load constructor parameters
  // ------------------------------------------------------------
  const env = process.env;
  function must(name, def) {
    if (env[name]) return env[name];
    if (def !== undefined) return def;
    throw new Error(`Missing required env var: ${name}`);
  }

  const params = {
    STABLE: must('STABLE'),
    ATTESTORS: must('ATTESTORS'),
    GUARDIAN: must('GUARDIAN'),
    SOURCE_HASH: must('SOURCE_HASH'),
    HOURS_TARGET: Number(must('HOURS_TARGET', 60)),
    KG_TARGET: Number(must('KG_TARGET', 1500000)),
    TRANCHE: BigInt(must('TRANCHE', 1000000000000000000n)), // 1e18 default
    TIMELOCK_SECS: Number(must('TIMELOCK_SECS', 259200)), // 72h
  };

  console.log('Constructor parameters:');
  console.log(params);

  // ------------------------------------------------------------
  // Compile (if needed)
  // ------------------------------------------------------------
  await hre.run('compile');

  // ------------------------------------------------------------
  // Deploy contract
  // ------------------------------------------------------------
  const Factory = await hre.ethers.getContractFactory('AidAccessEscrowV2');
  const contract = await Factory.deploy(
    params.STABLE,
    params.ATTESTORS,
    params.GUARDIAN,
    params.SOURCE_HASH,
    params.HOURS_TARGET,
    params.KG_TARGET,
    params.TRANCHE,
    params.TIMELOCK_SECS
  );
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('----------------------------------------------------------');
  console.log('[deployed]', addr);
  console.log('----------------------------------------------------------');

  // ------------------------------------------------------------
  // Write deployment artifact
  // ------------------------------------------------------------
  const outDir = path.join(__dirname, 'deployments');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${networkName}.json`);
  const metadata = {
    contract: 'AidAccessEscrowV2',
    address: addr,
    network: networkName,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    parameters: params,
  };
  fs.writeFileSync(outFile, JSON.stringify(metadata, null, 2));
  console.log('[saved]', outFile);

  // ------------------------------------------------------------
  // Optional: verification command hint
  // ------------------------------------------------------------
  console.log('To verify on Etherscan (if supported):');
  console.log(
    `  npx hardhat verify --network ${networkName} ${addr} ` +
      `${params.STABLE} ${params.ATTESTORS} ${params.GUARDIAN} ${params.SOURCE_HASH} ` +
      `${params.HOURS_TARGET} ${params.KG_TARGET} ${params.TRANCHE} ${params.TIMELOCK_SECS}`
  );

  console.log('==========================================================');
  console.log(' Deployment complete.');
  console.log('==========================================================');
}

main().catch((err) => {
  console.error('[error]', err);
  process.exit(1);
});
