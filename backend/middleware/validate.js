module.exports = (schema) => (req, res, next) => {
    const toValidate = {};
    if (schema.body) toValidate.body = req.body;
    if (schema.query) toValidate.query = req.query;
    if (schema.params) toValidate.params = req.params;
  
    const { error } = schema.schema.validate(toValidate, { allowUnknown: true });
    if (error) {
      return res.status(400).json({
        error: true,
        message: error.details[0].message
      });
    }
    return next();
  };