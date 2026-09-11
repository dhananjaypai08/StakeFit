// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @title StakeFitMarket
/// @notice Sepolia source of truth for heats. HBAR pots settle on Hedera;
///         this contract only records entries, times, and resolutions so The
///         Graph / Substreams / CRE / VRF can consume them.
contract StakeFitMarket is Owned {
    address public forwarder;
    address public vrfCoordinator;
    uint256 public vrfSubscriptionId;
    bytes32 public keyHash;
    uint64 public nextMarketId = 1;
    uint256 public nextRequestId = 1;

    struct Market {
        bytes32 distanceId;
        uint64 startTs;
        uint64 endTs;
        uint32 graceSec;
        bool hidden;
        uint16 houseBps;
        uint64 entryTinybars;
        bool resolved;
        uint256 vrfSeed;
        uint32 entryCount;
        address first;
        address second;
        address third;
        uint64 firstTimeMs;
        uint64 secondTimeMs;
        uint64 thirdTimeMs;
    }

    struct Entry {
        bool paid;
        address hederaHint;
        bytes32 paymentRef;
        bool hasResult;
        uint64 timeMs;
        bytes32 exerciseId;
    }

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Entry)) public entries;
    mapping(uint256 => uint256) public requestToMarket;

    event ForwarderSet(address indexed forwarder);
    event VrfConfigured(address indexed coordinator, uint256 subscriptionId, bytes32 keyHash);
    event MarketCreated(
        uint256 indexed marketId,
        bytes32 distanceId,
        uint64 startTs,
        uint64 endTs,
        uint32 graceSec,
        bool hidden,
        uint16 houseBps,
        uint64 entryTinybars
    );
    event Entered(uint256 indexed marketId, address indexed user, bytes32 paymentRef, address hederaHint);
    event ResultSubmitted(uint256 indexed marketId, address indexed user, bool hasResult, uint64 timeMs, bytes32 exerciseId);
    event ResolveRequested(uint256 indexed marketId, uint256 requestId);
    event Resolved(
        uint256 indexed marketId,
        address first,
        address second,
        address third,
        uint64 firstTimeMs,
        uint64 secondTimeMs,
        uint64 thirdTimeMs,
        uint256 vrfSeed
    );

    error NotAuthorized();
    error UnknownMarket();
    error AlreadyResolved();
    error AlreadyEntered();
    error NotEntered();
    error BadWindow();
    error BadHouse();

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != forwarder) revert NotAuthorized();
        _;
    }

    function setForwarder(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        forwarder = next;
        emit ForwarderSet(next);
    }

    function setVrf(address coordinator, uint256 subscriptionId, bytes32 nextKeyHash) external onlyOwner {
        vrfCoordinator = coordinator;
        vrfSubscriptionId = subscriptionId;
        keyHash = nextKeyHash;
        emit VrfConfigured(coordinator, subscriptionId, nextKeyHash);
    }

    function createMarket(
        bytes32 distanceId,
        uint64 startTs,
        uint64 endTs,
        uint32 graceSec,
        bool hidden,
        uint16 houseBps,
        uint64 entryTinybars
    ) external onlyOwner returns (uint256 marketId) {
        if (endTs <= startTs) revert BadWindow();
        if (houseBps > 10_000) revert BadHouse();
        marketId = nextMarketId++;
        markets[marketId] = Market({
            distanceId: distanceId,
            startTs: startTs,
            endTs: endTs,
            graceSec: graceSec,
            hidden: hidden,
            houseBps: houseBps,
            entryTinybars: entryTinybars,
            resolved: false,
            vrfSeed: 0,
            entryCount: 0,
            first: address(0),
            second: address(0),
            third: address(0),
            firstTimeMs: 0,
            secondTimeMs: 0,
            thirdTimeMs: 0
        });
        emit MarketCreated(marketId, distanceId, startTs, endTs, graceSec, hidden, houseBps, entryTinybars);
    }

    function recordEntry(uint256 marketId, address user, address hederaHint, bytes32 paymentRef) external onlyAuthorized {
        Market storage market = markets[marketId];
        if (market.endTs == 0) revert UnknownMarket();
        if (market.resolved) revert AlreadyResolved();
        Entry storage entry = entries[marketId][user];
        if (entry.paid) revert AlreadyEntered();
        entry.paid = true;
        entry.hederaHint = hederaHint;
        entry.paymentRef = paymentRef;
        market.entryCount += 1;
        emit Entered(marketId, user, paymentRef, hederaHint);
    }

    function submitResult(uint256 marketId, address user, uint64 timeMs, bytes32 exerciseId) external onlyAuthorized {
        Market storage market = markets[marketId];
        if (market.endTs == 0) revert UnknownMarket();
        if (market.resolved) revert AlreadyResolved();
        Entry storage entry = entries[marketId][user];
        if (!entry.paid) revert NotEntered();
        entry.hasResult = true;
        entry.timeMs = timeMs;
        entry.exerciseId = exerciseId;
        emit ResultSubmitted(marketId, user, true, market.hidden ? 0 : timeMs, exerciseId);
    }

    /// @notice Ask Chainlink VRF for a seed. If no coordinator is set, the
    ///         owner may immediately `fulfillResolveSeed`.
    function requestResolve(uint256 marketId) external onlyAuthorized returns (uint256 requestId) {
        Market storage market = markets[marketId];
        if (market.endTs == 0) revert UnknownMarket();
        if (market.resolved) revert AlreadyResolved();
        requestId = nextRequestId++;
        requestToMarket[requestId] = marketId;
        emit ResolveRequested(marketId, requestId);
        if (vrfCoordinator != address(0)) {
            (bool ok,) = vrfCoordinator.call(
                abi.encodeWithSignature(
                    "requestRandomWords(bytes32,uint256,uint16,uint32,uint32)",
                    keyHash,
                    vrfSubscriptionId,
                    uint16(3),
                    uint32(200_000),
                    uint32(1)
                )
            );
            if (!ok) {
                // Coordinator may be VRF 2.5; orchestrator still has adminResolve.
            }
        }
    }

    function fulfillResolveSeed(uint256 marketId, uint256 seed) external onlyAuthorized {
        Market storage market = markets[marketId];
        if (market.endTs == 0) revert UnknownMarket();
        market.vrfSeed = seed;
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != vrfCoordinator && msg.sender != owner) revert NotAuthorized();
        uint256 marketId = requestToMarket[requestId];
        if (marketId == 0) revert UnknownMarket();
        if (randomWords.length > 0) markets[marketId].vrfSeed = randomWords[0];
    }

    function resolve(
        uint256 marketId,
        address first,
        address second,
        address third,
        uint64 firstTimeMs,
        uint64 secondTimeMs,
        uint64 thirdTimeMs
    ) external onlyAuthorized {
        _resolve(marketId, first, second, third, firstTimeMs, secondTimeMs, thirdTimeMs);
    }

    /// @notice Demo override. Same events as the scheduled CRE + VRF path.
    function adminResolve(
        uint256 marketId,
        address first,
        address second,
        address third,
        uint64 firstTimeMs,
        uint64 secondTimeMs,
        uint64 thirdTimeMs
    ) external onlyOwner {
        _resolve(marketId, first, second, third, firstTimeMs, secondTimeMs, thirdTimeMs);
    }

    function _resolve(
        uint256 marketId,
        address first,
        address second,
        address third,
        uint64 firstTimeMs,
        uint64 secondTimeMs,
        uint64 thirdTimeMs
    ) internal {
        Market storage market = markets[marketId];
        if (market.endTs == 0) revert UnknownMarket();
        if (market.resolved) revert AlreadyResolved();
        market.resolved = true;
        market.first = first;
        market.second = second;
        market.third = third;
        market.firstTimeMs = firstTimeMs;
        market.secondTimeMs = secondTimeMs;
        market.thirdTimeMs = thirdTimeMs;
        emit Resolved(marketId, first, second, third, firstTimeMs, secondTimeMs, thirdTimeMs, market.vrfSeed);
    }

    function getResolution(uint256 marketId)
        external
        view
        returns (bool resolved, address first, address second, address third, uint64 firstTimeMs, uint256 vrfSeed)
    {
        Market storage market = markets[marketId];
        return (market.resolved, market.first, market.second, market.third, market.firstTimeMs, market.vrfSeed);
    }
}
