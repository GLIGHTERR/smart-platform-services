export interface ContractBillingTermsSnapshot {
  contractId: string;
  roomId: string;
  ownerId: string;
  renterId: string;
  status: 'active';
  monthlyRent: string;
  depositAmount: string;
  currency: string;
  billingDay: number;
  startsOn: string;
  endsOn: string | null;
}

export interface CreateContractFromBookingCommand {
  bookingId: string;
  startsOn: string;
  endsOn?: string;
  monthlyRent: string;
  depositAmount: string;
  currency: string;
  billingDay: number;
}

export abstract class ContractQueryService {
  public abstract getActiveContract(
    contractId: string,
  ): Promise<ContractBillingTermsSnapshot | null>;
  public abstract getContractBillingTerms(
    contractId: string,
  ): Promise<ContractBillingTermsSnapshot | null>;
  public abstract getActiveContractByRoom(
    roomId: string,
  ): Promise<ContractBillingTermsSnapshot | null>;
}

export abstract class ContractPolicyService {
  public abstract assertContractBillable(contractId: string): Promise<void>;
  public abstract assertActorCanViewContract(actorId: string, contractId: string): Promise<void>;
}

export abstract class ContractCommandService {
  public abstract createContractFromApprovedBooking(
    command: CreateContractFromBookingCommand,
  ): Promise<string>;
  public abstract activateContract(contractId: string, actorId: string): Promise<void>;
  public abstract terminateContract(contractId: string, actorId: string): Promise<void>;
}
