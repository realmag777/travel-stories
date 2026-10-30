// MCP server entry: assembles tool modules and mounts POST /mcp (same layout as reference-engine:
// one module per content area, each exporting { tools }).
const { makeHandler } = require('./protocol');

const MODULES = [
  require('./tools/stories'),
  require('./tools/travellers'),
  require('./tools/categories'),
  require('./tools/bookings'),
  require('./tools/stats'),
];

function register(app) {
  const tools = MODULES.flatMap((m) => m.tools);
  const seen = new Set();
  for (const t of tools) {
    if (seen.has(t.name)) throw new Error(`[mcp] duplicate tool ${t.name}`);
    seen.add(t.name);
  }
  const handler = makeHandler(tools, { name: 'podorozhnyky-plus', version: '1.0.0' });
  app.post('/mcp', handler);
  app.get('/mcp', (req, res) => res.status(405).json({ error: 'Use POST with JSON-RPC 2.0 (MCP streamable HTTP, JSON responses)' }));
}

module.exports = { register, MODULES };
