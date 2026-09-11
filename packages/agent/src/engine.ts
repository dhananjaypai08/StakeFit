import {
  type BeliefState,
  type Finding,
  type Observation,
  type ScanEvent,
  type Severity,
  type TargetKind,
  type ToolCall,
  type ToolResult,
} from "@stakefit/shared";
import { BrowserSandbox, NOISE_URL } from "./browser";
import { runPassiveChecks, toFinding } from "./checks";
import type { GraphClient } from "./graph";
import { LlmClient, type LlmMessage } from "./llm";

export interface ObservationRecorder {
  /** Persist an observation on-chain (ObservationLog) so the subgraph indexes it. */
  record(observation: Observation): Promise<{ txHash?: string }>;
}

export interface ScanResult {
  belief: BeliefState;
  findings: Finding[];
  observations: Observation[];
  graphIntel: string[];
}

export interface EngineOptions {
  scanId: string;
  target: string;
  kind: TargetKind;
  agentId: string;
  ensName?: string;
  contract?: string;
  maxSteps?: number;
  llm: LlmClient;
  graph: GraphClient;
  recorder?: ObservationRecorder;
  emit: (event: ScanEvent) => void;
}

const SYSTEM_PROMPT = `You are StakeFit, an autonomous adversary emulation agent performing an authorized security assessment of a single target you are allowed to test.
You operate a real headless browser and reason step by step. Each turn you pick exactly one tool.
You must stay non-destructive: do not attempt data deletion, account takeover, or denial of service. Enumerate, observe, and test hypotheses safely.
Go deep before finishing. Drive the real page: scroll it, click visible buttons and nav links, open in-app routes, inspect forms, then probe APIs. A scan that only reads DOM or network is incomplete. Ignore telemetry, analytics, fonts, and Next.js static chunks. Do not call finish while unvisited same-origin links or unclicked controls remain.
Tools:
- navigate {url}: load a same-origin page, including outlinks you discovered
- click {selector, text}: click a visible control. Prefer text of a button or link
- scroll {direction}: scroll the live viewport down or up so the page actually moves
- fill {selector, value}
- submit {selector}
- readDom {}: read current HTML
- listLinks {}: list same-origin anchors still worth visiting
- listEndpoints {}: list discovered API endpoints
- readNetwork {}: recent network activity
- readConsole {}: recent console output
- probe {url, method, headers, body}: send a crafted request within the target origin
- querySubgraph {subgraphId, query, variables}: read live on-chain data from The Graph to enrich a web3 target or recall prior findings
- recordObservation {findingType, severity, note}: persist a significant observation to The Graph so future steps and scans can recall it
- finish {}: end the assessment
Respond ONLY with a JSON object: {"thought": string, "tool": string, "args": object, "reason": string}.`;

