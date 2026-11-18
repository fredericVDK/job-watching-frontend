import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // De app leest de lokale SQLite-database (data/jobwatcher.db) via node:sqlite.
  serverExternalPackages: [],
};

export default nextConfig;
