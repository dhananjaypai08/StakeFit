// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {StakeFitMarket} from "../src/StakeFitMarket.sol";

contract StakeFitMarketTest is Test {
    StakeFitMarket internal market;
    address internal alice = address(0xA11CE);

    function setUp() public {
        market = new StakeFitMarket();
    }

    function testCreateEnterSubmitHiddenOmitsTime() public {
        uint256 id = market.createMarket(bytes32("50m"), 100, 200, 900, true, 1000, 10_000);
        market.recordEntry(id, alice, address(0x1), bytes32("pay"));
        vm.recordLogs();
        market.submitResult(id, alice, 12_000, bytes32("ex1"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ResultSubmitted(uint256,address,bool,uint64,bytes32)");
        bool sawHidden;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (bool hasResult, uint64 timeMs,) = abi.decode(logs[i].data, (bool, uint64, bytes32));
                assertTrue(hasResult);
                assertEq(timeMs, 0);
                sawHidden = true;
            }
        }
        assertTrue(sawHidden);
    }

    function testLiveMarketEmitsTime() public {
        uint256 id = market.createMarket(bytes32("50m"), 100, 200, 900, false, 1000, 10_000);
        market.recordEntry(id, alice, address(0x1), bytes32("pay"));
        vm.recordLogs();
        market.submitResult(id, alice, 12_000, bytes32("ex1"));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("ResultSubmitted(uint256,address,bool,uint64,bytes32)");
        bool sawTime;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == topic) {
                (bool hasResult, uint64 timeMs,) = abi.decode(logs[i].data, (bool, uint64, bytes32));
                assertTrue(hasResult);
                assertEq(timeMs, 12_000);
                sawTime = true;
            }
        }
        assertTrue(sawTime);
    }

    function testAdminResolve() public {
        uint256 id = market.createMarket(bytes32("50m"), 100, 200, 900, false, 1000, 10_000);
        market.recordEntry(id, alice, address(0x1), bytes32("pay"));
        market.submitResult(id, alice, 9_000, bytes32("ex1"));
        market.adminResolve(id, alice, address(0), address(0), 9_000, 0, 0);
        (bool resolved, address first,, , uint64 firstTimeMs,) = market.getResolution(id);
        assertTrue(resolved);
        assertEq(first, alice);
        assertEq(firstTimeMs, 9_000);
    }

    function testCannotEnterTwice() public {
        uint256 id = market.createMarket(bytes32("50m"), 100, 200, 900, false, 1000, 10_000);
        market.recordEntry(id, alice, address(0x1), bytes32("pay"));
        vm.expectRevert(StakeFitMarket.AlreadyEntered.selector);
        market.recordEntry(id, alice, address(0x1), bytes32("pay2"));
    }
}
