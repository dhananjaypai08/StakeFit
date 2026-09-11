import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  resourceType: string;
  at: number;
}

export interface ConsoleEntry {
  level: string;
  text: string;
  at: number;
}

export interface SandboxCallbacks {
  onFrame?: (jpegBase64: string) => void;
  onNetwork?: (entry: NetworkEntry) => void;
  onConsole?: (entry: ConsoleEntry) => void;
}

export interface SandboxOptions {
  /** Only this origin may be navigated to or probed. */
  originAllowlist: string[];
  callbacks?: SandboxCallbacks;
  screencast?: boolean;
}

/**
 * A container friendly, isolated Chromium controlled via Playwright and the
 * Chrome DevTools Protocol. This is the perceive surface of the tight loop and
 * the source of the live viewport streamed to the frontend.
 */
export interface PageAction {
  selector: string;
  text: string;
}

export class BrowserSandbox {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private cdp?: CDPSession;
  private readonly network: NetworkEntry[] = [];
  private readonly console: ConsoleEntry[] = [];
  private readonly endpoints = new Set<string>();
  private readonly links = new Set<string>();
  private readonly visited = new Set<string>();
  private readonly clicked = new Set<string>();
  private readonly allowlist: string[];

  constructor(private readonly options: SandboxOptions) {
    this.allowlist = [...options.originAllowlist];
  }

