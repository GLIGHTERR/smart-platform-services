import type { NextFunction, Response } from 'express';
import { requestIdMiddleware, type RequestWithId } from './request-id.middleware';

describe('requestIdMiddleware', () => {
  function makeResponse(): { response: Response; setHeader: jest.Mock } {
    const setHeader = jest.fn();
    return { response: { setHeader } as unknown as Response, setHeader };
  }

  it('preserves a safe caller request ID', () => {
    const request = {
      header: jest.fn().mockReturnValue('mobile:request-123'),
    } as unknown as RequestWithId;
    const { response, setHeader } = makeResponse();
    const next = jest.fn() as NextFunction;

    requestIdMiddleware(request, response, next);

    expect(request.requestId).toBe('mobile:request-123');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', 'mobile:request-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsafe caller request ID', () => {
    const request = {
      header: jest.fn().mockReturnValue('unsafe value\nheader'),
    } as unknown as RequestWithId;
    const { response, setHeader } = makeResponse();
    const next = jest.fn() as NextFunction;

    requestIdMiddleware(request, response, next);

    expect(request.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
