import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import {
  LogTaskTimeDto,
  StartTaskTimerDto,
  StopTaskTimerDto,
} from './dto/time-entry.dto';
import { TaskStatus, TaskLabel, TaskPriority } from '@prisma/client';
import { dhakaStartOfDay } from '../hr-attendance/attendance-date';

const TASK_INCLUDE = {
  createdBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  assignedEmployee: {
    select: {
      id: true,
      employeeId: true,
      betterAuthUser: { select: { name: true, email: true, image: true } },
    },
  },
} as const;

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

  /** Recalculates actualMinutes from all completed time entries */
  private async recalcActualMinutes(taskId: string): Promise<void> {
    const entries = await this.prisma.taskTimeEntry.findMany({
      where: { taskId, status: 'completed' },
      select: { durationSec: true },
    });
    const totalSec = entries.reduce((s, e) => s + e.durationSec, 0);
    await this.prisma.task.update({
      where: { id: taskId },
      data: { actualMinutes: Math.ceil(totalSec / 60) },
    });
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
    assignedEmployeeId?: string;
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
    if (query.status) where.status = query.status;
    if (query.label) where.label = query.label;
    if (query.priority) where.priority = query.priority;
    if (query.assignedEmployeeId) where.assignedEmployeeId = query.assignedEmployeeId;

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
        include: TASK_INCLUDE,
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: tasks,
      meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) },
    };
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        ...TASK_INCLUDE,
        timeEntries: {
          orderBy: { startedAt: 'desc' },
          take: 20,
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                betterAuthUser: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');
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
        assignedEmployeeId: dto.assignedEmployeeId ?? null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        description: dto.description,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: userId,
      },
      include: TASK_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.assignee !== undefined) data.assignee = dto.assignee;
    if (dto.assignedEmployeeId !== undefined) data.assignedEmployeeId = dto.assignedEmployeeId;
    if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dueDate !== undefined) data.dueDate = new Date(dto.dueDate);

    return this.prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });
  }

  async remove(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.task.delete({ where: { id } });
    return { message: 'Task deleted successfully' };
  }

  async bulkDelete(ids: string[]) {
    const result = await this.prisma.task.deleteMany({ where: { id: { in: ids } } });
    return { message: `${result.count} tasks deleted successfully` };
  }

  async bulkUpdate(ids: string[], update: { status?: string; priority?: string }) {
    const data: any = {};
    if (update.status) data.status = update.status;
    if (update.priority) data.priority = update.priority;
    const result = await this.prisma.task.updateMany({ where: { id: { in: ids } }, data });
    return { message: `${result.count} tasks updated successfully` };
  }

  // ── Time tracking ────────────────────────────────────────────────────────────

  /** Start a new timer session for an employee on a task */
  async startTimer(taskId: string, dto: StartTaskTimerDto) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    // Only one active entry per employee+task at a time
    const existing = await this.prisma.taskTimeEntry.findFirst({
      where: { taskId, employeeId: dto.employeeId, status: 'active' },
    });
    if (existing) {
      throw new BadRequestException('A timer is already running for this task. Pause or stop it first.');
    }

    const entry = await this.prisma.taskTimeEntry.create({
      data: {
        taskId,
        employeeId: dto.employeeId,
        startedAt: new Date(),
        status: 'active',
        source: dto.source ?? 'manual',
        notes: dto.notes ?? null,
      },
    });

    // Auto-assign employee to task if not already set
    if (!task.assignedEmployeeId) {
      await this.prisma.task.update({
        where: { id: taskId },
        data: { assignedEmployeeId: dto.employeeId, status: TaskStatus.in_progress },
      });
    } else if (task.status === TaskStatus.todo || task.status === TaskStatus.backlog) {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.in_progress } });
    }

    return entry;
  }

  /** Pause an active timer — records elapsed seconds so far */
  async pauseTimer(taskId: string, dto: { employeeId: string; notes?: string }) {
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { taskId, employeeId: dto.employeeId, status: 'active' },
    });
    if (!entry) throw new NotFoundException('No active timer found for this task and employee.');

    const now = new Date();
    const elapsedSec = Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000);

    const updated = await this.prisma.taskTimeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt: now,
        durationSec: elapsedSec,
        status: 'paused',
        notes: dto.notes ?? entry.notes,
      },
    });

    await this.recalcActualMinutes(taskId);
    return updated;
  }

  /** Resume a paused timer — creates a new active entry */
  async resumeTimer(taskId: string, dto: { employeeId: string; notes?: string }) {
    const paused = await this.prisma.taskTimeEntry.findFirst({
      where: { taskId, employeeId: dto.employeeId, status: 'paused' },
      orderBy: { startedAt: 'desc' },
    });
    if (!paused) throw new NotFoundException('No paused timer found for this task and employee.');

    // Create a new active session
    const entry = await this.prisma.taskTimeEntry.create({
      data: {
        taskId,
        employeeId: dto.employeeId,
        startedAt: new Date(),
        status: 'active',
        source: paused.source,
        notes: dto.notes ?? paused.notes,
      },
    });

    return entry;
  }

  /** Stop an active timer and optionally mark task as done */
  async stopTimer(taskId: string, dto: StopTaskTimerDto) {
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { taskId, employeeId: dto.employeeId, status: 'active' },
    });
    if (!entry) throw new NotFoundException('No active timer found for this task and employee.');

    const now = new Date();
    const elapsedSec = Math.floor((now.getTime() - entry.startedAt.getTime()) / 1000);

    const updated = await this.prisma.taskTimeEntry.update({
      where: { id: entry.id },
      data: {
        endedAt: now,
        durationSec: elapsedSec,
        status: 'completed',
        notes: dto.notes ?? entry.notes,
      },
    });

    await this.recalcActualMinutes(taskId);

    if (dto.markDone) {
      await this.prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.done } });
    }

    return updated;
  }

  /** Manually log time for a task */
  async logTime(taskId: string, dto: LogTaskTimeDto) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    const durationSec = dto.durationMinutes * 60;
    const startedAt = dto.startedAt ? new Date(dto.startedAt) : new Date(Date.now() - durationSec * 1000);
    const endedAt = new Date(startedAt.getTime() + durationSec * 1000);

    const entry = await this.prisma.taskTimeEntry.create({
      data: {
        taskId,
        employeeId: dto.employeeId,
        startedAt,
        endedAt,
        durationSec,
        status: 'completed',
        source: 'manual',
        notes: dto.notes ?? null,
      },
    });

    await this.recalcActualMinutes(taskId);
    return entry;
  }

  /** Get time entries for a task */
  async getTimeEntries(taskId: string, page = 1, perPage = 20) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    const [entries, total] = await Promise.all([
      this.prisma.taskTimeEntry.findMany({
        where: { taskId },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              betterAuthUser: { select: { name: true, image: true } },
            },
          },
        },
      }),
      this.prisma.taskTimeEntry.count({ where: { taskId } }),
    ]);

    return { data: entries, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }

  // ── Productivity reporting ────────────────────────────────────────────────────

  /**
   * Aggregated task productivity per employee.
   * Date semantics: tasks are bucketed by their createdAt (assignment date)
   * unless status=done, in which case completion is determined by updatedAt.
   * We count assigned = created in range, completed = status=done + updatedAt in range.
   */
  async getProductivityReport(query: {
    from?: string;
    to?: string;
    departmentId?: string;
    employeeId?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const perPage = query.perPage && query.perPage > 0 ? Number(query.perPage) : 20;

    const now = new Date();
    const defaultStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startDate = query.from ? dhakaStartOfDay(query.from) : defaultStart;
    const endDate = query.to
      ? new Date(dhakaStartOfDay(query.to).getTime() + 86400000)
      : new Date(now.getTime() + 86400000);

    const empWhere: any = { status: 'active' };
    if (query.employeeId) empWhere.id = query.employeeId;
    if (query.departmentId) empWhere.departmentId = query.departmentId;

    const [employees, totalEmployees] = await Promise.all([
      this.prisma.employee.findMany({
        where: empWhere,
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          betterAuthUser: { select: { name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.employee.count({ where: empWhere }),
    ]);

    const empIds = employees.map((e) => e.id);

    // Tasks assigned in range
    const [assignedTasks, completedTasks, timeEntries] = await Promise.all([
      this.prisma.task.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          assignedEmployeeId: { in: empIds },
          createdAt: { gte: startDate, lt: endDate },
        },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['assignedEmployeeId'],
        where: {
          assignedEmployeeId: { in: empIds },
          status: 'done',
          updatedAt: { gte: startDate, lt: endDate },
        },
        _count: { _all: true },
      }),
      this.prisma.taskTimeEntry.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: empIds },
          status: 'completed',
          startedAt: { gte: startDate, lt: endDate },
        },
        _sum: { durationSec: true },
        _count: { _all: true },
        _avg: { durationSec: true },
      }),
    ]);

    const assignedMap = new Map(assignedTasks.map((r) => [r.assignedEmployeeId, r._count._all]));
    const completedMap = new Map(completedTasks.map((r) => [r.assignedEmployeeId, r._count._all]));
    const timeMap = new Map(timeEntries.map((r) => [r.employeeId, r]));

    const rows = employees.map((emp) => {
      const assigned = assignedMap.get(emp.id) ?? 0;
      const completed = completedMap.get(emp.id) ?? 0;
      const pending = Math.max(0, assigned - completed);
      const completionRate = assigned > 0 ? Math.round((completed / assigned) * 1000) / 10 : 0;
      const te = timeMap.get(emp.id);
      const totalTimeSec = te?._sum.durationSec ?? 0;
      const avgDurationSec = te?._avg.durationSec ?? 0;

      return {
        employeeId: emp.id,
        employeeCode: emp.employeeId,
        name: emp.betterAuthUser?.name || 'Unknown',
        email: emp.betterAuthUser?.email || '',
        avatar: emp.betterAuthUser?.image ?? emp.profilePictureUrl ?? null,
        department: emp.department?.name ?? null,
        designation: emp.designation?.name ?? null,
        assigned,
        completed,
        pending,
        completionRate,
        timeSpentMinutes: Math.ceil(totalTimeSec / 60),
        timeSpentDisplay: formatDuration(totalTimeSec),
        avgTaskDurationMinutes: Math.ceil(avgDurationSec / 60),
        avgTaskDurationDisplay: formatDuration(avgDurationSec),
      };
    });

    return {
      data: rows,
      meta: {
        page,
        perPage,
        total: totalEmployees,
        totalPages: Math.ceil(totalEmployees / perPage),
        from: startDate.toISOString().split('T')[0],
        to: new Date(endDate.getTime() - 86400000).toISOString().split('T')[0],
        dateSemantics: {
          assigned: 'Task.createdAt within date range',
          completed: 'Task.status=done AND Task.updatedAt within date range',
          timeSpent: 'TaskTimeEntry.startedAt within date range',
        },
      },
    };
  }

  async getEmployeeTaskList(
    employeeId: string,
    query: { status?: string; page?: number; perPage?: number },
  ) {
    const page = query.page && query.page > 0 ? Number(query.page) : 1;
    const perPage = query.perPage && query.perPage > 0 ? Number(query.perPage) : 20;

    const where: any = { assignedEmployeeId: employeeId };
    if (query.status) where.status = query.status;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: TASK_INCLUDE,
      }),
      this.prisma.task.count({ where }),
    ]);

    return { data: tasks, meta: { total, page, perPage, totalPages: Math.ceil(total / perPage) } };
  }
}

function formatDuration(totalSec: number): string {
  if (!totalSec) return '0m';
  const h = Math.floor(totalSec / 3600);
  const m = Math.ceil((totalSec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
