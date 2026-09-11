// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @title ObservationLog
/// @notice The write side of the StakeFit tight loop. Agents emit observations
///         here; the StakeFit subgraph indexes them so future steps and future
///         scans can recall prior findings as memory.
contract ObservationLog is Owned {
    mapping(address => bool) public authorizedRecorder;

    event RecorderSet(address indexed recorder, bool allowed);

    event ObservationRecorded(
        bytes32 indexed scanId,
        string agent,
        string target,
        string findingType,
        uint8 severity,
        bytes32 digest,
        string note,
        uint256 createdAt
    );

    error NotAuthorized();

    modifier onlyRecorder() {
        if (msg.sender != owner && !authorizedRecorder[msg.sender]) revert NotAuthorized();
        _;
    }

    function setRecorder(address recorder, bool allowed) external onlyOwner {
        authorizedRecorder[recorder] = allowed;
        emit RecorderSet(recorder, allowed);
    }

    function record(
        bytes32 scanId,
        string calldata agent,
        string calldata target,
        string calldata findingType,
        uint8 severity,
        bytes32 digest,
        string calldata note
    ) external onlyRecorder {
        emit ObservationRecorded(scanId, agent, target, findingType, severity, digest, note, block.timestamp);
    }
}
