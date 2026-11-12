/**
 * Application tracker statuses.
 *
 * The app never submits applications. You apply yourself, on the employer's or job board's site,
 * and record what happened here. "applied" therefore means "I applied myself, outside this app".
 *
 * "submitted" is reserved for a later phase in which a submission is recorded against an explicit
 * approval of specific document versions. Until approval records exist, it is refused rather than
 * faked.
 *
 * Keep this list in sync with the triggers in migrations/0002_phase1_integrity.sql.
 */
export const APPLICATION_STATUSES = [
  "prepared",
  "applied",
  "recruiter_contact",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPROVAL_GATED_STATUSES = ["submitted"] as const;

export const MAX_NOTES_LENGTH = 4_000;
