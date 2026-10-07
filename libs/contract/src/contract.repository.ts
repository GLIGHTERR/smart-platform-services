export interface ActiveRenterContractRecord {
  contractId: string;
  room: string | null;
  property: string | null;
  propertyAddress: Record<string, unknown> | null;
  expiresAt: string | null;
  ownerSignedAt: Date | null;
  renterSignedAt: Date | null;
  activatedAt: Date | null;
}

export abstract class ContractRepository {
  public abstract listActiveRenterContracts(
    renterId: string,
  ): Promise<readonly ActiveRenterContractRecord[]>;
}
