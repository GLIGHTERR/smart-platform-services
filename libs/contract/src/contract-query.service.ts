import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JsonLoggerService } from '@platform/common';
import { ContractRepository, type ActiveRenterContractRecord } from './contract.repository';
import type { ActiveRentalSummary } from './public/contract.contracts';

@Injectable()
export class DefaultContractQueryService {
  public constructor(
    private readonly repository: ContractRepository,
    private readonly logger: JsonLoggerService,
  ) {}

  public async listActiveRentalsForRenter(
    renterId: string,
  ): Promise<readonly ActiveRentalSummary[]> {
    const records = await this.repository.listActiveRenterContracts(renterId);
    const unreadableCount = records.filter((record) => !record.room || !record.property).length;
    if (unreadableCount) {
      this.logger.write('warn', 'profile_active_rental_relation_missing', 'ContractQuery', {
        count: unreadableCount,
      });
      throw this.unavailable();
    }

    const missingSignedAt = records.filter(
      (record) => !record.renterSignedAt && !record.activatedAt,
    );
    if (missingSignedAt.length) {
      this.logger.write('warn', 'profile_active_rental_missing_signed_at', 'ContractQuery', {
        count: missingSignedAt.length,
      });
    }

    return records
      .filter((record): record is ActiveRenterContractRecord & { room: string; property: string } =>
        Boolean(record.room && record.property && (record.renterSignedAt || record.activatedAt)),
      )
      .map((record) => ({
        contractId: record.contractId,
        room: record.room,
        property: record.property,
        expiresAt: record.expiresAt,
        signedAt: (record.renterSignedAt ?? record.activatedAt)!.toISOString(),
      }))
      .sort(
        (left, right) =>
          left.signedAt.localeCompare(right.signedAt) ||
          left.contractId.localeCompare(right.contractId),
      );
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'PROFILE_UNAVAILABLE',
      message: 'Profile is temporarily unavailable',
    });
  }
}
