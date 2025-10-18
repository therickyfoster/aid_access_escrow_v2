solidity
<!-- ========================================================= -->
<!-- contracts/AidAccessEscrowV2.sol                              -->
<!-- Aid Access Escrow V2 — Guardian-governed humanitarian escrow -->
<!-- - Stores a sourceHash (sha256) for canonical artifact verification -->
<!-- - Attestations from allowlisted attestors contribute to period totals -->
<!-- - Disbursements occur only when period thresholds are met -->
<!-- - Guardian multisig + timelocked disable/freeze flow (no selfdestruct) -->
<!-- - Events emitted for complete public audit trail -->
<!-- ========================================================= -->

// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.24;

/*
  NOTE: For production, replace the minimal interfaces below with audited
  OpenZeppelin contracts and a proper AttestorRegistry/EAS integration.

  Example imports (hardhat / npm):
    import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
    import "@openzeppelin/contracts/access/Ownable.sol";
    import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
*/

/// @title AidAccessEscrowV2
/// @author Foster + Navi (Planetary Restoration Archive)
/// @notice Guardian-governed stablecoin escrow that disburses aid tranches on oracle attestations
/// @dev This contract intentionally avoids destructive primitives. Governance via multisig recommended.
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// @dev Replace with your attestor registry or EAS adapter. Must implement isAttestor(address) → bool.
interface IAttestorRegistry {
    function isAttestor(address who) external view returns (bool);
}

