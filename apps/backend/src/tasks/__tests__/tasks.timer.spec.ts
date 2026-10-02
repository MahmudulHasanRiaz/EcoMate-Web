import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from '../tasks.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Timer concurrency guards.
 *
 * startTimer previously used a findFirst-then-create with no unique index
 * behind it, so two simultaneous starts both read "no active entry" and both
 * inserted — double-counting the time. resumeTimer had no active guard at all,
 * so a double resume deterministically created two ACTIVE entries.
 *
 * The database now enforces this with a partial unique index
 * (TaskTimeEntry_one_active_per_task_employee_idx); these tests lock the
 * application-side guards and the P2002 mapping that turns a lost race into a
 * clear 400 instead of a 500.
 */
describe('TasksService — timer concurrency', () => {
  let service: TasksService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      task: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'task-1',
          assignedEmployeeId: 'emp-1',
          status: 'in_progress',
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      taskTimeEntry: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'te-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TasksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(TasksService);
  });

  describe('startTimer', () => {
    it('rejects when an active timer already exists', async () => {
      prisma.taskTimeEntry.findFirst.mockResolvedValue({ id: 'te-existing' });

      await expect(
        service.startTimer('task-1', { employeeId: 'emp-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
    });

    it('creates the timer when nothing is running', async () => {
      await service.startTimer('task-1', { employeeId: 'emp-1' });
      expect(prisma.taskTimeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taskId: 'task-1', employeeId: 'emp-1', status: 'active' }),
        }),
      );
    });

    // The pre-check cannot win a race, so the unique index is the real guard.
    // Its P2002 must surface as the same friendly 400, not a raw 500.
    it('maps the unique-index violation to a BadRequestException', async () => {
      prisma.taskTimeEntry.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(service.startTimer('task-1', { employeeId: 'emp-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lets unrelated database errors propagate', async () => {
      prisma.taskTimeEntry.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.startTimer('task-1', { employeeId: 'emp-1' })).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('resumeTimer', () => {
    it('rejects when a timer is already running', async () => {
      // First findFirst = the paused entry, second = the active guard.
      prisma.taskTimeEntry.findFirst
        .mockResolvedValueOnce({ id: 'te-paused', source: 'manual', notes: null })
        .mockResolvedValueOnce({ id: 'te-active' });

      await expect(service.resumeTimer('task-1', { employeeId: 'emp-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.taskTimeEntry.create).not.toHaveBeenCalled();
    });

    it('404s when there is no paused session to resume', async () => {
      prisma.taskTimeEntry.findFirst.mockResolvedValue(null);
      await expect(service.resumeTimer('task-1', { employeeId: 'emp-1' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resumes the paused session when nothing is active', async () => {
      prisma.taskTimeEntry.findFirst
        .mockResolvedValueOnce({ id: 'te-paused', source: 'manual', notes: 'note' })
        .mockResolvedValueOnce(null);

      await service.resumeTimer('task-1', { employeeId: 'emp-1' });

      expect(prisma.taskTimeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ taskId: 'task-1', employeeId: 'emp-1', status: 'active' }),
        }),
      );
    });

    it('maps the unique-index violation to a BadRequestException', async () => {
      prisma.taskTimeEntry.findFirst
        .mockResolvedValueOnce({ id: 'te-paused', source: 'manual', notes: null })
        .mockResolvedValueOnce(null);
      prisma.taskTimeEntry.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );

      await expect(service.resumeTimer('task-1', { employeeId: 'emp-1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});