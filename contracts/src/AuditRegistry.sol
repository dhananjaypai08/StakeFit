// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @title AuditRegistry
/// @notice Consumer contract that receives the consensus signed verdict from the
///         Chainlink CRE confidential workflow. The trusted Chainlink Forwarder
///         (or the owner during simulation) submits the verdict. The subgraph
///         indexes AuditCompleted so verdicts become queryable memory.
contract AuditRegistry is Owned {
    /// @dev The Chainlink Forwarder authorized to deliver CRE reports.
    address public forwarder;

    struct Verdict {
        uint8 verdict; // 0 ALLOW, 1 MANUAL_REVIEW, 2 DENY
        uint16 score; // score times 100, so 0..1000
        string reportCid;
        uint256 finishedAt;
    }

    mapping(bytes32 => Verdict) public verdicts;

    event ForwarderSet(address indexed forwarder);
    event AuditCompleted(
        bytes32 indexed scanId,
        string target,
        uint8 verdict,
        uint16 score,
        string reportCid,
        uint256 finishedAt
    );

    error NotAuthorized();

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != forwarder) revert NotAuthorized();
        _;
    }

    function setForwarder(address f) external onlyOwner {
        if (f == address(0)) revert ZeroAddress();
        forwarder = f;
        emit ForwarderSet(f);
    }

    function submitVerdict(
        bytes32 scanId,
        string calldata target,
        uint8 verdict,
        uint16 score,
        string calldata reportCid
    ) external onlyAuthorized {
        verdicts[scanId] = Verdict({verdict: verdict, score: score, reportCid: reportCid, finishedAt: block.timestamp});
        emit AuditCompleted(scanId, target, verdict, score, reportCid, block.timestamp);
    }

    function getVerdict(bytes32 scanId) external view returns (Verdict memory) {
        return verdicts[scanId];
    }
}
