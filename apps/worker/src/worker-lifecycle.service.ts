import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { JsonLoggerService } from '@platform/common';

@Injectable()
export class WorkerLifecycleService implements OnApplicationBootstrap {
  public constructor(private readonly logger: JsonLoggerService) {}

  public onApplicationBootstrap(): void {
    this.logger.log('worker_ready', 'Worker');
  }
}
