import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId?: string;
}

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;

export function requestIdMiddleware(
  request: RequestWithId,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header('x-request-id');
  const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
