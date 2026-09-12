import "dotenv/config";
import { createApp } from "./server";

const { server, config } = createApp();
server.listen(config.port, "0.0.0.0", () => {
  console.log(`StakeFit orchestrator listening on :${config.port}`);
});
