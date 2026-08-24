import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { RequiresFeature } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { PermissionsAny } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CommissionsService } from './commissions.service';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import { SetCommissionRuleActiveDto } from './dto/update-commission-rule.dto';
import { ReverseEarningDto } from './dto/reverse-earning.dto';

@Controller('hr')
@Roles('superadmin', 'admin', 'manager')
@PermissionsAny('manage_commissions')
@RequiresFeature('admin_hr')
export class CommissionsController {
  constructor(private readonly commissionsService: CommissionsService) {}

  @Post('commissions/rules')
  createRule(
    @Body() dto: CreateCommissionRuleDto,
    @CurrentUser() user?: any,
  ) {
    return this.commissionsService.createRule(
      dto,
      user?.userId ?? user?.id,
    );
  }

  @Get('commissions/rules')
  listRules(
    @Query('employeeId') employeeId?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.commissionsService.listRules({
      employeeId,
      isActive: isActive === undefined ? undefined : isActive === 'true',
    });
  }

  @Patch('commissions/rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: UpdateCommissionRuleDto) {
    return this.commissionsService.updateRule(id, dto);
  }

  @Post('commissions/rules/:id/active')
  setActive(
    @Param('id') id: string,
    @Body() dto: SetCommissionRuleActiveDto,
  ) {
    return this.commissionsService.setActive(id, dto.isActive);
  }

  @Delete('commissions/rules/:id')
  deleteRule(@Param('id') id: string) {
    return this.commissionsService.deleteRule(id);
  }

  @Get('commissions/earnings')
  listEarnings(
    @Query('employeeId') employeeId?: string,
    @Query('reversed') reversed?: string,
    @Query('inPayroll') inPayroll?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.commissionsService.listEarnings(
      { employeeId, reversed, inPayroll },
      page ? parseInt(page, 10) : 1,
      perPage ? parseInt(perPage, 10) : 20,
    );
  }

  @Post('commissions/earnings/:id/reverse')
  reverseEarning(
    @Param('id') id: string,
    @Body() dto: ReverseEarningDto,
    @CurrentUser() user?: any,
  ) {
    return this.commissionsService.reverseEarning(
      id,
      dto,
      user?.userId ?? user?.id,
    );
  }
}
