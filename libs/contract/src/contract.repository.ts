export interface ActiveRenterContractRecord {
  contractId: string;
  room: string | null;
  property: string | null;
  expiresAt: string | null;
  renterSignedAt: Date | null;
  activatedAt: Date | null;
}

export abstract class ContractRepository {
  public abstract listActiveRenterContracts(
    renterId: string,
  ): Promise<readonly ActiveRenterContractRecord[]>;
}
