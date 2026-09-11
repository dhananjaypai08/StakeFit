# StakeFit Substreams

Maps `StakeFitMarket` Sepolia events into a `HeatEvents` stream. Deploy with The Graph Market / Substreams CLI after `MARKET_REGISTRY_ADDRESS` is set in `subgraph.yaml`.

```
substreams build
substreams gui ./substreams.yaml map_heats -e sepolia.eth.streamingfast.io:443
```
