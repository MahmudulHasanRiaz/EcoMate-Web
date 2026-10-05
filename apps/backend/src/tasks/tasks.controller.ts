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
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { BulkDeleteTasksDto, BulkUpdateTasksDto } from './dto/bulk-task.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LogTaskTimeDto, StartTaskTimerDto, StopTaskTimerDto } from './dto/time-entry.dto';

@Controller('tasks')
@RequiresFeature('admin_tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Roles('superadmin', 'admin', 'employee')
  @Get('productivity-report')
  async getProductivityReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('departmentId') departmentId?: string,
    @Query('employeeId') employeeId?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.tasksService.getProductivityReport({
      from,
      to,
      departmentId,
      employeeId,
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get()
  async findAll(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('label') label?: string,
    @Query('priority') priority?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('assignedEmployeeId') assignedEmployeeId?: string,
  ) {
    return this.tasksService.findAll({
      page: page ? parseInt(page) : undefined,
      perPage: perPage ? parseInt(perPage) : undefined,
      search,
      status,
      label,
      priority,
      sort,
      order,
      assignedEmployeeId,
    });
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post()
  async create(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.tasksService.create(dto, user.userId);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('bulk-delete')
  async bulkDelete(@Body() dto: BulkDeleteTasksDto) {
    return this.tasksService.bulkDelete(dto.ids);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post('bulk-update')
  async bulkUpdate(@Body() dto: BulkUpdateTasksDto) {
    return this.tasksService.bulkUpdate(dto.ids, {
      status: dto.status,
      priority: dto.priority,
    });
  }

  // ── Time tracking endpoints ─────────────────────────────────────────────────

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/timer/start')
  async startTimer(
    @Param('id') id: string,
    @Body() dto: StartTaskTimerDto,
  ) {
    return this.tasksService.startTimer(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/timer/pause')
  async pauseTimer(
    @Param('id') id: string,
    @Body() body: { employeeId: string; notes?: string },
  ) {
    return this.tasksService.pauseTimer(id, body);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/timer/resume')
  async resumeTimer(
    @Param('id') id: string,
    @Body() body: { employeeId: string; notes?: string },
  ) {
    return this.tasksService.resumeTimer(id, body);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/timer/stop')
  async stopTimer(
    @Param('id') id: string,
    @Body() dto: StopTaskTimerDto,
  ) {
    return this.tasksService.stopTimer(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Post(':id/time-entries')
  async logTime(
    @Param('id') id: string,
    @Body() dto: LogTaskTimeDto,
  ) {
    return this.tasksService.logTime(id, dto);
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get(':id/time-entries')
  async getTimeEntries(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.tasksService.getTimeEntries(
      id,
      page ? parseInt(page) : 1,
      perPage ? parseInt(perPage) : 20,
    );
  }

  @Roles('superadmin', 'admin', 'employee')
  @Get('employee/:employeeId')
  async getEmployeeTaskList(
    @Param('employeeId') employeeId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.tasksService.getEmployeeTaskList(employeeId, {
      status,
      page: page ? parseInt(page) : 1,
      perPage: perPage ? parseInt(perPage) : 20,
    });
  }
}
