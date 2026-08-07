import { pathToFileURL } from "node:url";

const allowedEnvironmentClasses = new Set(["ephemeral", "qa", "staging"]);

export interface LiveExecutionPolicyResult {
  baseOrigin: string;
  environmentClass: string;
}

export function assertLiveExecutionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): LiveExecutionPolicyResult {
  const environmentClass = required(
    env.API_ENVIRONMENT_CLASS,
    "API_ENVIRONMENT_CLASS",
  );
  if (!allowedEnvironmentClasses.has(environmentClass)) {
    throw new Error(
      "API_ENVIRONMENT_CLASS must be ephemeral, qa, or staging. Production is forbidden.",
    );
  }

  required(env.USER_ID, "USER_ID");
  const base = exactOrigin(env.BASE_URL, "BASE_URL");
  if (base.protocol !== "https:") {
    throw new Error("BASE_URL must use HTTPS.");
  }

  const trustedOrigins = required(
    env.TRUSTED_API_ORIGINS,
    "TRUSTED_API_ORIGINS",
  )
    .split(",")
    .map((value) => exactOrigin(value.trim(), "TRUSTED_API_ORIGINS"));
  if (trustedOrigins.some((origin) => origin.protocol !== "https:")) {
    throw new Error("Every TRUSTED_API_ORIGINS entry must use HTTPS.");
  }
  if (!trustedOrigins.some((origin) => origin.origin === base.origin)) {
    throw new Error(
      "BASE_URL origin must be explicitly listed in TRUSTED_API_ORIGINS.",
    );
  }

  return { baseOrigin: base.origin, environmentClass };
}

export function assertMutatingExecutionPolicy(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (required(env.API_MUTATION_SCOPE, "API_MUTATION_SCOPE") !== "disposable") {
    throw new Error(
      "API_MUTATION_SCOPE must be disposable for mutating or calibration traffic.",
    );
  }
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required.`);
  }
  return normalized;
}

function exactOrigin(value: string | undefined, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(required(value, name));
  } catch (error) {
    if (error instanceof Error && error.message === `${name} is required.`) {
      throw error;
    }
    throw new Error(`${name} must contain valid absolute URL origins.`);
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      `${name} entries must be exact origins without credentials, paths, query, or hash.`,
    );
  }
  return parsed;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.argv[2];
  if (mode === "live") {
    assertLiveExecutionPolicy();
  } else if (mode === "mutation") {
    assertMutatingExecutionPolicy();
  } else {
    throw new Error("Usage: liveExecutionPolicy.ts <live|mutation>");
  }
}
