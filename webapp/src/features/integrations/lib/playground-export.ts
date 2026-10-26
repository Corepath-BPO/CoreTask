import { maskedHeaders, type PlaygroundCall, type PlaygroundRequest } from './playground-calls';

/**
 * The request as a curl line. `reveal` puts the real credential in, for
 * pasting into a terminal; otherwise the secret is masked, for showing.
 */
export function toCurl(request: PlaygroundRequest, options: { reveal: boolean }): string {
  const headers = options.reveal ? request.headers : maskedHeaders(request.headers);
  const lines = [`curl -X ${request.method} '${request.url}'`];

  for (const [name, value] of Object.entries(headers)) {
    lines.push(`  -H '${name}: ${value}'`);
  }
  if (request.body !== null) {
    // One line, single-quoted: the body has no single quotes of its own to escape.
    lines.push(`  -d '${JSON.stringify(JSON.parse(request.body))}'`);
  }

  return lines.join(' \\\n');
}

/**
 * The request as an n8n HTTP Request node, ready to paste onto a canvas.
 *
 * The credential is left for n8n to hold: the node asks for a Header Auth
 * credential, which is where the key belongs, so the key itself is never in
 * the pasted text. The idempotency header, when the call takes one, is wired
 * to the execution id so every run of the flow gets a fresh key of its own.
 */
export function toN8nNode(request: PlaygroundRequest, call: PlaygroundCall): string {
  const headerParameters = call.idempotent
    ? [{ name: 'Idempotency-Key', value: '={{ $execution.id }}-{{ $itemIndex }}' }]
    : [];

  const parameters: Record<string, unknown> = {
    method: request.method,
    url: request.url,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    ...(headerParameters.length > 0
      ? { sendHeaders: true, headerParameters: { parameters: headerParameters } }
      : {}),
    ...(request.body !== null
      ? { sendBody: true, specifyBody: 'json', jsonBody: request.body }
      : {}),
    options: {},
  };

  return JSON.stringify(
    {
      nodes: [
        {
          parameters,
          name: `CoreTask: ${call.label}`,
          type: 'n8n-nodes-base.httpRequest',
          typeVersion: 4.2,
          position: [0, 0],
        },
      ],
      connections: {},
    },
    null,
    2,
  );
}
