// MCP transport (JSON-RPC 2.0 over HTTP POST), modelled on reference-engine/mcp/protocol.js.
// Auth: "Authorization: Bearer <MCP_TOKEN>". No token configured -> everything is denied.
// Unlike the engine there is no pm2 restart after writes: all data lives in Postgres.
const crypto = require('crypto');

const PROTOCOL_VERSION = '2025-06-18';

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id: id ?? null, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function checkAuth(req) {
  const key = process.env.MCP_TOKEN || '';
  if (!key) return false;
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || token.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(key));
}

/** @param {Array<{name, description, inputSchema, handler, write?}>} tools */
function makeHandler(tools, serverInfo) {
  const map = Object.fromEntries(tools.map((t) => [t.name, t]));

  async function one(msg) {
    const { id, method, params } = msg || {};
    if (method === 'initialize') {
      return rpcResult(id, { protocolVersion: params?.protocolVersion || PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo });
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
    if (method === 'ping') return rpcResult(id, {});
    if (method === 'tools/list') {
      return rpcResult(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: !t.write, destructiveHint: Boolean(t.destructive) } })) });
    }
    if (method === 'tools/call') {
      const tool = map[params?.name];
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await tool.handler(params.arguments || {});
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out });
      } catch (e) {
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    return rpcError(id, -32601, `Method not found: ${method}`);
  }

  return async (req, res) => {
    if (!checkAuth(req)) return res.status(401).json(rpcError(null, -32001, 'Unauthorized'));
    const body = req.body;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(one))).filter(Boolean);
      return out.length ? res.json(out) : res.status(202).end();
    }
    const out = await one(body);
    if (!out) return res.status(202).end();
    res.json(out);
  };
}

module.exports = { makeHandler, checkAuth };
