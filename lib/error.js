/** An error caused by bad input — reported to the user without a stack trace. */
export class UserError extends Error {}

/** Throws a UserError unless `condition` holds. */
export function check(condition, message) {
  if (!condition) throw new UserError(message);
}
