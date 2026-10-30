// Response helpers that reproduce the original API envelopes exactly:
//   success: { status, message, data }
//   domain error: { status, message }
//   validation error (celebrate/Joi shape): { statusCode, error, message, validation: { <source>: {...} } }

const ok = (res, status, message, data) => res.status(status).json({ status, message, data });

const fail = (res, status, message) => res.status(status).json({ status, message });

function validationError(res, source, keys, message) {
  return res.status(400).json({
    statusCode: 400,
    error: 'Bad Request',
    message: 'Validation failed',
    validation: { [source]: { source, keys, message } },
  });
}

/** Convert the first zod issue into the Joi-style message the original backend returns. */
function joiMessage(issue) {
  const key = issue.path.join('.') || 'value';
  const q = `"${key}"`;
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') return issue.minimum === 1 ? `${q} is not allowed to be empty` : `${q} length must be at least ${issue.minimum} characters long`;
      return `${q} must be greater than or equal to ${issue.minimum}`;
    case 'too_big':
      if (issue.origin === 'string') return `${q} length must be less than or equal to ${issue.maximum} characters long`;
      return `${q} must be less than or equal to ${issue.maximum}`;
    case 'invalid_type':
      if (/received undefined/.test(issue.message)) return `${q} is required`;
      return `${q} must be a ${issue.expected}`;
    case 'unrecognized_keys':
      return `"${issue.keys[0]}" is not allowed`;
    case 'invalid_format':
      if (issue.format === 'email') return `${q} must be a valid email`;
      if (issue.format === 'regex' && /24/.test(String(issue.pattern))) return `${q} length must be 24 characters long`;
      return `${q} with value fails to match the required pattern`;
    default:
      return issue.message ? `${q} ${issue.message}` : `${q} is invalid`;
  }
}

/** Express middleware factory: validate req[source] with a zod schema, replace it with the parsed value. */
function validate(source, schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req[source] || {});
    if (!r.success) {
      const issue = r.error.issues[0];
      const keys = issue.code === 'unrecognized_keys' ? [issue.keys[0]] : [issue.path.join('.')];
      return validationError(res, source, keys, joiMessage(issue));
    }
    // Express 5 makes req.query a getter; keep the parsed copy on req.valid.
    req.valid = req.valid || {};
    req.valid[source] = r.data;
    next();
  };
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { ok, fail, validationError, validate, joiMessage, asyncRoute };
