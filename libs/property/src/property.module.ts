import { Module } from '@nestjs/common';
import { NoopPropertyEventPublisher } from './noop-property-event.publisher';
import { PostgresPropertyRepository } from './postgres-property.repository';
import {
  PropertyEventPublisher,
  PropertyOwnerService,
  PropertyPolicyService,
  PropertyQueryService,
} from './public/property.contracts';
import { PropertyRepository } from './property.repository';
import { DefaultPropertyService } from './property.service';

@Module({
  providers: [
    { provide: PropertyRepository, useClass: PostgresPropertyRepository },
    { provide: PropertyEventPublisher, useClass: NoopPropertyEventPublisher },
    DefaultPropertyService,
    { provide: PropertyQueryService, useExisting: DefaultPropertyService },
    { provide: PropertyPolicyService, useExisting: PropertyQueryService },
    { provide: PropertyOwnerService, useExisting: DefaultPropertyService },
  ],
  exports: [PropertyQueryService, PropertyPolicyService, PropertyOwnerService],
})
export class PropertyModule {}
