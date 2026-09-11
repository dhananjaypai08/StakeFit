import "dotenv/config";
import { createApp } from "./server";

const { server, config } = createApp();
server.listen(config.port, () => {
  console.log(`StakeFit orchestrator listening on :${config.port}`);
});
