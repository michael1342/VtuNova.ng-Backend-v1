/**
 * Express-5-safe replacement for `express-mongo-sanitize`.
 *
 * Why this file exists: express-mongo-sanitize REASSIGNS req.query, but in
 * Express 5 req.query is a getter-only property. That throws
 * "Cannot set property query of #<IncomingMessage> which has only a getter"
 * and turns every request carrying a query string into a 500.
 *
 * The fix is to strip dangerous keys IN PLACE — mutating the object's own
 * properties is allowed, only rebinding req.query is not.
 *
 * We remove keys starting with '$' (Mongo operators like $gt, $where) and keys
 * containing '.' (dotted-path injection), which is what the original package
 * guards against.
 */
const isDangerousKey = (key) => key.startsWith('$') || key.includes('.');

function scrub(obj, depth = 0) {
  if (depth > 10 || obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => scrub(item, depth + 1));
    return;
  }
  for (const key of Object.keys(obj)) {
    if (isDangerousKey(key)) {
      delete obj[key];            // in-place delete — safe on a getter-only parent
    } else {
      scrub(obj[key], depth + 1);
    }
  }
}

module.exports = () => (req, res, next) => {
  // Mutate in place; never reassign req.query / req.body / req.params.
  if (req.body)   scrub(req.body);
  if (req.params) scrub(req.params);
  if (req.query)  scrub(req.query);
  next();
};