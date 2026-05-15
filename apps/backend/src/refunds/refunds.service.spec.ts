import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException, BadRequestException } from '@nestjs/common'
import { RefundsService } from './refunds.service'
import { PrismaService } from '../prisma/prisma.service'

describe('RefundsService', () => {
  let service: RefundsService
  let prisma: PrismaService

  const mockRefund = {
    id: 'refund-id-1',
    orderId: 'order-id-1',
    amount: 1500,
    reason: 'Customer request',
    notes: 'Refund for damaged item',
    status: 'pending',
    processedBy: null,
    processedAt: null,
    createdAt: new Date('2025-01-15'),
    updatedAt: new Date('2025-01-15'),
    order: { displayId: 'ORD-250115-0001' },
    processor: null,
  }

  const mockRefundApproved = {
    ...mockRefund,
    id: 'refund-id-2',
    status: 'approved',
    processedBy: 'admin-id-1',
    processedAt: new Date('2025-01-16'),
    processor: { id: 'admin-id-1', firstName: 'Admin', lastName: 'User' },
  }

  const mockRefundCompleted = {
    ...mockRefund,
    id: 'refund-id-3',
    status: 'completed',
  }

  const mockRefundRejected = {
    ...mockRefund,
    id: 'refund-id-4',
    status: 'rejected',
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        {
          provide: PrismaService,
          useValue: {
            refund: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            order: {
              findUniqueOrThrow: jest.fn(),
            },
          },
        },
      ],
    }).compile()

    service = module.get<RefundsService>(RefundsService)
    prisma = module.get<PrismaService>(PrismaService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('findAll', () => {
    it('should return paginated refunds', async () => {
      ;(prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund, mockRefundApproved])
      ;(prisma.refund.count as jest.Mock).mockResolvedValue(2)

      const result = await service.findAll({ page: 1, perPage: 10 })

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      )
      expect(prisma.refund.count).toHaveBeenCalled()
      expect(result.data).toHaveLength(2)
      expect(result.meta).toEqual({ total: 2, page: 1, perPage: 10, totalPages: 1 })
    })

    it('should filter by status', async () => {
      ;(prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund])
      ;(prisma.refund.count as jest.Mock).mockResolvedValue(1)

      await service.findAll({ status: 'pending' })

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      )
    })

    it('should filter by orderId', async () => {
      ;(prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund])
      ;(prisma.refund.count as jest.Mock).mockResolvedValue(1)

      await service.findAll({ orderId: 'order-id-1' })

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { orderId: 'order-id-1' } }),
      )
    })

    it('should use default pagination values', async () => {
      ;(prisma.refund.findMany as jest.Mock).mockResolvedValue([])
      ;(prisma.refund.count as jest.Mock).mockResolvedValue(0)

      await service.findAll({})

      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      )
    })

    it('should calculate totalPages correctly', async () => {
      ;(prisma.refund.findMany as jest.Mock).mockResolvedValue([mockRefund])
      ;(prisma.refund.count as jest.Mock).mockResolvedValue(25)

      const result = await service.findAll({ page: 1, perPage: 10 })

      expect(result.meta.totalPages).toBe(3)
    })
  })

  describe('findOne', () => {
    it('should return a refund by id', async () => {
      ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefundApproved)

      const result = await service.findOne('refund-id-2')

      expect(prisma.refund.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'refund-id-2' } }),
      )
      expect(result).toEqual(mockRefundApproved)
      expect(result.order.displayId).toBe('ORD-250115-0001')
    })

    it('should throw NotFoundException if refund not found', async () => {
      ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(NotFoundException)
    })
  })

  describe('create', () => {
    const createDto = {
      orderId: 'order-id-1',
      amount: 1500,
      reason: 'Customer request',
      notes: 'Refund for damaged item',
    }

    it('should create a refund successfully', async () => {
      ;(prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'order-id-1', displayId: 'ORD-250115-0001' })
      ;(prisma.refund.create as jest.Mock).mockResolvedValue(mockRefund)

      const result = await service.create(createDto)

      expect(prisma.order.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: createDto.orderId } })
      expect(prisma.refund.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            orderId: createDto.orderId,
            amount: createDto.amount,
            reason: createDto.reason,
            notes: createDto.notes,
          },
        }),
      )
      expect(result.status).toBe('pending')
    })

    it('should throw error if order does not exist (findUniqueOrThrow)', async () => {
      const notFoundError = new Error('Not found')
      ;(prisma.order.findUniqueOrThrow as jest.Mock).mockRejectedValue(notFoundError)

      await expect(service.create(createDto)).rejects.toThrow('Not found')
      expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('should create refund with minimal fields', async () => {
      const minimalDto = { orderId: 'order-id-1', amount: 500 }

      ;(prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'order-id-1' })
      ;(prisma.refund.create as jest.Mock).mockResolvedValue({
        ...mockRefund,
        reason: undefined,
        notes: undefined,
      })

      await service.create(minimalDto)

      const createCall = (prisma.refund.create as jest.Mock).mock.calls[0][0]
      expect(createCall.data.amount).toBe(500)
    })
  })

  describe('updateStatus', () => {
    const processedBy = 'admin-id-1'

    describe('valid transitions', () => {
      it('should transition from pending to approved', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundApproved)

        const result = await service.updateStatus('refund-id-1', { status: 'approved' }, processedBy)

        expect(prisma.refund.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'refund-id-1' },
            data: expect.objectContaining({ status: 'approved', processedBy }),
          }),
        )
        expect(result.status).toBe('approved')
      })

      it('should transition from pending to rejected', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundRejected)

        const result = await service.updateStatus('refund-id-1', { status: 'rejected' }, processedBy)

        expect(result.status).toBe('rejected')
      })

      it('should transition from approved to completed', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefundApproved)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundCompleted)

        const result = await service.updateStatus('refund-id-2', { status: 'completed' }, processedBy)

        expect(result.status).toBe('completed')
      })

      it('should transition from approved to rejected', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefundApproved)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue({ ...mockRefundApproved, status: 'rejected' })

        const result = await service.updateStatus('refund-id-2', { status: 'rejected' }, processedBy)

        expect(result.status).toBe('rejected')
      })
    })

    describe('invalid transitions', () => {
      it('should throw BadRequestException when transitioning from completed', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefundCompleted)

        await expect(
          service.updateStatus('refund-id-3', { status: 'approved' }, processedBy),
        ).rejects.toThrow(BadRequestException)
      })

      it('should throw BadRequestException when transitioning from rejected', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefundRejected)

        await expect(
          service.updateStatus('refund-id-4', { status: 'approved' }, processedBy),
        ).rejects.toThrow(BadRequestException)
      })

      it('should throw BadRequestException when transitioning from pending to completed (skip approved)', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)

        await expect(
          service.updateStatus('refund-id-1', { status: 'completed' }, processedBy),
        ).rejects.toThrow(BadRequestException)
      })

      it('should include allowed transitions in error message', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)

        try {
          await service.updateStatus('refund-id-1', { status: 'completed' }, processedBy)
          fail('Expected BadRequestException was not thrown')
        } catch (error) {
          expect(error.message).toContain('Cannot transition from "pending" to "completed"')
          expect(error.message).toContain('approved')
          expect(error.message).toContain('rejected')
        }
      })
    })

    describe('edge cases', () => {
      it('should throw NotFoundException if refund not found', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(null)

        await expect(
          service.updateStatus('nonexistent-id', { status: 'approved' }, processedBy),
        ).rejects.toThrow(NotFoundException)
      })

      it('should set processedAt when updating status', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundApproved)

        await service.updateStatus('refund-id-1', { status: 'approved' }, processedBy)

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0]
        expect(updateCall.data.processedAt).toBeDefined()
        expect(updateCall.data.processedAt).toBeInstanceOf(Date)
      })

      it('should preserve notes when provided in update', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundApproved)

        await service.updateStatus(
          'refund-id-1',
          { status: 'approved', notes: 'Approved after verification' },
          processedBy,
        )

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0]
        expect(updateCall.data.notes).toBe('Approved after verification')
      })

      it('should keep existing notes when no new notes provided', async () => {
        ;(prisma.refund.findUnique as jest.Mock).mockResolvedValue(mockRefund)
        ;(prisma.refund.update as jest.Mock).mockResolvedValue(mockRefundApproved)

        await service.updateStatus('refund-id-1', { status: 'approved' }, processedBy)

        const updateCall = (prisma.refund.update as jest.Mock).mock.calls[0][0]
        expect(updateCall.data.notes).toBe(mockRefund.notes)
      })
    })
  })
})
