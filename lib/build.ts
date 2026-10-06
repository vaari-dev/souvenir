import { env } from "./env.ts";

export const build = env.GIT_SHA ? { sha: env.GIT_SHA, short: env.GIT_SHA.slice(0, 7) } : null;
