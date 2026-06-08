import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { BulkDeleteUsersDto, BulkUpdateUsersDto } from './dto/bulk-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Roles('superadmin', 'admin')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Roles('superadmin', 'admin')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }

  @Roles('superadmin', 'admin')
  @Post('bulk-delete')
  async bulkDelete(@Body() dto: BulkDeleteUsersDto) {
    return this.usersService.bulkDelete(dto.ids);
  }

  @Roles('superadmin', 'admin')
  @Post('bulk-update')
  async bulkUpdate(@Body() dto: BulkUpdateUsersDto) {
    return this.usersService.bulkUpdateStatus(dto.ids, dto.status);
  }

  @Roles('superadmin', 'admin')
  @Post('invite')
  async invite(@Body() dto: InviteUserDto) {
    return {
      message: `Invitation sent to ${dto.email}`,
      email: dto.email,
      role: dto.role,
    };
  }
}
