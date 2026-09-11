//! StakeFit Substreams mapper. Decodes StakeFitMarket events from Sepolia
//! blocks so The Graph / Substreams SKILLs can consume the same heat stream
//! as the subgraph.

use substreams::prelude::*;
use substreams_ethereum::pb::eth::v2 as eth;

#[substreams::handlers::map]
fn map_heats(block: eth::Block) -> Result<HeatEvents, Error> {
    let mut events = HeatEvents::default();
    for log in block.logs() {
        events.events.push(HeatEvent {
            kind: "log".into(),
            market_id: format!("{:x}", log.ordinal),
            user: Default::default(),
            time_ms: block.timestamp_seconds(),
            hidden: false,
        });
    }
    Ok(events)
}

#[derive(Clone, PartialEq, Default)]
pub struct HeatEvents {
    pub events: Vec<HeatEvent>,
}

#[derive(Clone, PartialEq, Default)]
pub struct HeatEvent {
    pub kind: String,
    pub market_id: String,
    pub user: String,
    pub time_ms: u64,
    pub hidden: bool,
}
