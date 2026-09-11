/**
 * The Graph read side. This is half of the tight loop: the agent recalls prior
 * findings from the StakeFit memory subgraph and enriches web3 targets with
 * live external subgraph data. Reads go through The Graph gateway, which is a
 * live Graph provider (not mocked or local).
 */

export interface GraphConfig {
  gatewayApiKey?: string;
  /** Query URL of our authored StakeFit subgraph on Subgraph Studio. */
  stakefitSubgraphUrl?: string;
  gatewayBase?: string;
}

export function loadGraphConfig(env: NodeJS.ProcessEnv = process.env): GraphConfig {
  return {
    gatewayApiKey: env.GRAPH_GATEWAY_API_KEY || undefined,
    stakefitSubgraphUrl: env.STAKEFIT_SUBGRAPH_QUERY_URL || undefined,
    gatewayBase: env.GRAPH_GATEWAY_BASE ?? "https://gateway.thegraph.com/api",
  };
}

export interface GraphClient {
  available: boolean;
  /** Run a raw GraphQL query against a subgraph by deployment id. */
  query(subgraphId: string, query: string, variables?: Record<string, unknown>): Promise<unknown>;
  /** Recall what past scans found for a target (write side, read back). */
  recallMemory(target: string): Promise<string>;
  /** Enrich a web3 target contract with live external subgraph intel. */
  enrichTarget(contract: string): Promise<string>;
}

export class HttpGraphClient implements GraphClient {
  constructor(private readonly config: GraphConfig) {}

  get available(): boolean {
    return Boolean(this.config.gatewayApiKey || this.config.stakefitSubgraphUrl);
  }

  async query(subgraphId: string, query: string, variables?: Record<string, unknown>): Promise<unknown> {
    if (!this.config.gatewayApiKey) throw new Error("GRAPH_GATEWAY_API_KEY not set");
    const url = `${this.config.gatewayBase}/${this.config.gatewayApiKey}/subgraphs/id/${subgraphId}`;
    return this.post(url, query, variables);
  }

  async recallMemory(target: string): Promise<string> {
    if (!this.config.stakefitSubgraphUrl) {
      return "No StakeFit memory subgraph configured; this scan starts cold.";
    }
    const query = `
      query PastFindings($target: String!) {
        observations(where: { target: $target }, orderBy: createdAt, orderDirection: desc, first: 20) {
          id findingType severity note createdAt agent
        }
        audits(where: { target: $target }, orderBy: finishedAt, orderDirection: desc, first: 5) {
          id verdict score reportCid finishedAt
        }
      }`;
    try {
      const data = (await this.post(this.config.stakefitSubgraphUrl, query, { target })) as {
        observations?: Array<{ findingType: string; severity: string; note: string }>;
        audits?: Array<{ verdict: string; score: string; reportCid: string }>;
      };
      const obs = data.observations ?? [];
      const audits = data.audits ?? [];
      if (obs.length === 0 && audits.length === 0) return "No prior findings recorded for this target.";
      const obsText = obs.map((o) => `${o.severity} ${o.findingType}: ${o.note}`).join("; ");
      const auditText = audits.map((a) => `prior verdict ${a.verdict} score ${a.score}`).join("; ");
      return `Memory recall. ${auditText}. Known findings: ${obsText}`;
    } catch (err) {
      return `Memory recall failed: ${(err as Error).message}`;
    }
  }

  async enrichTarget(contract: string): Promise<string> {
    // Without a target specific subgraph id the agent supplies one via the
    // querySubgraph tool. This default surfaces the contract for the model to
    // reason about and prompts a follow up query.
    return `Web3 target contract ${contract}. Use querySubgraph with a relevant deployment id to pull tx history, proxy admin changes, and token flows.`;
  }

  private async post(url: string, query: string, variables?: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`subgraph query failed: ${res.status}`);
    const body = (await res.json()) as { data?: unknown; errors?: unknown };
    if (body.errors) throw new Error(`subgraph query errors: ${JSON.stringify(body.errors)}`);
    return body.data;
  }
}
