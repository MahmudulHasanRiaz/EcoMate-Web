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
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { BulkDeleteTasksDto, BulkUpdateTasksDto } from './dto/bulk-task.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

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
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  async create(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.tasksService.create(dto, user.userId);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() dto: BulkDeleteTasksDto) {
    return this.tasksService.bulkDelete(dto.ids);
  }

  @Post('bulk-update')
  async bulkUpdate(@Body() dto: BulkUpdateTasksDto) {
    return this.tasksService.bulkUpdate(dto.ids, {
      status: dto.status,
      priority: dto.priority,
    });
  }
}
