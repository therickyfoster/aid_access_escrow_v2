#!/usr/bin/env node
/**
 * ============================================================
 * scripts/encrypt-keys.js
 * Guardian Key Encryption / Decryption Helper
 * ------------------------------------------------------------
 * • Encrypts a guardian private key file with AES-256-GCM
 * • Decrypts a previously encrypted file when --decrypt is passed
 * • Never overwrites originals unless --force is set
 *
 * Usage:
 *   node scripts/encrypt-keys.js --encrypt --in guardian-key.pem --out guardian-key.pem.enc
 *   node scripts/encrypt-keys.js --decrypt --in guardian-key.pem.enc --out guardian-key.pem
 *
 * Options:
 *   --password <string>      Supply passphrase directly (omit to be prompted)
 *   --force                  Overwrite output file if it exists
 *   --json                   Emit small JSON summary after operation
 * ============================================================
 */

const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('encrypt', { type: 'boolean', describe: 'Encrypt input file' })
  .option('decrypt', { type: 'boolean', describe: 'Decrypt input file' })
  .option('in', { type: 'string', demandOption: true, describe: 'Input file path' })
  .option('out', { type: 'string', demandOption: true, describe: 'Output file path' })
  .option('password', { type: 'string', describe: 'Passphrase (discouraged to supply in plaintext)' })
  .option('force', { type: 'boolean', default: false, describe: 'Overwrite output file if it exists' })
  .option('json', { type: 'boolean', default: false, describe: 'Print JSON summary instead of text' })
  .check((a) => {
    if (a.encrypt === a.decrypt) throw new Error('Specify exactly one: --encrypt or --decrypt');
    return true;
  })
  .help()
  .argv;

/* ------------------------------------------------------------
 * Helper: prompt for passphrase without echo
 * ----------------------------------------------------------*/
async function promptHidden(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    let pass = '';
    process.stdin.on('data', (ch) => {
      ch = ch.toString('utf8');
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdout.write('\n');
        process.stdin.setRawMode(false);
        rl.close();
        resolve(pass);
      } else if (ch === '\u0003') {
        process.stdout.write('\n^C\n');
        process.exit();
      } else {
        pass += ch;
      }
    });
  });
}

/* ------------------------------------------------------------
 * Core encrypt/decrypt functions
 * ----------------------------------------------------------*/
function encryptFile(inputPath, outPath, password, force) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  if (fs.existsSync(outPath) && !force) throw new Error(`Output exists: ${outPath}`);

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(password).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = fs.readFileSync(inputPath);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const outBuf = Buffer.concat([iv, tag, enc]);
  fs.writeFileSync(outPath, outBuf);

  return { iv: iv.toString('hex'), tag: tag.toString('hex'), bytes: enc.length };
}

function decryptFile(inputPath, outPath, password, force) {
  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  if (fs.existsSync(outPath) && !force) throw new Error(`Output exists: ${outPath}`);

  const buf = fs.readFileSync(inputPath);
  if (buf.length < 28) throw new Error('Corrupt encrypted file');

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);

  const key = crypto.createHash('sha256').update(password).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  fs.writeFileSync(outPath, dec);

  return { iv: iv.toString('hex'), tag: tag.toString('hex'), bytes: dec.length };
}

/* ------------------------------------------------------------
 * Main execution
 * ----------------------------------------------------------*/
(async () => {
  try {
    let password = argv.password;
    if (!password) password = await promptHidden('Enter passphrase: ');

    let result;
    if (argv.encrypt) {
      result = encryptFile(argv.in, argv.out, password, argv.force);
      if (argv.json) console.log(JSON.stringify({ action: 'encrypt', ...result }, null, 2));
      else console.log(`[encrypt] wrote ${argv.out} (${result.bytes} bytes encrypted)`);
    } else {
      result = decryptFile(argv.in, argv.out, password, argv.force);
      if (argv.json) console.log(JSON.stringify({ action: 'decrypt', ...result }, null, 2));
      else console.log(`[decrypt] wrote ${argv.out} (${result.bytes} bytes decrypted)`);
    }
  } catch (err) {
    console.error('[error]', err.message || err);
    process.exit(1);
  }
})();
