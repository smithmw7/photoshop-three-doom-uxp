// Ported from: linuxdoom-1.10/i_main.c
// Main program, simply calls D_DoomMain.

import { M_InitArgvFromLocation } from './m_argv.js';
import { D_DoomMain } from './d_main.js';

M_InitArgvFromLocation();

// D_DoomMain returns a promise (it awaits the WAD fetch).
window.__doomBenchmarkReportLog?.(
  'info',
  'Doom module graph loaded',
  './src/i_main.js'
);

export const doomBootPromise = D_DoomMain().catch((error) => {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  window.__doomBenchmarkReportError?.(
    'Doom startup rejected',
    message
  );
  throw error;
});

window.__doomBootPromise = doomBootPromise;
window.__doomBenchmarkBundleReady?.(doomBootPromise);
