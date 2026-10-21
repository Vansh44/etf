/**
 * Triggers the price-fetch GitHub Action on demand.
 *
 * The app can't fetch prices itself (Yahoo blocks non-browser TLS
 * fingerprints), so "refresh now" means "run the workflow that can".
 *
 * Entirely optional. With no token configured the Run button still works — it
 * just re-scores whatever prices are already stored instead of fetching new
 * ones, and says so.
 */

const API = "https://api.github.com";

export type DispatchOutcome =
  | { status: "dispatched" }
  | { status: "not-configured"; detail: string }
  /** `href` is where on GitHub the fix lives, when there is one place to send you. */
  | { status: "failed"; detail: string; href?: string };

export function isDispatchConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

export async function dispatchPriceFetch(): Promise<DispatchOutcome> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "owner/name"
  const workflow = process.env.GITHUB_WORKFLOW_FILE || "fetch-prices.yml";
  const ref = process.env.GITHUB_REF_NAME || "main";

  if (!token || !repo) {
    return {
      status: "not-configured",
      detail:
        "GITHUB_TOKEN / GITHUB_REPO are not set, so prices can't be refreshed from here. " +
        "Re-scored the prices already stored.",
    };
  }

  try {
    const res = await fetch(
      `${API}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref }),
        cache: "no-store",
      },
    );

    // 204 No Content is the success case for workflow dispatch.
    if (res.status === 204) return { status: "dispatched" };

    const body = await res.text();
    if (res.status === 404) {
      return {
        status: "failed",
        detail:
          `GitHub returned 404 for ${repo} / ${workflow}. Check GITHUB_REPO is "owner/name", ` +
          `that the workflow file exists on ${ref}, and that the token can see the repo.`,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        status: "failed",
        detail:
          "GitHub rejected the token. It needs the Actions: write permission on this " +
          "repository (fine-grained token) or the workflow scope (classic token).",
      };
    }
    // GitHub switches off scheduled workflows in a public repo after 60 days
    // without a commit, and a disabled workflow refuses dispatch too. Pushing
    // again does not switch it back on — only the Enable button does.
    if (res.status === 422 && body.includes("disabled workflow")) {
      return {
        status: "failed",
        detail:
          "GitHub has switched off the price-fetch workflow, so prices can't refresh. It does this to " +
          "scheduled workflows in a public repo after 60 days without a commit, and a new commit doesn't " +
          "undo it. Open the workflow on GitHub, press Enable workflow, then Refresh here.",
        href: `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}`,
      };
    }
    return { status: "failed", detail: `GitHub returned HTTP ${res.status}: ${githubMessage(body)}` };
  } catch (err) {
    return {
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The human sentence out of a GitHub error body, rather than its raw JSON. */
function githubMessage(body: string): string {
  try {
    const message = (JSON.parse(body) as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return body.slice(0, 200);
}
