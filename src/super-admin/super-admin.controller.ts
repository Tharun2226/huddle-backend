import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, SuperAdminOnly } from '../common/roles.decorator';
import { SuperAdminService } from './super-admin.service';
import { CreateOrganizationDto } from './dto/create-org.dto';

@ApiTags('super-admin')
@ApiBearerAuth('access-token')
@Controller('super-admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@SuperAdminOnly()
export class SuperAdminController {
  constructor(private readonly service: SuperAdminService) {}

  @Post('organizations')
  createOrganization(@Body() dto: CreateOrganizationDto) {
    return this.service.createOrganization(dto);
  }

  @Get('organizations')
  listOrganizations() {
    return this.service.listOrganizations();
  }

  @Get('organizations/:id')
  getOrganization(@Param('id') id: string) {
    return this.service.getOrganizationDetail(id);
  }

  @Patch('organizations/:id/status')
  updateOrganizationStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.service.updateOrganizationStatus(id, isActive);
  }
}
