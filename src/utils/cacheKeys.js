/**
 * Centralised cache-key builders.
 *
 * Every Redis key follows the pattern:
 * `user:${id}:name`
 */

const cacheKeys = {
  /** `user:${id}:profile` */
  userProfile: (id) => `user:${id}:profile`,

  /** `user:${id}:notifications` */
  userNotifications: (id) => `user:${id}:notifications`,

  /** `user:${id}:notification` */
  notification: (id) => `user:${id}:notification`,

  /** `user:${id}:transactions` */
  userTransactions: (id) => `user:${id}:transactions`,

  /** `user:${id}:transaction` */
  transaction: (id) => `user:${id}:transaction`,

  /** `user:${serviceID}:data-plans` */
  vtuDataPlans: (serviceID) => `user:${serviceID}:data-plans`,

  /** Generic builder: `user:${id}:${name}` */
  user: (id, name = 'profile') => `user:${id}:${name}`,

  otp: (email, purpose) => `otp:${purpose}:${email}`,

  /** Aliases */
  notifications: (id) => `user:${id}:notifications`,
  transactions: (id) => `user:${id}:transactions`,
};

module.exports = cacheKeys;

