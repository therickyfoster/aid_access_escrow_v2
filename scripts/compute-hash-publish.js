#!/usr/bin/env node
/**
 * ============================================================
 * scripts/compute-hash-publish.js
 * Aid Access Escrow V2 — Hash & (optional) On-Chain Publish
 * ------------------------------------------------------------
 * • Computes SHA-256 for a given FILE (e.g., moduleA-package.zip)
 * • Prints hex hash and bytes32-ready 0x… form
 * • Optional: writes a manifest JSON file with timestamp + metadata
 * • Optional: publishes hash to contract.setSourceHash(bytes32)
 *
 * Usage:
 *   node scripts/compute-hash-publish.js --file ./dist/moduleA.zip
 *   node scripts/compute-hash-publish.js --file ./dist/moduleA.zip --manifest ./dist/hash-manifest.json
 *   node scripts/compute-hash-publish.js --file ./dist/moduleA.zip --publish --contract 0xYourContract --abi ./artifacts/AidAccessEscrowV2.json
 *
 * Env (for --publish):
 *   RPC_URL=<https endpoint or ws>
 *   GUARDIAN_PRIVATE_KEY=<0x...>
 *
 * Notes:
 *   • We hash a single file to keep determinism trivial. Create your zip/tar
 *     deterministically outside this script if hashing directories.
 *   • setSourceHash(bytes32) is guarded; ensure you run with guardian key.
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hasEthers = (() => {
  try { require.resolve('ethers'); return true; } catch { return false; }
})();

const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('file', { type: 'string', demandOption: true, describe: 'Path to file to hash (e.g., ./dist/moduleA.zip)' })
  .option('manifest', { type: 'string', describe: 'Optional path to write a JSON manifest of the computed hash' })
  .option('publish', { type: 'boolean', default: false, describe: 'If true, call setSourceHash(bytes32) on the contract' })
  .option('contract', { type: 'string', describe: 'Contract address (required when --publish)' })
  .option('abi', { type: 'string', describe: 'Path to ABI JSON with setSourceHash(bytes32); if omitted, uses a minimal inline ABI' })
  .option('networkTag', { type: 'string', default: '', describe: 'Optional label saved into manifest (e.g., arbitrum, base, mainnet)' })
  .strict()
  .help()
  .argv;

/* ------------------------------------------------------------
 * Helpers
 * ----------------------------------------------------------*/
function fileExists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function sha256FileSync(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha256').update(buf).digest('hex'); // 64 hex chars
}

function to0xBytes32(hexStr) {
  const clean = hexStr.startsWith('0x') ? hexStr.slice(2) : hexStr;
  if (clean.length !== 64) throw new Error(`Expected 32-byte SHA-256 (64 hex chars), got length ${clean.length}`);
  return '0x' + clean;
}

function nowISO() {
  return new Date().toISOString();
}

function loadABI(abiPath) {
  if (!abiPath) {
    // Minimal ABI with setSourceHash(bytes32) only
    return [
      {
        "inputs": [{ "internalType": "bytes32", "name": "newHash", "type": "bytes32" }],
        "name": "setSourceHash",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      }
    ];
  }
  const raw = fs.readFileSync(abiPath, 'utf8');
  const parsed = JSON.parse(raw);
  // Support Hardhat artifact or flat ABI
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.abi)) return parsed.abi;
  throw new Error('Unable to parse ABI: provide a flat ABI array or a Hardhat artifact JSON with .abi');
}

async function publishHash({ contractAddr, abi, bytes32Hash }) {
  if (!hasEthers) throw new Error('Ethers.js not installed. Run: npm i ethers');
  const { ethers } = require('ethers');

  const rpc = process.env.RPC_URL;
  const pk  = process.env.GUARDIAN_PRIVATE_KEY;

  if (!rpc) throw new Error('Missing RPC_URL env var');
  if (!pk)  throw new Error('Missing GUARDIAN_PRIVATE_KEY env var');

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet   = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(contractAddr, abi, wallet);

  console.log('[publish] Connected as:', await wallet.getAddress());
  console.log('[publish] Contract:', contractAddr);

  const tx = await contract.setSourceHash(bytes32Hash);
  console.log('[publish] Submitted tx:', tx.hash);
  const receipt = await tx.wait();
  console.log('[publish] Confirmed in block:', receipt.blockNumber);

  return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

/* ------------------------------------------------------------
 * Main
 * ----------------------------------------------------------*/
(async () => {
  try {
    const filePath = path.resolve(argv.file);
    if (!fileExists(filePath)) {
      throw new Error(`File not found or unreadable: ${filePath}`);
    }

    // 1) Compute SHA-256
    const hexHash = sha256FileSync(filePath);
    const bytes32Hash = to0xBytes32(hexHash);

    console.log('==========================================================');
    console.log(' Aid Access Escrow V2 — SHA-256 Computation');
    console.log('----------------------------------------------------------');
    console.log(' File:        ', filePath);
    console.log(' SHA256 (hex):', hexHash);
    console.log(' bytes32:     ', bytes32Hash);
    console.log(' Timestamp:   ', nowISO());
    console.log('==========================================================');

    // 2) Optional manifest emit
    if (argv.manifest) {
      const manifestPath = path.resolve(argv.manifest);
      const manifest = {
        schema: 'aid-access-escrow.v1',
        computedAt: nowISO(),
        file: path.basename(filePath),
        filePath: filePath,
        sha256Hex: hexHash,
        sha256Bytes32: bytes32Hash,
        networkTag: argv.networkTag || '',
        notes: 'Use sha256sum locally to verify this build; compare bytes32 to on-chain sourceHash.'
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log('[manifest] wrote:', manifestPath);
    }

    // 3) Optional on-chain publish
    if (argv.publish) {
      if (!argv.contract) throw new Error('Missing --contract for publish');
      const abi = loadABI(argv.abi);
      const res = await publishHash({
        contractAddr: argv.contract,
        abi,
        bytes32Hash
      });
      console.log('[publish] done:', res);
    } else {
      console.log('[publish] skipped (pass --publish to call setSourceHash)');
    }

    // Exit success
    process.exit(0);
  } catch (err) {
    console.error('[error]', err.message || err);
    process.exit(1);
  }
})();
