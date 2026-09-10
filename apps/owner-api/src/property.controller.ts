import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentActor, JwtAuthGuard, Roles, RolesGuard, type AuthenticatedActor } from '@platform/identity';
import { PropertyOwnerService } from '@platform/property';
import { CreatePropertyDto, CreateRoomDto, SetPropertyStatusDto, SetRoomStatusDto, UpdatePropertyDto, UpdateRoomDto } from '../../../libs/property/src/http/property.dto';
@Controller('properties') @UseGuards(JwtAuthGuard, RolesGuard) @Roles('owner')
export class PropertyController { public constructor(private readonly properties: PropertyOwnerService) {}
  @Post() public create(@CurrentActor() a: AuthenticatedActor, @Body() x: CreatePropertyDto): ReturnType<PropertyOwnerService['createProperty']> { return this.properties.createProperty(a.id, x); }
  @Get() public list(@CurrentActor() a: AuthenticatedActor): ReturnType<PropertyOwnerService['listProperties']> { return this.properties.listProperties(a.id); }
  @Get(':propertyId') public get(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string): ReturnType<PropertyOwnerService['getProperty']> { return this.properties.getProperty(a.id, id); }
  @Patch(':propertyId') public update(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string, @Body() x: UpdatePropertyDto): ReturnType<PropertyOwnerService['updateProperty']> { return this.properties.updateProperty(a.id, id, x); }
  @Patch(':propertyId/status') public status(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string, @Body() x: SetPropertyStatusDto): ReturnType<PropertyOwnerService['setPropertyStatus']> { return this.properties.setPropertyStatus(a.id, id, x.status); }
  @Delete(':propertyId') @HttpCode(HttpStatus.NO_CONTENT) public async remove(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string): Promise<void> { await this.properties.deleteProperty(a.id, id); }
  @Post(':propertyId/rooms') public createRoom(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string, @Body() x: CreateRoomDto): ReturnType<PropertyOwnerService['createRoom']> { return this.properties.createRoom(a.id, id, x); }
  @Get(':propertyId/rooms') public listRooms(@CurrentActor() a: AuthenticatedActor, @Param('propertyId') id: string): ReturnType<PropertyOwnerService['listRooms']> { return this.properties.listRooms(a.id, id); }
  @Get('rooms/:roomId') public room(@CurrentActor() a: AuthenticatedActor, @Param('roomId') id: string): ReturnType<PropertyOwnerService['getRoom']> { return this.properties.getRoom(a.id, id); }
  @Patch('rooms/:roomId') public updateRoom(@CurrentActor() a: AuthenticatedActor, @Param('roomId') id: string, @Body() x: UpdateRoomDto): ReturnType<PropertyOwnerService['updateRoom']> { return this.properties.updateRoom(a.id, id, x); }
  @Patch('rooms/:roomId/status') public roomStatus(@CurrentActor() a: AuthenticatedActor, @Param('roomId') id: string, @Body() x: SetRoomStatusDto): ReturnType<PropertyOwnerService['setRoomStatus']> { return this.properties.setRoomStatus(a.id, id, x.status); }
  @Delete('rooms/:roomId') @HttpCode(HttpStatus.NO_CONTENT) public async removeRoom(@CurrentActor() a: AuthenticatedActor, @Param('roomId') id: string): Promise<void> { await this.properties.deleteRoom(a.id, id); }
}