function isTelemetry(url: string): boolean {
  return NOISE_URL.test(url);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class StakeFitAgent {
  private readonly belief: BeliefState;
  private readonly findings: Finding[] = [];
  private readonly observations: Observation[] = [];
  private readonly graphIntel: string[] = [];
  private readonly transcript: string[] = [];

  constructor(private readonly opts: EngineOptions) {
    this.belief = {
      target: opts.target,
      kind: opts.kind,
      routes: [],
      endpoints: [],
      forms: [],
      fingerprint: {},
      contract: opts.contract,
      notes: [],
    };
  }

  private now(): number {
    return Date.now();
  }

  private emitThought(text: string): void {
    this.opts.emit({ type: "agent.thought", scanId: this.opts.scanId, agent: this.opts.agentId, text, at: this.now() });
  }

  async run(): Promise<ScanResult> {
    const originHost = this.hostOf(this.opts.target);
    const sandbox = new BrowserSandbox({
      originAllowlist: [originHost],
      screencast: true,
      callbacks: {
        onFrame: (jpegBase64) =>
          this.opts.emit({ type: "browser.frame", scanId: this.opts.scanId, agent: this.opts.agentId, jpegBase64, at: this.now() }),
        onNetwork: (n) => {
          if (n.resourceType !== "xhr" && n.resourceType !== "fetch" && n.resourceType !== "document") return;
          if (isTelemetry(n.url)) return;
          this.opts.emit({ type: "network.entry", scanId: this.opts.scanId, method: n.method, url: n.url, status: n.status, at: n.at });
        },
        onConsole: (c) =>
          this.opts.emit({ type: "console.entry", scanId: this.opts.scanId, level: c.level, text: c.text, at: c.at }),
      },
    });

    await sandbox.start();
    try {
      // Perceive: load the target.
      const navSummary = await sandbox.navigate(this.startUrl());
      this.transcript.push(`navigate: ${navSummary}`);
      await this.probeCommonPaths(sandbox);

      // Recall: query The Graph memory subgraph before probing.
      const memory = await this.opts.graph.recallMemory(this.opts.target);
      this.graphIntel.push(memory);
      this.opts.emit({ type: "graph.read", scanId: this.opts.scanId, query: "recallMemory", summary: memory, at: this.now() });
      if (this.opts.kind === "web3" && this.opts.contract) {
        const enrich = await this.opts.graph.enrichTarget(this.opts.contract);
        this.graphIntel.push(enrich);
        this.opts.emit({ type: "graph.read", scanId: this.opts.scanId, query: "enrichTarget", summary: enrich, at: this.now() });
      }

      // Baseline passive checks.
      const dom0 = await sandbox.readDom();
      const passive = runPassiveChecks({
        scanId: this.opts.scanId,
        dom: dom0,
        endpoints: sandbox.listEndpoints(),
        network: sandbox.readNetwork(),
        console: sandbox.readConsole(),
      });
      for (const p of passive) this.addFinding(toFinding(this.opts.scanId, p, this.findings.length));

      // Tight loop.
      const maxSteps = this.opts.maxSteps ?? 20;
      for (let step = 0; step < maxSteps; step += 1) {
        const call = await this.plan(sandbox, step, maxSteps);
        this.emitThought(call.thought || call.reason);
        this.opts.emit({ type: "agent.action", scanId: this.opts.scanId, agent: this.opts.agentId, call, at: this.now() });
        if (call.tool === "finish") break;
        const result = await this.execute(sandbox, call);
        this.opts.emit({ type: "agent.observation", scanId: this.opts.scanId, agent: this.opts.agentId, result, at: this.now() });
        this.transcript.push(`${call.tool}: ${result.summary}`);
      }

      // Synthesize findings from the transcript.
      await this.synthesizeFindings();
    } finally {
      await sandbox.stop();
    }

    return { belief: this.belief, findings: this.findings, observations: this.observations, graphIntel: this.graphIntel };
  }

  private async probeCommonPaths(sandbox: BrowserSandbox): Promise<void> {
    const origin = new URL(this.startUrl()).origin;
    const paths = [
      "/robots.txt",
      "/sitemap.xml",
      "/.well-known/security.txt",
      "/api/health",
      "/api/auth/session",
      "/api/auth/providers",
      "/api/better-auth/ok",
      "/api/better-auth/get-session",
      "/api/better-auth/session",
    ];
    for (const path of paths) {
      try {
        const res = await sandbox.probe(`${origin}${path}`, { method: "GET" });
        this.transcript.push(`probe: ${path} ${res.status}`);
      } catch {
        // keep baseline recon best-effort
      }
    }
  }

  private startUrl(): string {
    return this.opts.target.includes("://") ? this.opts.target : `https://${this.opts.target}`;
  }

  private hostOf(target: string): string {
    try {
      return new URL(target.includes("://") ? target : `https://${target}`).hostname;
    } catch {
      return target;
    }
  }

  private addFinding(finding: Finding): void {
    this.findings.push(finding);
    this.opts.emit({ type: "finding.added", scanId: this.opts.scanId, finding, at: this.now() });
  }

  private async pickClickOrFill(sandbox: BrowserSandbox, thought: string, reason: string): Promise<ToolCall> {
    const fields = await sandbox.listFields();
    const email = fields.find((field) => /email|user|login/i.test(`${field.type} ${field.name}`));
    if (email && !this.transcript.some((line) => line.startsWith("fill:"))) {
      return {
        tool: "fill",
        args: { selector: email.selector, value: "auditor@stakefit.invalid" },
        reason: `Fill ${email.name} so the auth form can be exercised.`,
        thought,
      };
    }
    const actions = await sandbox.listActions();
    const preferred =
      actions.find((action) => /continue|sign in|log in|next|github|google|wallet|contact/i.test(action.text)) ??
      actions[0];
    if (preferred) {
      return {
        tool: "click",
        args: { text: preferred.text, selector: preferred.selector },
        reason: `${reason} Click "${preferred.text}".`,
        thought,
      };
    }
    return {
      tool: "scroll",
      args: { direction: "down" },
      reason: `${reason} Scroll the current page.`,
      thought,
    };
  }

  private async forceInteract(
    sandbox: BrowserSandbox,
    tool: ToolCall["tool"],
    args: Record<string, unknown>,
    step: number,
    maxSteps: number,
    leftover: string[],
    thought: string,
  ): Promise<ToolCall | undefined> {
    if (step >= maxSteps - 1) return undefined;
    if (tool === "click" || tool === "scroll" || tool === "fill" || tool === "submit") return undefined;

    if (tool === "navigate") {
      const dest = String(args.url ?? "");
      if (!dest || sandbox.hasVisited(dest) || sandbox.samePage(dest)) {
        return this.pickClickOrFill(sandbox, thought, "Do not reload the same page.");
      }
      return undefined;
    }

    const recent = this.transcript.slice(-3).join(" ");
    const navigatedTooMuch = (recent.match(/navigate:/g) ?? []).length >= 2;
    const clicked = /click:|fill:|submit:/.test(recent);
    if (navigatedTooMuch || !clicked || tool === "finish") {
      if (tool === "finish" && leftover[0] && clicked) {
        return {
          tool: "navigate",
          args: { url: leftover[0] },
          reason: `Open unvisited route ${leftover[0]}`,
          thought,
        };
      }
      return this.pickClickOrFill(sandbox, thought, "Interact with the live page instead of only reading it.");
    }
    return undefined;
  }

  /** Choose the next action, via the reasoning model when available. */
  private async plan(sandbox: BrowserSandbox, step: number, maxSteps: number): Promise<ToolCall> {
    if (this.opts.llm.available) {
      try {
        const messages: LlmMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              `Target: ${this.opts.target} (${this.opts.kind})`,
              this.opts.contract ? `Contract: ${this.opts.contract}` : "",
              `Graph intel so far: ${this.graphIntel.join(" | ") || "none"}`,
              `Discovered endpoints: ${sandbox.listEndpoints().slice(0, 20).join(", ") || "none"}`,
              `Same-origin links: ${sandbox.listLinks().slice(0, 16).join(", ") || "none"}`,
              `Unvisited links: ${sandbox.unvisitedLinks().slice(0, 12).join(", ") || "none"}`,
              `Clickable controls: ${(await sandbox.listActions()).slice(0, 10).map((a) => a.text).join(" | ") || "none"}`,
              `Recent steps: ${this.transcript.slice(-8).join(" | ") || "none"}`,
              `Findings so far: ${this.findings.length}`,
              `Step ${step + 1} of ${maxSteps}. Prefer click/scroll/navigate over read-only tools. Do not finish while work remains.`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ];
        const raw = await this.opts.llm.chat(messages, { json: true, temperature: 0.3 });
        const obj = parseJsonObject(raw);
        if (obj && typeof obj.tool === "string") {
          const tool = obj.tool as ToolCall["tool"];
          const leftover = sandbox.unvisitedLinks();
          const thought = String(obj.thought ?? obj.reason ?? "planning next step");
          const forced = await this.forceInteract(
            sandbox,
            tool,
            (obj.args as Record<string, unknown>) ?? {},
            step,
            maxSteps,
            leftover,
            thought,
          );
          if (forced) return forced;
          if (tool === "finish" && step < maxSteps - 1) {
            if (leftover[0]) {
              return {
                tool: "navigate",
                args: { url: leftover[0] },
                reason: `Still have unvisited same-origin links. Opening ${leftover[0]}`,
                thought,
              };
            }
            if (step < Math.min(12, maxSteps - 1)) {
              return {
                tool: "listLinks",
                args: {},
                reason: "Too early to finish. Enumerate outlinks and keep walking the app.",
                thought,
              };
            }
          }
          return {
            tool,
            args: (obj.args as Record<string, unknown>) ?? {},
            reason: String(obj.reason ?? obj.thought ?? "reasoning"),
            thought,
          };
        }
      } catch (err) {
        this.emitThought(`model planning failed, falling back to heuristic: ${(err as Error).message}`);
      }
    }
    return this.heuristicPlan(sandbox, step);
  }

  /** Deterministic recon plan used when no model key is present. */
  private heuristicPlan(sandbox: BrowserSandbox, step: number): ToolCall {
    const endpoints = sandbox.listEndpoints();
    const leftover = sandbox.unvisitedLinks();
    switch (step) {
      case 0:
        return { tool: "scroll", args: { direction: "down" }, reason: "Scroll the landing page so the live view moves." };
      case 1:
        return { tool: "listLinks", args: {}, reason: "Collect same-origin outlinks before probing." };
      case 2:
        return { tool: "click", args: { text: "Learn" }, reason: "Click a visible marketing control if present." };
      case 3:
        return leftover[0]
          ? { tool: "navigate", args: { url: leftover[0] }, reason: `Follow same-origin link ${leftover[0]}` }
          : { tool: "readNetwork", args: {}, reason: "Inspect recent network traffic." };
      case 4:
        return leftover[0]
          ? { tool: "navigate", args: { url: leftover[0] }, reason: `Follow another same-origin link ${leftover[0]}` }
          : { tool: "readConsole", args: {}, reason: "Check console for leaked errors." };
      case 5:
        return endpoints.length > 0
          ? { tool: "probe", args: { url: endpoints[0].split(" ")[1], method: "GET" }, reason: "Probe the first discovered endpoint." }
          : { tool: "screenshot", args: {}, reason: "Capture a screenshot of the current view." };
      case 6:
        return leftover[0]
          ? { tool: "navigate", args: { url: leftover[0] }, reason: `Keep walking the site: ${leftover[0]}` }
          : {
              tool: "recordObservation",
              args: { findingType: "recon", severity: "info", note: `Enumerated ${endpoints.length} endpoints on ${this.opts.target}` },
              reason: "Persist the recon summary to The Graph as memory.",
            };
      default:
        if (leftover[0] && step < 16) {
          return { tool: "navigate", args: { url: leftover[0] }, reason: `Unvisited outlink remains: ${leftover[0]}` };
        }
        return { tool: "finish", args: {}, reason: "Recon complete." };
    }
  }

  private async execute(sandbox: BrowserSandbox, call: ToolCall): Promise<ToolResult> {
    const a = call.args ?? {};
    try {
      switch (call.tool) {
        case "navigate":
          return this.ok(call.tool, await sandbox.navigate(String(a.url ?? this.startUrl())));
        case "click":
          return this.ok(
            call.tool,
            await sandbox.click(a.selector ? String(a.selector) : undefined, a.text ? String(a.text) : undefined),
          );
        case "scroll":
          return this.ok(call.tool, await sandbox.scroll(a.direction ? String(a.direction) : "down"));
        case "fill":
          return this.ok(call.tool, await sandbox.fill(String(a.selector), String(a.value ?? "")));
        case "submit":
          return this.ok(call.tool, await sandbox.submit(String(a.selector)));
        case "readDom": {
          const dom = await sandbox.readDom();
          return this.ok(call.tool, `read ${dom.length} chars of DOM`, dom.slice(0, 1200));
        }
        case "listEndpoints": {
          const e = sandbox.listEndpoints();
          this.belief.endpoints = e;
          return this.ok(call.tool, `${e.length} endpoints`, e);
        }
        case "listLinks": {
          const links = sandbox.listLinks();
          this.belief.routes = links;
          return this.ok(call.tool, `${links.length} links, ${sandbox.unvisitedLinks().length} unvisited`, {
            links,
            unvisited: sandbox.unvisitedLinks(),
          });
        }
        case "readNetwork":
          return this.ok(call.tool, "recent network", sandbox.readNetwork());
        case "readConsole":
          return this.ok(call.tool, "recent console", sandbox.readConsole());
        case "probe": {
          const res = await sandbox.probe(String(a.url), {
            method: a.method ? String(a.method) : "GET",
            headers: (a.headers as Record<string, string>) ?? undefined,
            body: a.body ? String(a.body) : undefined,
          });
          return this.ok(call.tool, `probe status ${res.status}`, res);
        }
        case "screenshot":
          return this.ok(call.tool, "screenshot captured", { jpegBase64: (await sandbox.screenshot()).slice(0, 40) + "..." });
        case "querySubgraph": {
          const summary = await this.handleQuerySubgraph(a);
          return this.ok(call.tool, summary);
        }
        case "recordObservation": {
          const summary = await this.handleRecordObservation(a);
          return this.ok(call.tool, summary);
        }
        case "finish":
          return this.ok(call.tool, "finished");
        default:
          return { tool: call.tool, ok: false, summary: `unknown tool ${call.tool}` };
      }
    } catch (err) {
      return { tool: call.tool, ok: false, summary: `error: ${(err as Error).message}` };
    }
  }

  private async handleQuerySubgraph(a: Record<string, unknown>): Promise<string> {
    const subgraphId = String(a.subgraphId ?? "");
    const query = String(a.query ?? "");
    if (!subgraphId || !query) return "querySubgraph requires subgraphId and query";
    try {
      const data = await this.opts.graph.query(subgraphId, query, (a.variables as Record<string, unknown>) ?? {});
      const summary = `subgraph ${subgraphId} returned ${JSON.stringify(data).slice(0, 400)}`;
      this.graphIntel.push(summary);
      this.opts.emit({ type: "graph.read", scanId: this.opts.scanId, query, summary, at: this.now() });
      return summary;
    } catch (err) {
      return `querySubgraph failed: ${(err as Error).message}`;
    }
  }

  private async handleRecordObservation(a: Record<string, unknown>): Promise<string> {
    const observation: Observation = {
      scanId: this.opts.scanId,
      agent: this.opts.ensName ?? this.opts.agentId,
      target: this.opts.target,
      findingType: String(a.findingType ?? "observation"),
      severity: (String(a.severity ?? "info") as Severity),
      note: String(a.note ?? ""),
      digest: this.digest(`${this.opts.scanId}:${String(a.note ?? "")}`),
      createdAt: this.now(),
    };
    this.observations.push(observation);
    let txHash: string | undefined;
    if (this.opts.recorder) {
      try {
        const res = await this.opts.recorder.record(observation);
        txHash = res.txHash;
      } catch (err) {
        this.emitThought(`observation record failed: ${(err as Error).message}`);
      }
    }
    this.opts.emit({ type: "graph.write", scanId: this.opts.scanId, observation, txHash, at: this.now() });
    return `recorded observation ${observation.findingType} (${observation.severity})`;
  }

  private async synthesizeFindings(): Promise<void> {
    if (!this.opts.llm.available) return;
    try {
      const raw = await this.opts.llm.chat(
        [
          {
            role: "system",
            content:
              "You are a senior security analyst. From the assessment transcript, output a JSON object {\"findings\": Finding[]} where each Finding has title, category, severity (info|low|medium|high|critical), confidence (0..1), description, evidence, location, remediation. Only include findings supported by the transcript.",
          },
          {
            role: "user",
            content: `Target: ${this.opts.target}\nGraph intel: ${this.graphIntel.join(" | ")}\nTranscript:\n${this.transcript.join("\n")}`,
          },
        ],
        { json: true, temperature: 0.1 },
      );
      const obj = parseJsonObject(raw);
      const list = (obj?.findings as unknown[]) ?? [];
      for (const item of list) {
        const f = item as Partial<Finding>;
        if (!f.title) continue;
        this.addFinding({
          id: `${this.opts.scanId}-f${this.findings.length}`,
          scanId: this.opts.scanId,
          title: String(f.title),
          category: String(f.category ?? "General"),
          severity: (f.severity as Severity) ?? "info",
          confidence: typeof f.confidence === "number" ? f.confidence : 0.5,
          description: String(f.description ?? ""),
          evidence: String(f.evidence ?? ""),
          location: String(f.location ?? this.opts.target),
          remediation: String(f.remediation ?? ""),
          createdAt: this.now(),
        });
      }
    } catch (err) {
      this.emitThought(`finding synthesis failed: ${(err as Error).message}`);
    }
  }

  private ok(tool: ToolResult["tool"], summary: string, data?: unknown): ToolResult {
    return { tool, ok: true, summary, data };
  }

  private digest(input: string): string {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
    }
    return `0x${(h >>> 0).toString(16).padStart(8, "0")}`;
  }
}
