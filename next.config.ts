import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Read at build time, outside lib/env.ts: one commit, one build id, so hashes agree.
  generateBuildId: () => process.env.GIT_SHA ?? null,
  // Old root-level URLs land on the trips list, which forwards a one-trip member.
  async redirects() {
    return [
      { source: "/leaderboard", destination: "/trips", permanent: true },
      { source: "/members", destination: "/trips", permanent: true },
      { source: "/bills", destination: "/trips", permanent: true },
      { source: "/talk", destination: "/trips", permanent: true },
      { source: "/inbox", destination: "/trips", permanent: true },
      { source: "/new", destination: "/trips", permanent: true },
      { source: "/market/:id", destination: "/trips", permanent: true },
      { source: "/member/:id", destination: "/trips", permanent: true },
    ];
  },
  // pino's dynamic requires don't bundle; as an external it is traced into standalone
  // node_modules, where `node scripts/migrate.ts` resolves it too.
  serverExternalPackages: ["pino"],
  // The runtime image also runs migrations (compose `migrate`), so ship the SQL, the script,
  // and what it imports.
  outputFileTracingIncludes: {
    "*": [
      "./drizzle/**",
      "./scripts/**",
      "./lib/**",
      // Imported raw by the migrate script; the app bundle compiles them in, so tracing skips them.
      "./node_modules/drizzle-orm/**",
      "./node_modules/zod/**",
      "./node_modules/pg/**",
      "./node_modules/pg-*/**",
      "./node_modules/postgres-*/**",
      "./node_modules/pgpass/**",
      "./node_modules/split2/**",
    ],
  },
};

export default nextConfig;
