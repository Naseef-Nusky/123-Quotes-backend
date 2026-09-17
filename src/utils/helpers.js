function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

function ok(res, data = {}, status = 200) {
  return res.status(status).json(data)
}

function fail(res, message, status = 400) {
  return res.status(status).json({ message })
}

module.exports = { asyncHandler, ok, fail }
