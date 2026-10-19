import type { NextFunction, Request, Response } from 'express';

/**
 * Reads a JSON or form body of up to `limitBytes`, for the one route that
 * needs more than the default parser's 100 KB: mail arrives with its
 * attachments inline. Mounted ahead of Nest's parser, which then sees a
 * finished request and leaves it alone. Multipart is left to the route.
 */
export function largeBody(limitBytes: number) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    const json = type === 'application/json' || type.endsWith('+json');
    const form = type === 'application/x-www-form-urlencoded';
    if (!json && !form) {
      next();
      return;
    }

    const refuse = (status: number, code: string, message: string) => {
      if (!response.headersSent) {
        response.status(status).json({ success: false, error: { code, message } });
      }
    };

    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    request.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limitBytes) {
        over = true;
        chunks.length = 0;
        refuse(413, 'PAYLOAD_TOO_LARGE', 'The message is too large.');
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (over) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        request.body = json
          ? raw.trim()
            ? (JSON.parse(raw) as unknown)
            : {}
          : Object.fromEntries(new URLSearchParams(raw));
      } catch {
        refuse(400, 'BAD_REQUEST', 'The body is not valid JSON.');
        return;
      }
      next();
    });
    request.on('error', next);
  };
}
