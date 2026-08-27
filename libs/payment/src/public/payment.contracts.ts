export type PaymentStatus =
  'created' | 'pending_gateway' | 'success' | 'failed' | 'expired' | 'refund_pending' | 'refunded';

export interface PaymentSnapshot {
  paymentId: string;
  invoiceId: string;
  payerId: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  provider: string;
  providerReference: string | null;
}

export interface CreatePaymentIntentCommand {
  invoiceId: string;
  payerId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
}

export abstract class PaymentQueryService {
  public abstract getPaymentSnapshot(paymentId: string): Promise<PaymentSnapshot | null>;
  public abstract getPaymentStatus(paymentId: string): Promise<PaymentStatus | null>;
}

export abstract class PaymentIntentService {
  public abstract createForInvoice(command: CreatePaymentIntentCommand): Promise<PaymentSnapshot>;
}

export abstract class PaymentCommandService {
  public abstract confirmManualPayment(paymentId: string, actorId: string): Promise<void>;
  public abstract handleProviderWebhook(
    provider: string,
    headers: Readonly<Record<string, string>>,
    rawPayload: Buffer,
  ): Promise<void>;
  public abstract refundPayment(paymentId: string, actorId: string): Promise<void>;
}
