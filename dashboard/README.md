<!-- =========================================================
     dashboard/README.md
     Aid Access Escrow V2 — Integrity & Status Dashboard
     -----------------------------------------------------
     Purpose:
       • Verify local build SHA-256 vs on-chain sourceHash
       • Inspect core contract state (read-only)
       • Query per-period progress and payout status
     Contents:
       • index.html · app.js · style.css
   ========================================================= -->

# Aid Access Escrow — Dashboard

A zero-install, browser-only dashboard for **verifying releases** and **auditing contract state**.  
Open `index.html` directly (double-click) or serve the folder via any static server.

---

## ✨ Features

- **Read-only connect** to any Ethereum RPC (L2/Mainnet/testnets)  
- Display **guardian**, **disabled**, **targets**, **tranche**, and **sourceHash**  
- Compute **SHA-256** of a local file (Web Crypto; stays on your device)  
- Compare your local hash → **bytes32** against the on-chain `sourceHash`  
- Inspect a `periodId` (corridor hours, kg delivered, paid flag, createdAt)  
- Copy-to-clipboard helpers for config, state, and hashes  

---

## 🗂️ Folder Layout

dashboard/
├─ index.html   # UI + inline ABI JSON
├─ app.js       # logic: RPC reads, hashing, compare, period queries
└─ style.css    # minimal, responsive CSS

> **Open:** `dashboard/index.html`

---

## 🚀 Quick Start

### Option A — Double-click (file://)
1. Clone the repo and open `dashboard/index.html`.  
2. Paste an **RPC URL** (e.g., Arbitrum, Base, Mainnet, or local node).  
3. Paste the deployed **Contract Address**.  
4. Click **Connect & Load** → state will populate.  
5. (Optional) Pick your release artifact (e.g., `moduleA-package.zip`) → **Compute** → **Compare vs On-Chain**.

### Option B — Local static server (recommended)
```bash
# from repo root
npx http-server . -p 8080
# open http://localhost:8080/dashboard/

Local servers avoid strict browser rules and give cleaner console logs.

⸻

🔐 How Integrity Verification Works
	1.	You select a file. The browser computes SHA-256 locally (no upload).
	2.	The app converts your 64-hex SHA-256 into 0x-prefixed bytes32.
	3.	It reads the on-chain sourceHash from the contract.
	4.	MATCH → the artifact you hold exactly matches the canonical release.
	5.	MISMATCH → stop and investigate (rebuild deterministically, check zip contents, confirm the right file).

⸻

⚙️ Inputs & Outputs
	•	RPC URL: Any public JSON-RPC endpoint (Alchemy, Infura, Ankr, or your node).
	•	Contract Address: Deployed AidAccessEscrowV2 address.
	•	on-chain fields: guardianMultisig, disabled, hoursTarget, kgTarget, tranche, sourceHash.
	•	periodId: bytes32 key you compute off-chain (e.g., keccak256("2025-W41")).

⸻

🧪 Reproducible Builds (tip)

Hashing is only meaningful if builds are reproducible. Recommended:
	•	Package your release with a deterministic archiver (fixed file order, timestamps normalized).
	•	Commit a hash-manifest.json built with /scripts/compute-hash-publish.js.
	•	Publish the same sha256 as the contract’s sourceHash.

⸻

🛟 Troubleshooting

“CORS/blocked or icons missing”
Use the local server method; some browsers limit file:// + external CDNs.

“Connected but state won’t load”
Confirm:
	•	RPC URL corresponds to the actual network used to deploy.
	•	Contract address is correct on that network.
	•	The ABI in index.html matches your deployed contract version.

Hash mismatch
	•	Ensure you’re hashing the same artifact used to derive sourceHash.
	•	Re-zip with normalized timestamps & paths; rebuild; recompute hash.

⸻

🔒 Privacy & Security
	•	Files never leave your device; hashing uses SubtleCrypto.digest.
	•	The dashboard doesn’t request wallets or signatures.
	•	It only performs read-only calls.

⸻

📄 License & Intent

This UI is part of the Aid Access Escrow V2 project (AGPL-3.0 + Zero-Harm Addendum).
It exists to increase transparency for humanitarian disbursements and reduce misuse via verifiable proofs.

“Verification is compassion translated into code.”

⸻


