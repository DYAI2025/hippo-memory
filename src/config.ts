/**
 * Config support for Hippo: reads .hippo/config.json with sane defaults.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface HippoConfig {
  embeddings: {
    enabled: boolean;
    model: string;
    hybridWeight: number;
  };
  global: {
    enabled: boolean;
  };
}

const DEFAULT_CONFIG: HippoConfig = {
  embeddings: {
    enabled: true,
    model: 'Xenova/all-MiniLM-L6-v2',
    hybridWeight: 0.6,
  },
  global: {
    enabled: true,
  },
};

export function loadConfig(hippoRoot: string): HippoConfig {
  const configPath = path.join(hippoRoot, 'config.json');
  if (!fs.existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<HippoConfig>;
    return {
      embeddings: { ...DEFAULT_CONFIG.embeddings, ...(raw.embeddings ?? {}) },
      global: { ...DEFAULT_CONFIG.global, ...(raw.global ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(hippoRoot: string, config: HippoConfig): void {
  const configPath = path.join(hippoRoot, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
