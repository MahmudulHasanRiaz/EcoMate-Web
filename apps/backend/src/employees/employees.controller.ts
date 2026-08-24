import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('employees')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('view_hr')
@RequiresFeature('admin_employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @PermissionsAny('manage_employees')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user?: any) {
    return this.employeesService.create(dto, user?.userId ?? user?.id);
  }

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('status') status?: string,
    @Query('departmentId') departmentId?: string,
    @Query('designationId') designationId?: string,
    @Query('reportingToId') reportingToId?: string,
    @Query('attendanceMethod') attendanceMethod?: string,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.employeesService.findAll({
      page: page ? parseInt(page, 10) : 1,
      perPage: perPage ? parseInt(perPage, 10) : 20,
      status,
      departmentId,
      designationId,
      reportingToId,
      attendanceMethod,
      search,
      sortBy: sortBy as any,
      sortOrder: sortOrder as any,
    });
  }

  @Get('search/ba-users')
  searchBaUsers(@Query('q') q: string) {
    return this.employeesService.searchBaUsers(q || '');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }

  @Put(':id')
  @PermissionsAny('manage_employees')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() user?: any,
  ) {
    return this.employeesService.update(id, dto, user?.userId ?? user?.id);
  }

  @Delete(':id')
  @PermissionsAny('manage_employees')
  remove(@Param('id') id: string, @CurrentUser() user?: any) {
    return this.employeesService.remove(id, user?.userId ?? user?.id);
  }
}
