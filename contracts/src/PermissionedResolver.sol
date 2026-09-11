// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @title PermissionedResolver
/// @notice A per-account ENSv2 style resolver. Records are stored per node, and
///         Enhanced Access Control (EAC) lets the owner delegate edit rights on
///         individual text keys without granting anything else.
contract PermissionedResolver is Owned {
    uint256 public constant ROLE_CAN_SET_TEXT = 1 << 4;

    mapping(bytes32 => mapping(string => string)) private _text;
    mapping(bytes32 => bytes) private _contenthash;
    mapping(bytes32 => address) private _addr;

    // node => keccak(key) => account => granted
    mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) private _textRole;

    event TextChanged(bytes32 indexed node, string key, string value);
    event ContenthashChanged(bytes32 indexed node, bytes hash);
    event AddrChanged(bytes32 indexed node, address a);
    event TextRoleAuthorized(bytes32 indexed node, string key, address indexed account, uint256 roleBitmap);

    error EACUnauthorizedAccountRoles();

    function _canSetText(bytes32 node, string calldata key) internal view returns (bool) {
        if (msg.sender == owner) return true;
        return _textRole[node][keccak256(bytes(key))][msg.sender];
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        if (!_canSetText(node, key)) revert EACUnauthorizedAccountRoles();
        _text[node][key] = value;
        emit TextChanged(node, key, value);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _text[node][key];
    }

    function setContenthash(bytes32 node, bytes calldata hash) external onlyOwner {
        _contenthash[node] = hash;
        emit ContenthashChanged(node, hash);
    }

    function contenthash(bytes32 node) external view returns (bytes memory) {
        return _contenthash[node];
    }

    function setAddr(bytes32 node, address a) external onlyOwner {
        _addr[node] = a;
        emit AddrChanged(node, a);
    }

    function addr(bytes32 node) external view returns (address) {
        return _addr[node];
    }

    /// @notice Delegate edit rights on a single text key (EAC style).
    function authorizeTextRoles(bytes32 node, string calldata key, address account, uint256 roleBitmap) external onlyOwner {
        bool granted = (roleBitmap & ROLE_CAN_SET_TEXT) != 0;
        _textRole[node][keccak256(bytes(key))][account] = granted;
        emit TextRoleAuthorized(node, key, account, roleBitmap);
    }

    function hasTextRole(bytes32 node, string calldata key, address account) external view returns (bool) {
        return _textRole[node][keccak256(bytes(key))][account];
    }
}
