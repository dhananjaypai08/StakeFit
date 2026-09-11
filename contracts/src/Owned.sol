// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ownable base without external dependencies.
abstract contract Owned {
    address public owner;

    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error ZeroAddress();

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}