contract AidAccessEscrowV2 {
    // -------------------------
    // Immutable core references
    // -------------------------
    IERC20Minimal public immutable stable;         // Token used for funding (USDC/DAI)
    IAttestorRegistry public immutable attestors;  // Off-chain attestor registry (EAS or similar)

    // -------------------------
    // Governance & integrity
    // -------------------------
    address public guardianMultisig;   // Gnosis Safe / multisig address
    bytes32 public sourceHash;         // sha256 of canonical zip/package (bytes32)
    bool public disabled;              // global safety flag (blocks attest + disburse)
    uint256 public disableRequestedAt; // timestamp when disable was requested
    uint256 public disableTimelock;    // seconds to wait between request and finalize (e.g., 72h)

    // -------------------------
    // Configuration (tunable)
    // -------------------------
    uint256 public hoursTarget;  // corridor-hours target per period
    uint256 public kgTarget;     // kg delivered target per period
    uint256 public tranche;      // payout amount per successful period
    uint256 public periodWindow; // optional: seconds length of a period (0 = arbitrary keyed periods)

    // -------------------------
    // Data models
    // -------------------------
    struct Period {
        uint256 corridorHours; // cumulative corridor open hours (sum of attestations)
        uint256 kgDelivered;   // cumulative kilograms delivered
        bool paid;             // has this period been paid already?
        uint256 createdAt;     // optional timestamp for reference
    }

    // mapping periodKey => Period
    mapping(bytes32 => Period) public periods;

    // allowlist for operators (aid distribution orgs)
    mapping(address => bool) public operatorAllowlist;

    // trusted attestor registry bool check is delegated to attestors.isAttestor(addr)

    // -------------------------
    // Events (complete audit trail)
    // -------------------------
    event Deposit(address indexed from, uint256 amount);
    event AttestorAdded(address indexed attestor); // if you support dynamic attestor management off-chain
    event Attest(bytes32 indexed periodId, uint8 kind, uint256 value, bytes32 metaHash, address indexed attestor);
    event OperatorSet(address indexed op, bool ok);
    event Disburse(bytes32 indexed periodId, address indexed to, uint256 amount);
    event SourceHashSet(bytes32 indexed newHash, address indexed setter);
    event DisableRequested(address indexed by, uint256 when);
    event Disabled(address indexed by, uint256 when);
    event EnableRequested(address indexed by, uint256 when);
    event Enabled(address indexed by, uint256 when);
    event GuardianMultisigUpdated(address indexed oldAddr, address indexed newAddr);

    // -------------------------
    // Modifiers
    // -------------------------
    modifier onlyGuardian() {
        require(msg.sender == guardianMultisig, "AAS: not guardian");
        _;
    }

    modifier notDisabled() {
        require(!disabled, "AAS: contract disabled");
        _;
    }

    // -------------------------
    // Constructor
    // -------------------------
    /// @param _stable ERC20 stable token to use (address)
    /// @param _attestors attestor registry contract (address)
    /// @param _guardian guardian multisig address (address)
    /// @param _sourceHash initial SHA-256 hash of canonical package (bytes32)
    /// @param _hoursTarget corridor hours target (uint256)
    /// @param _kgTarget kilograms target (uint256)
    /// @param _tranche payout per period (uint256)
    /// @param _timelockSeconds timelock for disable/finalize (uint256)
    constructor(
        IERC20Minimal _stable,
        IAttestorRegistry _attestors,
        address _guardian,
        bytes32 _sourceHash,
        uint256 _hoursTarget,
        uint256 _kgTarget,
        uint256 _tranche,
        uint256 _timelockSeconds
    ) {
        require(_guardian != address(0), "AAS: guardian zero");
        stable = _stable;
        attestors = _attestors;
        guardianMultisig = _guardian;
        sourceHash = _sourceHash;
        hoursTarget = _hoursTarget;
        kgTarget = _kgTarget;
        tranche = _tranche;
        disableTimelock = _timelockSeconds;
        periodWindow = 0; // by default, periods are keyed externally (you can set window later)
    }

    // -------------------------
    // Funding
    // -------------------------
    /// @notice Deposit stable tokens into the escrow
    /// @param amount amount of stable tokens to deposit (must be prior approved)
    function deposit(uint256 amount) external {
        require(amount > 0, "AAS: zero deposit");
        bool ok = stable.transferFrom(msg.sender, address(this), amount);
        require(ok, "AAS: transferFrom failed");
        emit Deposit(msg.sender, amount);
    }

    // -------------------------
    // Operator allowlist (guarded)
    // -------------------------
    /// @notice Set or revoke an operator (aid distribution wallet)
    /// @param op operator address
    /// @param ok boolean allow / disallow
    function setOperator(address op, bool ok) external onlyGuardian {
        operatorAllowlist[op] = ok;
        emit OperatorSet(op, ok);
    }

    // -------------------------
    // Source hash (guarded)
    // -------------------------
    /// @notice Update the sourceHash anchor (rare; guarded)
    /// @param newHash bytes32 sha256 of canonical release
    function setSourceHash(bytes32 newHash) external onlyGuardian {
        sourceHash = newHash;
        emit SourceHashSet(newHash, msg.sender);
    }

    // -------------------------
    // Attestations (by authorized attestors off-chain)
    // -------------------------
    // kind: 1 = corridor hours, 2 = kg delivered
    /// @notice Submit an attestation for a period. Attesters must be registered in attestor registry.
    /// @param periodId bytes32 identifier of the period (e.g., keccak256(abi.encodePacked(dateString)) )
    /// @param kind uint8 1=corridorHours, 2=kgDelivered
    /// @param value uint256 value to add
    /// @param metaHash optional metadata hash (ipfs cid hash or sha256)
    function attest(bytes32 periodId, uint8 kind, uint256 value, bytes32 metaHash) external notDisabled {
        require(attestors.isAttestor(msg.sender), "AAS: not attestor");
        require(value > 0, "AAS: zero value");
        Period storage p = periods[periodId];
        if (p.createdAt == 0) {
            p.createdAt = block.timestamp;
        }

        if (kind == 1) {
            p.corridorHours += value;
        } else if (kind == 2) {
            p.kgDelivered += value;
        } else {
            revert("AAS: bad kind");
        }

        emit Attest(periodId, kind, value, metaHash, msg.sender);
    }

    // -------------------------
    // Disbursement
    // -------------------------
    /// @notice Disburse tranche to approved operator when both targets are met
    /// @param periodId period key
    /// @param to operator address (must be allowed)
    function disburse(bytes32 periodId, address to) external notDisabled {
        require(operatorAllowlist[to], "AAS: operator not allowed");
        Period storage p = periods[periodId];
        require(!p.paid, "AAS: already paid");
        require(p.corridorHours >= hoursTarget && p.kgDelivered >= kgTarget, "AAS: targets not met");
        p.paid = true;

        bool ok = stable.transfer(to, tranche);
        require(ok, "AAS: transfer failed");

        emit Disburse(periodId, to, tranche);
    }

    // -------------------------
    // Safety - Timelocked disable/enable (guardian multisig)
    // -------------------------
    /// @notice Guardian starts a disable request (starts the timelock)
    function requestDisable() external onlyGuardian {
        disableRequestedAt = block.timestamp;
        emit DisableRequested(msg.sender, disableRequestedAt);
    }

    /// @notice After timelock, guardian finalizes the disable (freezes attest & disburse)
    function finalizeDisable() external onlyGuardian {
        require(disableRequestedAt > 0, "AAS: disable not requested");
        require(block.timestamp >= disableRequestedAt + disableTimelock, "AAS: timelock not elapsed");
        disabled = true;
        // reset request timestamp to avoid accidental re-use
        disableRequestedAt = 0;
        emit Disabled(msg.sender, block.timestamp);
    }

    /// @notice Guardian requests enable (starts timelock to re-enable)
    function requestEnable() external onlyGuardian {
        disableRequestedAt = block.timestamp;
        emit EnableRequested(msg.sender, disableRequestedAt);
    }

    /// @notice After timelock, guardian finalizes enable
    function finalizeEnable() external onlyGuardian {
        require(disableRequestedAt > 0, "AAS: enable not requested");
        require(block.timestamp >= disableRequestedAt + disableTimelock, "AAS: timelock not elapsed");
        disabled = false;
        disableRequestedAt = 0;
        emit Enabled(msg.sender, block.timestamp);
    }

    /// @notice Update guardian multisig address (very sensitive; guarded)
    function updateGuardianMultisig(address newGuardian) external onlyGuardian {
        require(newGuardian != address(0), "AAS: zero addr");
        address old = guardianMultisig;
        guardianMultisig = newGuardian;
        emit GuardianMultisigUpdated(old, newGuardian);
    }

    // -------------------------
    // View helpers & audit helpers
    // -------------------------
    /// @notice Helper to check if a period meets targets (without changing state)
    function periodMeetsTargets(bytes32 periodId) external view returns (bool) {
        Period storage p = periods[periodId];
        if (p.paid) return false;
        return (p.corridorHours >= hoursTarget && p.kgDelivered >= kgTarget && !disabled);
    }

    /// @notice Read period summary
    function getPeriod(bytes32 periodId) external view returns (uint256 corridorHours, uint256 kgDelivered, bool paid, uint256 createdAt) {
        Period storage p = periods[periodId];
        return (p.corridorHours, p.kgDelivered, p.paid, p.createdAt);
    }

    // -------------------------
    // Rescue / Recovery (guardian only)
    // -------------------------
    /// @notice Emergency: guardian can pull funds to specified recovery address (use rarely)
    /// @dev This function is intentionally powerful and should only be used under well-documented governance.
    function guardianRecover(address to, uint256 amount) external onlyGuardian {
        require(to != address(0), "AAS: zero addr");
        bool ok = stable.transfer(to, amount);
        require(ok, "AAS: transfer failed");
    }

    // -------------------------
    // End contract
    // -------------------------
}
