// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @title StakeFitRegistrar
/// @notice An ENSv2 style subname registrar for the StakeFit parent name. It
///         mints per-agent subnames that are expiring and revocable, each
///         pointing at a Permissioned Resolver so agents own their own records.
contract StakeFitRegistrar is Owned {
    bytes32 public immutable parentNode;

    struct Subname {
        address owner;
        address resolver;
        uint64 expiry;
        bool exists;
    }

    mapping(bytes32 => Subname) private _subnames; // labelhash => record

    event SubnameRegistered(string label, address indexed owner, address resolver, uint64 expiry);
    event SubnameRevoked(string label);

    error AlreadyRegistered();
    error NotRegistered();

    constructor(bytes32 parentNode_) {
        parentNode = parentNode_;
    }

    function _labelhash(string calldata label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    /// @notice Node of the full subname, matching off-chain ethers namehash.
    function nodeOf(string calldata label) external view returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, _labelhash(label)));
    }

    function register(string calldata label, address owner_, address resolver, uint64 duration)
        external
        onlyOwner
        returns (uint256 tokenId)
    {
        bytes32 lh = _labelhash(label);
        Subname storage rec = _subnames[lh];
        if (rec.exists && rec.expiry > block.timestamp) revert AlreadyRegistered();
        // block.timestamp fits in uint64 for the next several hundred billion years.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiry = uint64(block.timestamp) + duration;
        _subnames[lh] = Subname({owner: owner_, resolver: resolver, expiry: expiry, exists: true});
        emit SubnameRegistered(label, owner_, resolver, expiry);
        return uint256(lh);
    }

    function revoke(string calldata label) external onlyOwner {
        bytes32 lh = _labelhash(label);
        if (!_subnames[lh].exists) revert NotRegistered();
        delete _subnames[lh];
        emit SubnameRevoked(label);
    }

    function resolverOf(string calldata label) external view returns (address) {
        return _subnames[_labelhash(label)].resolver;
    }

    function ownerOfLabel(string calldata label) external view returns (address) {
        return _subnames[_labelhash(label)].owner;
    }

    function expiryOf(string calldata label) external view returns (uint64) {
        return _subnames[_labelhash(label)].expiry;
    }
}
