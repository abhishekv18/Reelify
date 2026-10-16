/**
 * Plan limits — PROVISIONAL stub (Day 3). Final numbers and plan detection arrive on Day 13 (D1, D13).
 * Every shop currently gets the provisional free limits.
 */
import { MAX_DURATION_SECONDS } from "../lib/uploads.js";

/** Provisional free-plan limits: 10 videos, 30 stored minutes, 10 uploads in progress. */
export const PROVISIONAL_FREE_LIMITS = Object.freeze({
  maxVideos: 10,
  maxStoredSeconds: 30 * 60,
  maxPendingUploads: 10,
  // Each unfinished upload reserves its maxDurationSeconds of Stream storage until it is received or expires.
  reservedSeconds: MAX_DURATION_SECONDS,
});

/**
 * The shop argument is accepted now so callers do not change when real plans arrive (Day 13).
 * @returns {typeof PROVISIONAL_FREE_LIMITS}
 */
export function getPlanLimits() {
  return PROVISIONAL_FREE_LIMITS;
}
