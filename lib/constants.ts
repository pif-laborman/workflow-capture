/** How often to POST the latest frame + transcript to /api/observe (ms) */
export const OBSERVE_INTERVAL_MS = 2000;

/** Minimum cooldown between Claude interjections (ms) */
export const COOLDOWN_MS = 5000;

/** How often to sample a frame from the screen capture (ms) */
export const FRAME_INTERVAL_MS = 1000;

/** JPEG quality for frame sampling (0-1) */
export const JPEG_QUALITY = 0.7;

/** Maximum number of keyframes to retain during a session */
export const MAX_KEYFRAMES = 60;
