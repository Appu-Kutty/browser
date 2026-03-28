module.exports = (err, req, res, next) => {
    console.error('Unhandled error', err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
      error: true,
      message:
        process.env.NODE_ENV === 'production' ? 'Server error' : err.message || 'Server error'
    });
  };