import {
  HostError,
  type HostRepository,
  type NewReview,
  type Review,
  type ReviewHost,
} from "./review-host";

/** A repository named by a Git remote URL. */
export interface RemoteRepository {
  /** Host name in lower case, without user or port. */
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

const NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Reads host, owner, and repository from a remote URL: `https://host/owner/repo(.git)`,
 * `ssh://user@host[:port]/owner/repo(.git)`, or `user@host:owner/repo(.git)`. Anything else,
 * including local paths and URLs with more path segments, gives `undefined`.
 */
export function parseRemoteUrl(url: string): RemoteRepository | undefined {
  let host: string;
  let path: string;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return undefined;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol)) {
      return undefined;
    }
    host = parsed.hostname;
    path = decodeURIComponent(parsed.pathname);
  } else if (scp && !/^[A-Za-z]$/.test(scp[1] ?? "")) {
    host = scp[1] ?? "";
    path = scp[2] ?? "";
  } else {
    return undefined;
  }
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  if (segments.length !== 2) {
    return undefined;
  }
  const owner = segments[0] ?? "";
  const repo = (segments[1] ?? "").replace(/\.git$/i, "");
  if (!NAME.test(owner) || !NAME.test(repo) || repo === "" || host === "") {
    return undefined;
  }
  return { host: host.toLowerCase(), owner, repo };
}

/** Where the GitHub REST API of a repository lives, and which VS Code provider signs in. */
export interface GitHubTarget extends RemoteRepository {
  readonly apiBase: string;
  /** Origin of web pages, such as `https://github.com`; review URLs must start with it. */
  readonly webOrigin: string;
  readonly authProvider: "github" | "github-enterprise";
}

/**
 * The GitHub target of a remote: github.com, or the GitHub Enterprise Server configured in VS
 * Code (`github-enterprise.uri`) when the remote is on that server. Other hosts are not supported.
 */
export function gitHubTargetFor(
  remoteUrl: string,
  enterpriseUri?: string,
): GitHubTarget | undefined {
  const remote = parseRemoteUrl(remoteUrl);
  if (!remote) {
    return undefined;
  }
  if (remote.host === "github.com" || remote.host === "www.github.com") {
    return {
      ...remote,
      host: "github.com",
      apiBase: "https://api.github.com",
      webOrigin: "https://github.com",
      authProvider: "github",
    };
  }
  if (enterpriseUri) {
    let server: URL;
    try {
      server = new URL(enterpriseUri);
    } catch {
      return undefined;
    }
    if (server.protocol === "https:" && server.hostname.toLowerCase() === remote.host) {
      return {
        ...remote,
        apiBase: `${server.origin}/api/v3`,
        webOrigin: server.origin,
        authProvider: "github-enterprise",
      };
    }
  }
  return undefined;
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Pull requests through the GitHub REST API (specification §13). The token comes from VS Code's
 * authentication provider and is only ever sent to the target's API origin; it is never logged
 * or stored. Every answer is validated before use.
 */
export class GitHubHost implements ReviewHost {
  readonly label: string;

  constructor(
    private readonly target: GitHubTarget,
    private readonly token: () => Promise<string>,
    private readonly fetchFn: Fetch = (input, init) => fetch(input, init),
  ) {
    this.label = `${target.host}/${target.owner}/${target.repo}`;
  }

  async repository(): Promise<HostRepository> {
    const data = await this.request("GET", "");
    const record = asRecord(data);
    const permissions = asRecord(record.permissions ?? {});
    if (typeof record.default_branch !== "string") {
      throw new HostError("unexpected");
    }
    return { defaultBranch: record.default_branch, canPush: permissions.push === true };
  }

  async findReviews(branch: string, base: string): Promise<Review[]> {
    const query = new URLSearchParams({
      state: "all",
      head: `${this.target.owner}:${branch}`,
      base,
      per_page: "100",
    });
    const data = await this.request("GET", `/pulls?${query.toString()}`);
    if (!Array.isArray(data)) {
      throw new HostError("unexpected");
    }
    return data.map((item) => this.review(item));
  }

  async createReview(input: NewReview): Promise<Review> {
    const data = await this.request("POST", "/pulls", {
      title: input.title,
      head: input.branch,
      base: input.base,
      body: input.body,
    });
    return this.review(data);
  }

  private review(value: unknown): Review {
    const record = asRecord(value);
    const { number, html_url: url, state, merged_at: mergedAt, title } = record;
    if (
      typeof number !== "number" ||
      typeof url !== "string" ||
      !url.startsWith(`${this.target.webOrigin}/`) ||
      (state !== "open" && state !== "closed") ||
      typeof title !== "string"
    ) {
      throw new HostError("unexpected");
    }
    return {
      number,
      url,
      state: state === "closed" && typeof mergedAt === "string" ? "merged" : state,
      title,
    };
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const { apiBase, owner, repo } = this.target;
    const url = `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${await this.token()}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "Lorequill",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof HostError) {
        throw error;
      }
      throw new HostError("network");
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    if (response.ok) {
      return data;
    }
    const message =
      typeof asRecord(data).message === "string" ? String(asRecord(data).message) : "";
    const details = JSON.stringify(asRecord(data).errors ?? "");
    switch (response.status) {
      case 401:
        throw new HostError("auth", message);
      case 403:
      case 429:
        throw new HostError(
          response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(message)
            ? "rate-limited"
            : "forbidden",
          message,
        );
      case 404:
        throw new HostError("not-found", message);
      case 422:
        throw new HostError(
          /already exists/i.test(`${message} ${details}`) ? "already-exists" : "invalid",
          `${message} ${details === '""' ? "" : details}`.trim(),
        );
      default:
        throw new HostError("unexpected", message);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
