import { Module } from '@nestjs/common';
import { AuditModule } from '@platform/audit';
import { BillingModule } from '@platform/billing';
import { BookingModule } from '@platform/booking';
import { HealthModule, PlatformCoreModule } from '@platform/common';
import { ContractModule } from '@platform/contract';
import { IdentityModule } from '@platform/identity';
import { MaintenanceModule } from '@platform/maintenance';
import { MediaModule } from '@platform/media';
import { NotificationModule } from '@platform/notification';
import { PaymentModule } from '@platform/payment';
import { PropertyModule } from '@platform/property';
import { RenterSessionController } from './session.controller';

@Module({
  imports: [
    PlatformCoreModule,
    HealthModule,
    IdentityModule,
    PropertyModule,
    BookingModule,
    ContractModule,
    BillingModule,
    PaymentModule,
    AuditModule,
    MaintenanceModule,
    NotificationModule,
    MediaModule,
  ],
  controllers: [RenterSessionController],
})
export class RenterApiModule {}