  async start(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1600, height: 1000 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true,
    });
    this.page = await this.context.newPage();

    this.page.on("response", (res) => {
      const req = res.request();
      const entry: NetworkEntry = {
        method: req.method(),
        url: res.url(),
        status: res.status(),
        resourceType: req.resourceType(),
        at: Date.now(),
      };
      this.network.push(entry);
      if (isInterestingEndpoint(req.resourceType(), res.url())) {
        this.endpoints.add(`${req.method()} ${res.url().split("?")[0]}`);
      }
      this.options.callbacks?.onNetwork?.(entry);
    });

    this.page.on("console", (msg) => {
      const entry: ConsoleEntry = { level: msg.type(), text: msg.text(), at: Date.now() };
      this.console.push(entry);
      this.options.callbacks?.onConsole?.(entry);
    });

    this.page.on("pageerror", (err) => {
      const entry: ConsoleEntry = { level: "error", text: err.message, at: Date.now() };
      this.console.push(entry);
      this.options.callbacks?.onConsole?.(entry);
    });

    if (this.options.screencast !== false) {
      await this.startScreencast();
    }
  }

  private async startScreencast(): Promise<void> {
    if (!this.page) return;
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId: number }) => {
      this.options.callbacks?.onFrame?.(frame.data);
      try {
        await this.cdp?.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      } catch {
        // session may have closed between frames
      }
    });
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 82,
      maxWidth: 1600,
      maxHeight: 1000,
      everyNthFrame: 1,
    });
  }

  private assertPage(): Page {
    if (!this.page) throw new Error("sandbox not started");
    return this.page;
  }

  isAllowed(url: string): boolean {
    try {
      const host = new URL(url).hostname;
      return this.allowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    } catch {
      return false;
    }
  }

  private rememberHost(url: string): void {
    try {
      const host = new URL(url).hostname;
      if (host && !this.allowlist.includes(host)) this.allowlist.push(host);
    } catch {
      // ignore
    }
  }

  async navigate(url: string): Promise<string> {
    if (!this.isAllowed(url)) return `blocked: ${url} is outside the scan allowlist`;
    const page = this.assertPage();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    this.visited.add(normalizeUrl(url));
    this.rememberHost(page.url());
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await sleep(400);
    await this.refreshLinks();
    if (this.unvisitedLinks().length === 0) {
      await sleep(700);
      await this.refreshLinks();
    }
    await this.tourViewport();
    return `navigated to ${url} status ${res?.status() ?? "unknown"} title ${await page.title()}`;
  }

  async click(selector?: string, text?: string): Promise<string> {
    const page = this.assertPage();
    const label = text?.trim();
    if (label) {
      const candidates = [
        page.getByRole("link", { name: label, exact: false }),
        page.getByRole("button", { name: label, exact: false }),
        page.getByText(label, { exact: false }),
      ];
      let clicked = false;
      for (const loc of candidates) {
        try {
          await loc.first().click({ timeout: 2500 });
          clicked = true;
          break;
        } catch {
          // try the next locator
        }
      }
      if (!clicked) throw new Error(`no visible control matching "${label}"`);
      this.clicked.add(label.toLowerCase());
    } else if (selector) {
      await page.click(selector, { timeout: 8000 });
      this.clicked.add(selector);
    } else {
      throw new Error("click requires selector or text");
    }
    await sleep(400);
    this.rememberHost(page.url());
    this.visited.add(normalizeUrl(page.url()));
    await this.refreshLinks();
    return `clicked ${label || selector} now at ${page.url()}`;
  }

  async scroll(direction = "down", amount = 640): Promise<string> {
    const page = this.assertPage();
    const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    const y = await page.evaluate(async (dy) => {
      const start = window.scrollY;
      const end = Math.max(0, start + dy);
      const steps = 14;
      for (let i = 1; i <= steps; i += 1) {
        window.scrollTo({ top: start + ((end - start) * i) / steps });
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
      return window.scrollY;
    }, delta);
    await sleep(180);
    return `scrolled ${direction} to y=${Math.round(y)}`;
  }

  async tourViewport(): Promise<string> {
    await this.scroll("down", 520);
    await this.scroll("down", 520);
    await this.scroll("up", 220);
    return "toured the current page";
  }

  async listActions(): Promise<PageAction[]> {
    const page = this.assertPage();
    const items = await page.evaluate(() => {
      const out: Array<{ selector: string; text: string }> = [];
      const nodes = document.querySelectorAll("a, button, [role='button'], [role='link'], input[type='submit'], input[type='button']");
      let i = 0;
      for (const node of nodes) {
        const el = node as HTMLElement;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const box = el.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) continue;
        const text = (
          el.innerText ||
          el.getAttribute("aria-label") ||
          el.getAttribute("value") ||
          el.getAttribute("placeholder") ||
          (el as HTMLInputElement).type ||
          `control-${i}`
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        if (!text) continue;
        if (/cookie|accept all|reject all|close dialog/i.test(text)) continue;
        el.setAttribute("data-stakefit-act", String(i));
        out.push({ selector: `[data-stakefit-act="${i}"]`, text });
        i += 1;
        if (out.length >= 16) break;
      }
      return out;
    });
    return items.filter((item) => !this.clicked.has(item.text.toLowerCase()));
  }

  async fill(selector: string, value: string): Promise<string> {
    const page = this.assertPage();
    await page.fill(selector, value, { timeout: 8000 });
    return `filled ${selector}`;
  }

  async submit(selector: string): Promise<string> {
    const page = this.assertPage();
    await page.press(selector, "Enter", { timeout: 8000 });
    await this.refreshLinks();
    return `submitted via ${selector} now at ${page.url()}`;
  }

  async readDom(maxChars = 6000): Promise<string> {
    const page = this.assertPage();
    const content = await page.content();
    return content.slice(0, maxChars);
  }

  listEndpoints(): string[] {
    return Array.from(this.endpoints);
  }

  listLinks(): string[] {
    return Array.from(this.links);
  }

  unvisitedLinks(): string[] {
    return this.listLinks().filter((href) => !this.visited.has(href));
  }

  hasVisited(url: string): boolean {
    return this.visited.has(normalizeUrl(url));
  }

  samePage(url: string): boolean {
    try {
      return normalizeUrl(this.assertPage().url()) === normalizeUrl(url);
    } catch {
      return false;
    }
  }

  async listFields(): Promise<Array<{ selector: string; type: string; name: string }>> {
    const page = this.assertPage();
    return page.evaluate(() =>
      [...document.querySelectorAll("input, textarea, select")].slice(0, 20).map((node, i) => {
        const el = node as HTMLInputElement;
        el.setAttribute("data-stakefit-field", String(i));
        return {
          selector: `[data-stakefit-field="${i}"]`,
          type: el.type || el.tagName.toLowerCase(),
          name: el.name || el.id || el.placeholder || el.type || "field",
        };
      }),
    );
  }

  private async refreshLinks(): Promise<void> {
    const page = this.assertPage();
    const hrefs = await page.$$eval("a[href], area[href], [data-href], [data-url]", (nodes) =>
      nodes
        .map((node) => {
          const el = node as HTMLAnchorElement & { dataset: DOMStringMap };
          return el.href || el.dataset.href || el.dataset.url || el.getAttribute("href") || "";
        })
        .filter(Boolean),
    );
    for (const href of hrefs) {
      if (href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      let absolute = href;
      try {
        absolute = new URL(href, page.url()).toString();
      } catch {
        continue;
      }
      if (!this.isAllowed(absolute)) continue;
      const normalized = normalizeUrl(absolute);
      if (normalized) this.links.add(normalized);
    }
  }

  readNetwork(limit = 40): NetworkEntry[] {
    return this.network.filter((entry) => !NOISE_URL.test(entry.url)).slice(-limit);
  }

  readConsole(limit = 40): ConsoleEntry[] {
    return this.console.slice(-limit);
  }

  /** Fetch a crafted request from the browser context so CORS does not block probes. */
  async probe(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{ status: number; body: string }> {
    if (!this.isAllowed(url)) return { status: 0, body: `blocked: ${url} is outside the scan allowlist` };
    if (!this.context) throw new Error("sandbox not started");
    const res = await this.context.request.fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.headers,
      data: init?.body,
      timeout: 15000,
      failOnStatusCode: false,
    });
    return { status: res.status(), body: (await res.text()).slice(0, 4000) };
  }

  async screenshot(): Promise<string> {
    const page = this.assertPage();
    const buf = await page.screenshot({ type: "jpeg", quality: 60 });
    return buf.toString("base64");
  }

  async currentUrl(): Promise<string> {
    return this.assertPage().url();
  }

  async stop(): Promise<void> {
    try {
      await this.cdp?.send("Page.stopScreencast");
    } catch {
      // ignore
    }
    await this.context?.close();
    await this.browser?.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const NOISE_URL =
  /sentry\.io|posthog|\/ph\/|_vercel\/insights|_next\/static|_next\/image|woff2?(\?|$)|googleapis|gstatic|hotjar|segment\.|amplitude|web-vitals|dead-clicks|surveys\.js|analytics\.google|google-analytics|doubleclick|googleadservices|googletagmanager|\/ccm\/collect|\/rmkt\/collect|framer\.com|api\.framer|aplo-evnt|facebook\.net|connect\.facebook|clarity\.ms|hotjar/i;

function isInterestingEndpoint(resourceType: string, url: string): boolean {
  if (NOISE_URL.test(url)) return false;
  return resourceType === "xhr" || resourceType === "fetch" || resourceType === "document";
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}`;
  } catch {
    return url;
  }
}
