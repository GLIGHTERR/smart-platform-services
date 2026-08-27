import 'reflect-metadata';
import { bootstrapApi, handleBootstrapError } from '@platform/common';
import { AdminApiModule } from './app.module';

void bootstrapApi(AdminApiModule, {
  appName: 'AdminApi',
  portConfigKey: 'app.ports.admin',
}).catch(handleBootstrapError);
