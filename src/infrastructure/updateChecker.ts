import packageJson from "../../package.json";

const repository = "MIK-HEAL/5DMind";
const latestReleaseUrl = `https://api.github.com/repos/${repository}/releases/latest`;

export const appVersion = packageJson.version;

export type UpdateCheckStatus = "available" | "up-to-date" | "no-release";

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseName?: string;
  publishedAt?: string;
  status: UpdateCheckStatus;
}

interface GitHubRelease {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
}

function parseVersion(value: string) {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

export function compareVersions(left: string, right: string) {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return 0;
  for (let index = 0; index < parsedLeft.length; index += 1) {
    if (parsedLeft[index] !== parsedRight[index]) return parsedLeft[index] > parsedRight[index] ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(fetcher: typeof fetch = fetch): Promise<UpdateCheckResult> {
  const response = await fetcher(latestReleaseUrl, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (response.status === 404) {
    return { currentVersion: appVersion, status: "no-release" };
  }
  if (!response.ok) throw new Error(`更新服务返回 ${response.status}`);

  const release = (await response.json()) as GitHubRelease;
  const latestVersion = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/i, "") : "";
  const releaseUrl = typeof release.html_url === "string" ? release.html_url : undefined;
  if (!latestVersion || !parseVersion(latestVersion) || !releaseUrl) {
    throw new Error("更新信息格式无效");
  }

  return {
    currentVersion: appVersion,
    latestVersion,
    releaseUrl,
    releaseName: typeof release.name === "string" ? release.name : undefined,
    publishedAt: typeof release.published_at === "string" ? release.published_at : undefined,
    status: compareVersions(latestVersion, appVersion) > 0 ? "available" : "up-to-date",
  };
}
