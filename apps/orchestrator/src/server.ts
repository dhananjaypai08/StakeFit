import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config";
import { EventHub } from "./eventHub";
import { ScanService } from "./scanService";
import { StakeFitService } from "./stakeFitService";
import { mountStakeFit } from "./stakeFitRoutes";
import { buildAccepts, priceForDepth, settlePayment } from "./x402gate";

export function createApp() {
  const config = loadConfig();
  const hub = new EventHub();
  const scanService = new ScanService(config, hub);
  const stakeFit = new StakeFitService(config);

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "stakefit-orchestrator", time: Date.now() });
  });

  mountStakeFit(app, config, stakeFit);
  stakeFit.startBackgroundSync();

  // Start a scan. Gated by x402 when a distinct SCAN_PAYTO_ACCOUNT is set.
  app.post("/scan", async (req, res) => {
    const target = String(req.body?.target ?? "").trim();
    const depth = Number(req.body?.depth ?? 12);
    const contract = req.body?.contract ? String(req.body.contract) : undefined;
    if (!target) {
      res.status(400).json({ error: "target is required" });
      return;
    }

    // TEMP: set SCAN_SKIP_PAYMENT=true to bypass the x402 gate while iterating.
    if (config.skipPayment) {
      const scanId = scanService.start({ target, depth, contract });
      res.json({ scanId, payment: { skipped: true } });
      return;
    }

    let accepts;
    try {
      accepts = await buildAccepts(config, priceForDepth(config, depth));
    } catch (err) {
      // Facilitator unreachable; fall back to open gate so the demo still runs.
      accepts = undefined;
      hub.publish({ type: "scan.error", scanId: "pre", message: `x402 setup skipped: ${(err as Error).message}`, at: Date.now() });
    }

    if (accepts) {
      const header = req.header("X-PAYMENT");
      if (!header) {
        res.status(402).json({ x402Version: 2, accepts: [accepts] });
        return;
      }
      const outcome = await settlePayment(header, accepts);
      if (!outcome.ok) {
        res.status(402).json({ x402Version: 2, accepts: [accepts], error: outcome.message });
        return;
      }
      const scanId = scanService.start({ target, depth, contract });
      res.json({ scanId, payment: { payer: outcome.payer, txHash: outcome.txHash } });
      return;
    }

    const scanId = scanService.start({ target, depth, contract });
    res.json({ scanId, payment: { open: true } });
  });

  app.get("/scan/:scanId/report", (req, res) => {
    const html = scanService.getReportHtml(req.params.scanId);
    if (!html) {
      res.status(404).type("text/plain").send("Report is not ready yet");
      return;
    }
    if (!scanService.isClaimed(req.params.scanId)) {
      res.status(402).json({ error: "Claim the report to open it", scanId: req.params.scanId });
      return;
    }
    res.type("html").send(html);
  });

  app.post("/scan/:scanId/claim", async (req, res) => {
    const report = scanService.getReport(req.params.scanId);
    if (!report) {
      res.status(404).json({ error: "scan not found or still running" });
      return;
    }
    if (!scanService.isClaimed(req.params.scanId) && !config.skipPayment) {
      let accepts;
      try {
        accepts = await buildAccepts(config, config.claimPriceTinybars);
      } catch (err) {
        accepts = undefined;
        hub.publish({
          type: "scan.error",
          scanId: report.scanId,
          message: `claim payment skipped: ${(err as Error).message}`,
          at: Date.now(),
        });
      }
      if (accepts) {
        const header = req.header("X-PAYMENT");
        if (!header) {
          res.status(402).json({ x402Version: 2, accepts: [accepts] });
          return;
        }
        const outcome = await settlePayment(header, accepts);
        if (!outcome.ok) {
          res.status(402).json({ x402Version: 2, accepts: [accepts], error: outcome.message });
          return;
        }
      }
    }
    scanService.claim(req.params.scanId);
    const reportUrl = `/scan/${report.scanId}/report`;
    const ipfsUrl = report.reportCid
      ? `https://gateway.pinata.cloud/ipfs/${report.reportCid}/report.html`
      : undefined;
    res.json({
      claimed: true,
      reportUrl,
      ipfsUrl,
      cid: report.reportCid,
      ensName: report.ensName,
      certTokenId: report.certificateTokenId,
      certSerial: report.certificateSerial,
    });
  });

  app.post("/scan/:scanId/certificate", async (req, res) => {
    const report = scanService.getReport(req.params.scanId);
    if (!report) {
      res.status(404).json({ error: "scan not found or still running" });
      return;
    }
    if (report.certificateTokenId && report.certificateSerial) {
      res.json({ tokenId: report.certificateTokenId, serial: report.certificateSerial });
      return;
    }
    try {
      const { mintCertificate, hasHederaCredentials, loadHederaConfig, makeClient } = await import("@stakefit/hedera");
      const hederaConfig = loadHederaConfig();
      if (!hasHederaCredentials(hederaConfig) || !hederaConfig.certificateTokenId) {
        res.status(400).json({ error: "Hedera certificate token is not configured" });
        return;
      }
      const client = makeClient(hederaConfig);
      try {
        const cert = await mintCertificate(client, hederaConfig, hederaConfig.certificateTokenId, {
          scanId: report.scanId,
          target: report.target,
          verdict: report.verdict,
          score: report.score,
          reportCid: report.reportCid,
        });
        report.certificateTokenId = hederaConfig.certificateTokenId;
        report.certificateSerial = cert.serial;
        hub.publish({
          type: "certificate.minted",
          scanId: report.scanId,
          tokenId: hederaConfig.certificateTokenId,
          serial: cert.serial,
          at: Date.now(),
        });
        res.json({ tokenId: hederaConfig.certificateTokenId, serial: cert.serial });
      } finally {
        client.close();
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Inputs the Chainlink CRE confidential workflow fetches inside the TEE.
  app.get("/cre/findings/:scanId", (req, res) => {
    const findings = scanService.getFindings(req.params.scanId).map((f) => ({
      category: f.category,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
    }));
    res.json(findings);
  });

  // Fuzz seed for the audit firewall. Wire this to Chainlink VRF for production;
  // it is served here so the confidential workflow can consume it as an input.
  app.get("/scan/:scanId/live", async (req, res) => {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=stakefit",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      Pragma: "no-cache",
    });

    let open = true;
    req.on("close", () => {
      open = false;
    });

    while (open) {
      const frame = (await hub.waitForFrame(req.params.scanId, 400)) ?? hub.latestFrame(req.params.scanId);
      if (!frame) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      try {
        res.write(`--stakefit\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write("\r\n");
      } catch {
        break;
      }
    }
    res.end();
  });

  app.get("/cre/vrf-seed", (req, res) => {
    const marketId = String(req.query.marketId ?? "");
    if (marketId) {
      const market = stakeFit.getMarket(marketId);
      res.type("text/plain").send(market?.vrfSeed ?? "0");
      return;
    }
    res.type("text/plain").send(String(Math.floor(Math.random() * 1_000_000)));
  });

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const scanId = url.searchParams.get("scanId");
    if (!scanId) {
      socket.close(1008, "scanId required");
      return;
    }
    hub.subscribe(scanId, socket);
    socket.on("close", () => hub.unsubscribe(scanId, socket));
  });

  return { server, config };
}
