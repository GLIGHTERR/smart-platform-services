import { Injectable } from '@nestjs/common';
import { PropertyEventPublisher, type PropertyDomainEvent } from './public/property.contracts';

@Injectable()
export class NoopPropertyEventPublisher extends PropertyEventPublisher {
  public async publish(_event: PropertyDomainEvent): Promise<void> {
    void _event;
  }
}
