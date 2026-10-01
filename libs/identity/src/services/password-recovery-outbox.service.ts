import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { JsonLoggerService } from '../../../common/src/logging/json-logger.service';
import { EmailDeliveryPort } from '../providers/otp-delivery.port';
import { RecoveryOtpCodeService } from './recovery-otp-code.service';

interface ClaimedJob {
  id: string;
  aggregate_id: string;
  payload: { challengeId: string; email: string };
  attempt_count: number;
  created_at: Date;
}

@Injectable()
export class PasswordRecoveryOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly delivery: EmailDeliveryPort,
    private readonly codes: RecoveryOtpCodeService,
    private readonly logger: JsonLoggerService,
  ) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => void this.drain(), 1_000);
    void this.drain();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const token = randomUUID();
      const jobs = await this.dataSource.query<ClaimedJob[]>(
        `WITH candidate AS (
           SELECT id FROM outbox_events
           WHERE event_type = 'password_recovery_email' AND published_at IS NULL
             AND next_attempt_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - interval '2 minutes')
           ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10
         ) UPDATE outbox_events o SET locked_at = now(), lock_token = $1
         FROM candidate WHERE o.id = candidate.id
         RETURNING o.id, o.aggregate_id, o.payload, o.attempt_count, o.created_at`,
        [token],
      );
      await Promise.all(jobs.map((job) => this.process(job, token)));
    } finally {
      this.running = false;
    }
  }

  private async process(job: ClaimedJob, token: string): Promise<void> {
    const startedAt = Date.now();
    const [current] = await this.dataSource.query<Array<{ id: string; expires_at: Date }>>(
      `SELECT id, expires_at FROM otp_challenges WHERE id = $1 AND email = $2 AND purpose = 'password_reset'
       AND consumed_at IS NULL AND expires_at > now()`,
      [job.payload.challengeId, job.payload.email],
    );
    if (!current) return this.complete(job.id, token, 'stale');
    try {
      await this.delivery.sendOtp({
        email: job.payload.email,
        purpose: 'password_reset',
        code: this.codes.forChallenge(job.payload.challengeId),
        expiresInSeconds: Math.max(
          1,
          Math.ceil((current.expires_at.getTime() - Date.now()) / 1_000),
        ),
      });
      await this.complete(job.id, token, 'sent');
      this.logger.log(
        {
          event: 'password_recovery_outbox_sent',
          correlationId: job.id,
          queueWaitMs: startedAt - job.created_at.getTime(),
          providerMs: Date.now() - startedAt,
        },
        'PasswordRecoveryOutbox',
      );
    } catch (error) {
      const delaySeconds = Math.min(300, 2 ** Math.min(job.attempt_count + 1, 8));
      await this.dataSource.query(
        `UPDATE outbox_events SET attempt_count = attempt_count + 1, next_attempt_at = now() + ($3 * interval '1 second'),
         last_error = $4, locked_at = NULL, lock_token = NULL WHERE id = $1 AND lock_token = $2`,
        [
          job.id,
          token,
          delaySeconds,
          error instanceof Error ? error.message.slice(0, 500) : 'delivery failed',
        ],
      );
      this.logger.warn(
        {
          event: 'password_recovery_outbox_retry',
          correlationId: job.id,
          attempt: job.attempt_count + 1,
          backoffSeconds: delaySeconds,
        },
        'PasswordRecoveryOutbox',
      );
    }
  }

  private async complete(id: string, token: string, result: 'sent' | 'stale'): Promise<void> {
    await this.dataSource.query(
      `UPDATE outbox_events SET published_at = now(), locked_at = NULL, lock_token = NULL, last_error = $3
       WHERE id = $1 AND lock_token = $2`,
      [id, token, result],
    );
  }
}
