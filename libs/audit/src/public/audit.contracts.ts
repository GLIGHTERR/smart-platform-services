export interface AuditEventInput {
  eventType: string;
  actorId?: string;
  subjectType: string;
  subjectId?: string;
  occurredAt: string;
  data: Readonly<Record<string, unknown>>;
  requestId?: string;
}

export abstract class AuditLogService {
  public abstract recordSecurityEvent(event: AuditEventInput): Promise<void>;
  public abstract recordBusinessEvent(event: AuditEventInput): Promise<void>;
  public abstract recordDataChange(event: AuditEventInput): Promise<void>;
}
