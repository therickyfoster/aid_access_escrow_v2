/* =========================================================
   dashboard/app.js
   Aid Access Escrow V2 — Browser Dashboard Logic
   ----------------------------------------------------------
   Features:
     • Connect to RPC + contract (read-only)
     • Load and display contract state
     • Compute SHA-256 of a local file (Web Crypto)
     • Compare against on-chain sourceHash
     • Read a specific periodId record
   ========================================================= */

(async () => {
  // Utility shortcuts
  const $ = (id) => document.getElementById(id);
  const out = (el, txt) => { if (el) el.textContent = txt ?? "—"; };

  // State
  let provider, contract, abi;

  // Parse ABI from inline JSON in index.html
  try {
    abi = JSON.parse(document.getElementById("abi-json").textContent);
  } catch (e) {
    console.error("ABI parse error:", e);
  }

  // Convert bytes32 → 0x-prefixed hex
  const bytes32ToHex = (b) => (b ? b.toLowerCase() : "0x" + "0".repeat(64));

  // ====== Connection ======
  $("btnConnect").onclick = async () => {
    try {
      const rpc = $("rpcUrl").value.trim();
      const addr = $("contractAddr").value.trim();
      if (!rpc || !addr) throw new Error("RPC URL and contract address required");

      provider = new ethers.JsonRpcProvider(rpc);
      contract = new ethers.Contract(addr, abi, provider);

      $("connStatus").textContent = "Connected ✓";
      $("connStatus").classList.remove("muted");
      $("connStatus").classList.add("good");

      await loadState();
    } catch (e) {
      $("connStatus").textContent = "Error: " + e.message;
      $("connStatus").classList.remove("good");
    }
  };

  $("btnCopyConfig").onclick = () => {
    const cfg = {
      rpc: $("rpcUrl").value,
      contract: $("contractAddr").value,
    };
    navigator.clipboard.writeText(JSON.stringify(cfg, null, 2));
    $("connStatus").textContent = "Config copied ✅";
  };

  // ====== Load Contract State ======
  async function loadState() {
    if (!contract) return;
    $("stateMsg").textContent = "Loading…";

    try {
      const [guardian, disabled, tranche, hoursT, kgT, sHash] = await Promise.all([
        contract.guardianMultisig(),
        contract.disabled(),
        contract.tranche(),
        contract.hoursTarget(),
        contract.kgTarget(),
        contract.sourceHash(),
      ]);

      out($("guardian"), guardian);
      out($("disabled"), disabled ? "true" : "false");
      out($("tranche"), tranche.toString());
      out($("hoursTarget"), hoursT.toString());
      out($("kgTarget"), kgT.toString());
      out($("sourceHash"), sHash);
      $("stateMsg").textContent = "State loaded ✓";
    } catch (e) {
      $("stateMsg").textContent = "Error: " + e.message;
    }
  }

  $("btnRefresh").onclick = loadState;
  $("btnCopyState").onclick = () => {
    const data = {
      guardian: $("guardian").textContent,
      disabled: $("disabled").textContent,
      tranche: $("tranche").textContent,
      hoursTarget: $("hoursTarget").textContent,
      kgTarget: $("kgTarget").textContent,
      sourceHash: $("sourceHash").textContent,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    $("stateMsg").textContent = "Copied ✓";
  };

  // ====== Local File Hashing ======
  $("btnHash").onclick = async () => {
    const file = $("filePick").files[0];
    if (!file) return ($("verifyMsg").textContent = "Select a file first");
    $("verifyMsg").textContent = "Hashing…";

    try {
      const buf = await file.arrayBuffer();
      const hash = await crypto.subtle.digest("SHA-256", buf);
      const hex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      $("localHash").value = hex;
      $("verifyMsg").textContent = "SHA-256 ready ✓";
    } catch (e) {
      $("verifyMsg").textContent = "Error: " + e.message;
    }
  };

  $("btnCopyHash").onclick = () => {
    const h = $("localHash").value;
    if (h) navigator.clipboard.writeText(h);
    $("verifyMsg").textContent = "Hash copied ✓";
  };

  $("btnCompare").onclick = () => {
    const local = $("localHash").value.trim();
    const onchain = $("sourceHash").textContent.trim();
    if (!local || !onchain) {
      $("verifyMsg").textContent = "Need both hashes";
      return;
    }

    const localBytes32 = "0x" + local.toLowerCase();
    out($("onchainBytes32"), onchain);
    out($("localBytes32"), localBytes32);

    const match = onchain.toLowerCase() === localBytes32;
    const outcome = $("cmpOutcome");
    outcome.textContent = match ? "✅ MATCH — Verified" : "❌ MISMATCH";
    outcome.className = match ? "cmp-outcome good" : "cmp-outcome bad";
    $("comparePanel").classList.remove("hidden");
  };

  // ====== Period Inspector ======
  $("btnReadPeriod").onclick = async () => {
    if (!contract) return;
    const pid = $("periodId").value.trim();
    if (!pid) return;

    $("meetsTargets").textContent = "…";

    try {
      const meets = await contract.periodMeetsTargets(pid);
      const [h, k, paid, created] = await contract.getPeriod(pid);

      out($("pHours"), h.toString());
      out($("pKg"), k.toString());
      out($("pPaid"), paid ? "true" : "false");
      out($("pCreated"), new Date(Number(created) * 1000).toISOString());
      $("periodPanel").classList.remove("hidden");
      $("meetsTargets").textContent = meets ? "✅ Yes" : "❌ No";
      $("meetsTargets").className = meets ? "badge good" : "badge bad";
    } catch (e) {
      $("meetsTargets").textContent = "Error";
      console.error(e);
    }
  };
})();
