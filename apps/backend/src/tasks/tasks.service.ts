import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskStatus, TaskLabel, TaskPriority } from '@prisma/client';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async generateDisplayId(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `TASK-${yy}${mm}${dd}`;

    const lastTask = await this.prisma.task.findFirst({
      where: { displayId: { startsWith: prefix } },
      orderBy: { displayId: 'desc' },
      select: { displayId: true },
    });

    const nextNo = lastTask
      ? parseInt(lastTask.displayId.split('-').pop() || '0') + 1
      : 1;

    return `${prefix}-${String(nextNo).padStart(4, '0')}`;
  }

  async findAll(query: {
    page?: number;
    perPage?: number;
    search?: string;
    status?: string;
    label?: string;
    priority?: string;
    sort?: string;
    order?: string;
  }) {
    const page = query.page || 1;
    const perPage = query.perPage || 10;
    const skip = (page - 1) * perPage;

    const where: any = {};
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.label) {
      where.label = query.label;
    }
    if (query.priority) {
      where.priority = query.priority;
    }

    const orderBy: any = {};
    const sortField = query.sort || 'createdAt';
    const sortOrder = query.order || 'desc';
    orderBy[sortField] = sortOrder;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip,
        take: perPage,
        orderBy,
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: tasks,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async create(dto: CreateTaskDto, userId: string) {
    const displayId = await this.generateDisplayId();
    return this.prisma.task.create({
      data: {
        displayId,
        title: dto.title,
        status: dto.status,
        label: dto.label,
        priority: dto.priority,
        assignee: dto.assignee,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.assignee !== undefined) data.assignee = dto.assignee;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);

    return this.prisma.task.update({
      where: { id },
      data,
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    await this.prisma.task.delete({ where: { id } });
    return { message: 'Task deleted successfully' };
  }

  async bulkDelete(ids: string[]) {
    const result = await this.prisma.task.deleteMany({
      where: { id: { in: ids } },
    });
    return { message: `${result.count} tasks deleted successfully` };
  }

  async bulkUpdate(
    ids: string[],
    update: { status?: string; priority?: string },
  ) {
    const data: any = {};
    if (update.status) data.status = update.status;
    if (update.priority) data.priority = update.priority;

    const result = await this.prisma.task.updateMany({
      where: { id: { in: ids } },
      data,
    });
    return { message: `${result.count} tasks updated successfully` };
  }
}
