import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StockRouterService } from './stock-router.service';

@Injectable()
export class InventoryEnabledGuard implements CanActivate {
  constructor(private readonly stockRouter: StockRouterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = await this.stockRouter.isInventoryManagementEnabled();
    if (!enabled) {
      throw new ForbiddenException('Inventory management is disabled');
    }
    return true;
  }
}
