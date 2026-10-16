/** Thrown when a referenced record does not exist or does not belong to the current shop. */
export class OwnershipError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "OwnershipError";
  }
}

/** Thrown when input fails validation in a repository or service. */
export class ValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown when an action would exceed the shop's plan limits. `code` is machine-readable. */
export class PlanLimitError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "PlanLimitError";
    this.code = code;
  }
}
