# OpenClaw Runtime Integration

OpenClaw is integrated as an optional server-side agent runtime for the private Argentum prototype. Argentum remains the system of record for authentication, permissions, tasks, workflows, approvals, audit logs, and persisted state.

The browser never calls OpenClaw directly. Browser code calls Argentum API routes, Argentum checks the admin session, and only the server-side OpenClaw adapter calls the Gateway.

## Security Boundary

This implementation assumes one private trusted operator per OpenClaw Gateway.

Do not expose the Gateway directly to the public internet. Keep it on loopback, a private network, a tailnet, or another protected ingress. Future production customers should use separate Gateway credentials and preferably separate containers, hosts, or OS-level boundaries. One shared Gateway is not a safe isolation boundary for mutually untrusted customers.

OpenClaw must not receive more filesystem, shell, network, or application access than the prototype needs. Argentum does not expose raw tool invocation, Gateway admin RPC endpoints, raw Gateway configuration, or Gateway credentials through its APIs.

## Environment Variables

OpenClaw is disabled by default:

```bash
OPENCLAW_ENABLED=false
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=
OPENCLAW_DEFAULT_MODEL=openclaw/default
OPENCLAW_REQUEST_TIMEOUT_MS=120000
```

Enable it only after the Gateway is running and a token exists:

```bash
OPENCLAW_ENABLED=true
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=replace_with_gateway_token
OPENCLAW_DEFAULT_MODEL=openclaw/default
OPENCLAW_REQUEST_TIMEOUT_MS=120000
```

`OPENCLAW_GATEWAY_TOKEN` must stay server-side only. Do not add it to frontend JavaScript, public HTML, build-time client variables, logs, screenshots, or source control.

## Gateway Setup

Run OpenClaw as a separately managed service. This repo does not vendor OpenClaw and does not start it automatically.

At a minimum, the Gateway must expose:

- `GET /v1/models`
- `POST /v1/responses`
- Bearer token authentication with `Authorization: Bearer <gateway token>`

The default agent target is `openclaw/default`.

## Testing The Connection

After signing into Argentum as an admin, use either connector testing or the OpenClaw runtime endpoints:

```bash
GET /api/agent-runtime/openclaw/status
GET /api/agent-runtime/openclaw/models
POST /api/agent-runtime/openclaw/test
POST /api/agent-runtime/openclaw/run
```

Example run body:

```json
{
  "conversationId": "agent101-main",
  "input": "Prepare a safe draft-only launch plan.",
  "model": "openclaw/default"
}
```

Argentum sends a stable application-owned `user` value to OpenClaw:

```text
agentum-conversation:<conversation-id>
```

It does not use emails, names, or other personal identifiers as session IDs.

## Disable OpenClaw

Set:

```bash
OPENCLAW_ENABLED=false
```

When disabled, Argentum continues using its existing local/OpenAI runtime behavior. OpenClaw routes return safe disabled status or disabled runtime errors, and existing Agent 101 behavior is unchanged.

## Common Errors

- `connection_failed`: The Gateway is not running at `OPENCLAW_BASE_URL`, the host is unreachable, or the ingress is blocked.
- `invalid_configuration`: OpenClaw is enabled but required server configuration is missing or malformed.
- `authentication_failed`: The Gateway token is missing, wrong, expired, or not accepted by the Gateway.
- `rate_limited`: The Gateway returned HTTP 429.
- `gateway_failure`: The Gateway returned HTTP 5xx. Check Gateway service logs.
- `malformed_response`: The Gateway returned non-JSON or a response without usable model output.
- `timeout`: The Gateway did not respond before `OPENCLAW_REQUEST_TIMEOUT_MS`.

## Logging

Argentum logs only safe operational metadata:

- internal request ID
- provider
- selected OpenClaw target
- duration
- success or failure
- HTTP status when available

Argentum does not log prompts, responses, authorization headers, tokens, private tool output, or secrets.

## Production Notes

For production customer isolation, do not place multiple unrelated customers behind one shared Gateway and call it multi-tenant isolation. Use separate Gateway credentials and preferably separate runtime containers or hosts per organization, with explicit network boundaries and per-organization audit trails.
