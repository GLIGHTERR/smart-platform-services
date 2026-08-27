import 'reflect-metadata';
import { bootstrapApi, handleBootstrapError } from '@platform/common';
import { OwnerApiModule } from './app.module';

void bootstrapApi(OwnerApiModule, {
  appName: 'OwnerApi',
  portConfigKey: 'app.ports.owner',
}).catch(handleBootstrapError);
