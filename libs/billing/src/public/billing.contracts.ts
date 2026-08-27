export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';

export interface InvoicePayableSnapshot {
  invoiceId: string;
  contractId: string;
  ownerId: string;
  renterId: string;
  status: InvoiceStatus;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  currency: string;
  dueOn: string;
}

export interface SuccessfulPaymentAllocation {
  invoiceId: string;
  paymentId: string;
  amount: string;
  currency: string;
  occurredAt: string;
}

export abstract class BillingQueryService {
  public abstract getInvoicePayableSnapshot(
    invoiceId: string,
  ): Promise<InvoicePayableSnapshot | null>;
  public abstract getInvoiceStatus(invoiceId: string): Promise<InvoiceStatus | null>;
  public abstract getOutstandingBalance(invoiceId: string): Promise<string>;
}

export abstract class BillingPolicyService {
  public abstract assertInvoicePayable(invoiceId: string): Promise<void>;
  public abstract assertActorCanPayInvoice(actorId: string, invoiceId: string): Promise<void>;
}

export abstract class BillingCommandService {
  public abstract issueInvoiceFromContract(contractId: string, dueOn: string): Promise<string>;
  public abstract adjustDebt(invoiceId: string, amount: string, reason: string): Promise<void>;
}

export abstract class BillingPaymentService {
  public abstract allocateSuccessfulPayment(allocation: SuccessfulPaymentAllocation): Promise<void>;
  public abstract markPaymentFailedForInvoice(invoiceId: string, paymentId: string): Promise<void>;
}
