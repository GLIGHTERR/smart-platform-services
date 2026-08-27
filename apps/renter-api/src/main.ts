import 'reflect-metadata';
import { bootstrapApi, handleBootstrapError } from '@platform/common';
import { RenterApiModule } from './app.module';

void bootstrapApi(RenterApiModule, {
  appName: 'RenterApi',
  portConfigKey: 'app.ports.renter',
}).catch(handleBootstrapError);
