import { Controller, Get } from '@nestjs/common';
import { PropertyQueryService } from '@platform/property';
@Controller('listings')
export class ListingsController {
  public constructor(private readonly properties: PropertyQueryService) {}
  @Get('rooms') public rooms(): ReturnType<PropertyQueryService['listPublicRooms']> {
    return this.properties.listPublicRooms();
  }
}
