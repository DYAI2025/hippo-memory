import { ensureCodexWrapperInstalled } from './hooks.js';

function main(): void {
  if (process.env.HIPPO_SKIP_POSTINSTALL === '1') return;

  try {
    ensureCodexWrapperInstalled();
  } catch {
    // Never fail package install because auto-integration could not be applied.
  }
}

main();
