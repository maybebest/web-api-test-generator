export function shouldLoadRootDotEnv(env = process.env) {
  return env.AI_GATE_SANITIZED_ENV !== 'true';
}
