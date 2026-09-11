// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ObservationLog} from "../src/ObservationLog.sol";
import {AuditRegistry} from "../src/AuditRegistry.sol";
import {PermissionedResolver} from "../src/PermissionedResolver.sol";
import {StakeFitRegistrar} from "../src/StakeFitRegistrar.sol";
import {StakeFitMarket} from "../src/StakeFitMarket.sol";

/// @notice Deploys the StakeFit Sepolia stack. Safe to rerun: existing addresses
///         in the repo-root .env are reused, only missing contracts are created.
contract Deploy is Script {
    function run() external {
        _loadRepoEnv();

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        bytes32 ethNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        bytes32 parentNode = keccak256(abi.encodePacked(ethNode, keccak256("stakefit")));

        vm.startBroadcast(pk);

        ObservationLog observationLog = ObservationLog(_reuseOrCreate("OBSERVATION_LOG_ADDRESS", type(ObservationLog).creationCode, ""));
        AuditRegistry auditRegistry = AuditRegistry(_reuseOrCreate("AUDIT_REGISTRY_ADDRESS", type(AuditRegistry).creationCode, ""));
        PermissionedResolver resolver =
            PermissionedResolver(_reuseOrCreate("ENS_AUDIT_RESOLVER_ADDRESS", type(PermissionedResolver).creationCode, ""));
        StakeFitRegistrar registrar = StakeFitRegistrar(
            _reuseOrCreate("ENS_REGISTRAR_ADDRESS", type(StakeFitRegistrar).creationCode, abi.encode(parentNode))
        );
        StakeFitMarket stakeFit = StakeFitMarket(_reuseOrCreate("MARKET_REGISTRY_ADDRESS", type(StakeFitMarket).creationCode, ""));

        if (!observationLog.authorizedRecorder(deployer)) {
            observationLog.setRecorder(deployer, true);
        }

        vm.stopBroadcast();

        console2.log("OBSERVATION_LOG_ADDRESS=", address(observationLog));
        console2.log("AUDIT_REGISTRY_ADDRESS=", address(auditRegistry));
        console2.log("ENS_AUDIT_RESOLVER_ADDRESS=", address(resolver));
        console2.log("ENS_REGISTRAR_ADDRESS=", address(registrar));
        console2.log("MARKET_REGISTRY_ADDRESS=", address(stakeFit));
    }

    /// @dev Loads the monorepo root .env so `cd contracts && forge script` works
    ///      without a prior `source`. Shell-exported values win over the file.
    function _loadRepoEnv() internal {
        string memory path = string.concat(vm.projectRoot(), "/../.env");
        if (!vm.exists(path)) return;
        string memory raw = vm.replace(vm.readFile(path), "\r", "");
        string[] memory lines = vm.split(raw, "\n");
        for (uint256 i = 0; i < lines.length; i++) {
            string memory line = vm.trim(lines[i]);
            if (bytes(line).length == 0 || bytes(line)[0] == 0x23) continue;
            if (_startsWith(line, "export ")) line = vm.trim(_slice(line, 7));
            uint256 eq = _indexOf(line, 0x3d);
            if (eq == type(uint256).max) continue;
            string memory key = vm.trim(_sliceRange(line, 0, eq));
            string memory value = _unquote(vm.trim(_slice(line, eq + 1)));
            if (bytes(key).length == 0 || bytes(value).length == 0) continue;
            if (vm.envExists(key)) {
                try vm.envString(key) returns (string memory existing) {
                    if (bytes(existing).length > 0) continue;
                } catch {}
            }
            vm.setEnv(key, value);
        }
    }

    function _reuseOrCreate(string memory key, bytes memory creation, bytes memory args) internal returns (address deployed) {
        address existing = _optionalAddress(key);
        if (existing != address(0) && existing.code.length > 0) {
            console2.log("reusing", key);
            return existing;
        }
        bytes memory payload = args.length == 0 ? creation : bytes.concat(creation, args);
        assembly {
            deployed := create(0, add(payload, 0x20), mload(payload))
        }
        require(deployed != address(0), string.concat("create failed: ", key));
        console2.log("deployed", key);
    }

    function _optionalAddress(string memory key) internal view returns (address) {
        try vm.envString(key) returns (string memory raw) {
            raw = vm.trim(raw);
            if (bytes(raw).length != 42) return address(0);
            return vm.parseAddress(raw);
        } catch {
            return address(0);
        }
    }

    function _startsWith(string memory input, string memory prefix) internal pure returns (bool) {
        bytes memory a = bytes(input);
        bytes memory b = bytes(prefix);
        if (a.length < b.length) return false;
        for (uint256 i = 0; i < b.length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _indexOf(string memory input, bytes1 needle) internal pure returns (uint256) {
        bytes memory a = bytes(input);
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] == needle) return i;
        }
        return type(uint256).max;
    }

    function _slice(string memory input, uint256 start) internal pure returns (string memory) {
        return _sliceRange(input, start, bytes(input).length);
    }

    function _sliceRange(string memory input, uint256 start, uint256 end) internal pure returns (string memory) {
        bytes memory a = bytes(input);
        if (start >= a.length || end <= start) return "";
        if (end > a.length) end = a.length;
        bytes memory out = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = a[i];
        }
        return string(out);
    }

    function _unquote(string memory input) internal pure returns (string memory) {
        bytes memory a = bytes(input);
        if (a.length >= 2 && ((a[0] == 0x22 && a[a.length - 1] == 0x22) || (a[0] == 0x27 && a[a.length - 1] == 0x27))) {
            return _sliceRange(input, 1, a.length - 1);
        }
        return input;
    }
}
