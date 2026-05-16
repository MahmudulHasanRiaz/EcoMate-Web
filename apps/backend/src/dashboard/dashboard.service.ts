import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [totalUsers, activeUsers, totalTasks, completedTasks, totalRevenue] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { status: 'active' } }),
        this.prisma.task.count(),
        this.prisma.task.count({ where: { status: 'done' } }),
        45231.89, // Placeholder - will be replaced with real data
      ]);

    const recentUsers = await this.prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
      },
    });

    const recentTasks = await this.prisma.task.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        createdAt: true,
      },
    });

    const tasksByStatus = await this.prisma.task.groupBy({
      by: ['status'],
      _count: true,
    });

    const usersByRole = await this.prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    return {
      overview: {
        totalRevenue,
        subscriptions: activeUsers,
        sales: completedTasks,
        activeNow: activeUsers,
      },
      users: { total: totalUsers, active: activeUsers, byRole: usersByRole },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        byStatus: tasksByStatus,
      },
      recentUsers,
      recentTasks,
    };
  }

  async getAnalytics() {
    const totalUsers = await this.prisma.user.count();

    return {
      totalClicks: 1248,
      uniqueVisitors: 832,
      bounceRate: '42%',
      avgSession: '3m 24s',
      totalUsers,
      referrers: [
        { name: 'Direct', value: 512 },
        { name: 'Product Hunt', value: 238 },
        { name: 'Twitter', value: 174 },
        { name: 'Blog', value: 104 },
      ],
      devices: [
        { name: 'Desktop', value: 74 },
        { name: 'Mobile', value: 22 },
        { name: 'Tablet', value: 4 },
      ],
    };
  }
}
