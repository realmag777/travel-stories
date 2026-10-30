// Swagger UI at /docs with the merged OpenAPI document (original v1 contract + v2 extensions).
const swaggerUi = require('swagger-ui-express');
const v1 = require('../openapi/v1.json');
const v2 = require('../openapi/v2');

function spec() {
  const doc = JSON.parse(JSON.stringify(v1));
  doc.paths = { ...doc.paths, ...v2.paths };
  doc.components.schemas = { ...doc.components.schemas, ...v2.schemas };
  doc.tags = [...(doc.tags || []), ...v2.tags];
  return doc;
}

function register(app) {
  const doc = spec();
  app.get('/docs/openapi.json', (req, res) => res.json(doc));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(doc, {
    customSiteTitle: 'Podorozhnyky+ API',
    customCss: '.swagger-ui .topbar { background: #131f43 } .swagger-ui .info .title { font-family: Inter, sans-serif }',
  }));
}

module.exports = { register, spec };
