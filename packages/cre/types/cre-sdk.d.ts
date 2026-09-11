/**
 * Ambient shim for the Chainlink CRE TypeScript SDK.
 *
 * The real types ship with the CRE CLI toolchain (cre workflow simulate/deploy).
 * This declaration lets the workflow source typecheck inside the monorepo
 * without vendoring the SDK. Replace with the published SDK types when building
 * for a live deployment.
 */
declare module "@chainlink/cre-sdk" {
  export interface Secret {
    value: string;
  }

  export interface SecretRequest {
    id: string;
  }

  export interface Report {
    id: string;
    signature: string;
  }

  export interface HttpRequest {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }

  export interface HttpResponse {
    status: number;
    body: string;
  }

  export interface Runtime<Config = unknown> {
    config: Config;
    log(message: string): void;
  }

  export interface TeeRuntime<Config = unknown> extends Runtime<Config> {
    getSecret(request: SecretRequest): { result(): Secret };
    usingTheDons(): Runtime<Config>;
    reportFromDon(input: unknown): { result(): Report };
  }

  export interface Trigger {
    readonly _brand: "trigger";
  }

  export type TeeConstraint =
    | Record<string, never>
    | { regions: string[] }
    | Array<{ tee: string; regions: string[] }>;

  export interface HandlerEntry {
    readonly _brand: "handler";
  }

  export interface HttpClient {
    sendRequest(runtime: Runtime | TeeRuntime, req: HttpRequest): { result(): HttpResponse };
  }

  export interface EvmClient {
    writeReport(runtime: Runtime, input: { chain: string; address: string; report: Report; args: unknown[] }): { result(): { txHash: string } };
  }

  export interface Cron {
    trigger(schedule: string): Trigger;
  }

  export interface Cre {
    handlerInTee<Config = unknown>(
      trigger: Trigger,
      fn: (runtime: TeeRuntime<Config>, triggerOutput: unknown) => unknown,
      tees: TeeConstraint,
    ): HandlerEntry;
    handler<Config = unknown>(trigger: Trigger, fn: (runtime: Runtime<Config>, triggerOutput: unknown) => unknown): HandlerEntry;
    cron: Cron;
    HttpClient: new () => HttpClient;
    EvmClient: new (selector: string) => EvmClient;
  }

  export const cre: Cre;

  export interface Runner<Config = unknown> {
    run(init: (config: Config) => HandlerEntry[]): Promise<void>;
  }

  export const Runner: {
    newRunner<Config = unknown>(): Promise<Runner<Config>>;
  };
}
