import { Module } from '@nestjs/common';
import { DefaultContractQueryService } from './contract-query.service';
import { ContractRepository } from './contract.repository';
import { PostgresContractRepository } from './postgres-contract.repository';
import { ContractQueryService } from './public/contract.contracts';

@Module({
  providers: [
    { provide: ContractRepository, useClass: PostgresContractRepository },
    DefaultContractQueryService,
    { provide: ContractQueryService, useExisting: DefaultContractQueryService },
  ],
  exports: [ContractQueryService],
})
export class ContractModule {}
