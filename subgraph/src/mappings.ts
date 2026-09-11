import { Address, BigInt } from "@graphprotocol/graph-ts";
import { MarketCreated, Entered, ResultSubmitted, Resolved } from "../generated/StakeFitMarket/StakeFitMarket";
import { Market, Entry, Result, Resolution, Payout } from "../generated/schema";

export function handleMarketCreated(event: MarketCreated): void {
  const market = new Market(event.params.marketId.toString());
  market.distanceId = event.params.distanceId;
  market.startTs = event.params.startTs;
  market.endTs = event.params.endTs;
  market.graceSec = event.params.graceSec;
  market.hidden = event.params.hidden;
  market.houseBps = event.params.houseBps;
  market.entryTinybars = event.params.entryTinybars;
  market.resolved = false;
  market.vrfSeed = BigInt.fromI32(0);
  market.createdAt = event.block.timestamp;
  market.save();
}

export function handleEntered(event: Entered): void {
  const entry = new Entry(event.params.marketId.toString() + "-" + event.params.user.toHex());
  entry.market = event.params.marketId.toString();
  entry.user = event.params.user;
  entry.paymentRef = event.params.paymentRef;
  entry.hederaHint = event.params.hederaHint;
  entry.save();
}

export function handleResultSubmitted(event: ResultSubmitted): void {
  const result = new Result(event.params.marketId.toString() + "-" + event.params.user.toHex());
  result.market = event.params.marketId.toString();
  result.user = event.params.user;
  result.hasResult = event.params.hasResult;
  result.timeMs = event.params.timeMs.equals(BigInt.fromI32(0)) ? null : event.params.timeMs;
  result.exerciseId = event.params.exerciseId;
  result.save();
}

export function handleResolved(event: Resolved): void {
  const market = Market.load(event.params.marketId.toString());
  if (market) {
    market.resolved = true;
    market.first = event.params.first;
    market.second = event.params.second;
    market.third = event.params.third;
    market.firstTimeMs = event.params.firstTimeMs;
    market.vrfSeed = event.params.vrfSeed;
    market.save();
  }
  const resolution = new Resolution(event.params.marketId.toString());
  resolution.market = event.params.marketId.toString();
  resolution.first = event.params.first;
  resolution.second = event.params.second;
  resolution.third = event.params.third;
  resolution.firstTimeMs = event.params.firstTimeMs;
  resolution.secondTimeMs = event.params.secondTimeMs;
  resolution.thirdTimeMs = event.params.thirdTimeMs;
  resolution.vrfSeed = event.params.vrfSeed;
  resolution.resolvedAt = event.block.timestamp;
  resolution.save();
  savePayout(event.params.marketId.toString(), event.params.first, 1, event.params.firstTimeMs);
  savePayout(event.params.marketId.toString(), event.params.second, 2, event.params.secondTimeMs);
  savePayout(event.params.marketId.toString(), event.params.third, 3, event.params.thirdTimeMs);
}

function savePayout(marketId: string, user: Address, rank: i32, timeMs: BigInt): void {
  if (user.equals(Address.zero())) return;
  const payout = new Payout(`${marketId}-${rank.toString()}`);
  payout.market = marketId;
  payout.user = user;
  payout.rank = rank;
  payout.timeMs = timeMs;
  payout.save();
}
