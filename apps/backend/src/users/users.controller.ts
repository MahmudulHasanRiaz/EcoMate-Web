import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { assertCanAssignRole } from '../common/permissions/no-escalation';
import { getAllPermissions } from '../common/permissions/registry';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { BulkDeleteUsersDto, BulkUpdateUsersDto } from './dto/bulk-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('users')
@RequiresFeature('admin_staff_users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permissions('view_users')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    return this.usersService.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      status,
      role,
      sort,
      order,
    });
  }

  @Permissions('view_users')
  @Get('by-email/:email')
  async findByEmail(@Param('email') email: string) {
    return this.usersService.findByEmail(email);
  }

  @Permissions('view_users')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Permissions('create_users')
  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() user?: any) {
    // Preset supremacy: a restricted creator may not mint an admin or
    // superadmin account (that would bootstrap full access). Other roles
    // get role defaults (nothing) until HR assigns a preset.
    assertCanAssignRole(user?.permissions, dto.role, getAllPermissions());
    return this.usersService.create(dto);
  }

  @Permissions('edit_users')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user?: any) {
    assertCanAssignRole(user?.permissions, dto.role, getAllPermissions());
    return this.usersService.update(id, dto);
  }

  @Permissions('delete_users')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Permissions('delete_users')
  @Post('bulk-delete')
  async bulkDelete(@Body() dto: BulkDeleteUsersDto) {
    return this.usersService.bulkDelete(dto.ids);
  }

  @Permissions('edit_users')
  @Post('bulk-update')
  async bulkUpdate(@Body() dto: BulkUpdateUsersDto) {
    return this.usersService.bulkUpdateStatus(dto.ids, dto.status);
  }

  @Permissions('create_users')
  @Post('invite')
  async invite(@Body() dto: InviteUserDto) {
    return {
      message: `Invitation sent to ${dto.email}`,
      email: dto.email,
      role: dto.role,
    };
  }

  @RateLimitPolicy('api')
  @Get('settings')
  async getSettings(@CurrentUser() user: { userId: string }) {
    return this.usersService.getSettings(user.userId);
  }

  @RateLimitPolicy('api')
  @Put('settings')
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.usersService.updateSettings(user.userId, dto);
  }
}