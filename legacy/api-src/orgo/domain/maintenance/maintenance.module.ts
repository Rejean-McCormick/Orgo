import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Request } from 'express';

import { MaintenanceService } from './maintenance.service';
import { Maintenance } from './entities/maintenance.entity';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { MaintenanceQueryDto } from './dto/maintenance-query.dto';
import { CompleteMaintenanceDto } from './dto/complete-maintenance.dto';
import { ReassignMaintenanceDto } from './dto/reassign-maintenance.dto';

interface AuthenticatedUser {
  id?: string;
  userId?: string;
  orgId?: string;
  organizationId?: string;
  [key: string]: unknown;
}

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

class PagedMaintenanceResponseDto {
  @ApiProperty({ type: () => Maintenance, isArray: true })
  items: Maintenance[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}

@ApiTags('Maintenance')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly maintenanceService: MaintenanceService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List maintenance tasks' })
  @ApiOkResponse({ type: PagedMaintenanceResponseDto })
  @ApiUnauthorizedResponse()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: MaintenanceQueryDto,
  ): Promise<PagedMaintenanceResponseDto> {
    const orgId = this.getOrgId(req);
    return this.maintenanceService.findAll(orgId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a maintenance task by id' })
  @ApiParam({ name: 'id', description: 'Maintenance id' })
  @ApiOkResponse({ type: Maintenance })
  @ApiUnauthorizedResponse()
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<Maintenance> {
    const orgId = this.getOrgId(req);
    return this.maintenanceService.findOne(orgId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new maintenance task' })
  @ApiCreatedResponse({ type: Maintenance })
  @ApiUnauthorizedResponse()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMaintenanceDto,
  ): Promise<Maintenance> {
    const orgId = this.getOrgId(req);
    const userId = this.getUserId(req);
    return this.maintenanceService.create(orgId, userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an existing maintenance task' })
  @ApiParam({ name: 'id', description: 'Maintenance id' })
  @ApiOkResponse({ type: Maintenance })
  @ApiUnauthorizedResponse()
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceDto,
  ): Promise<Maintenance> {
    const orgId = this.getOrgId(req);
    return this.maintenanceService.update(orgId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a maintenance task' })
  @ApiParam({ name: 'id', description: 'Maintenance id' })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    const orgId = this.getOrgId(req);
    await this.maintenanceService.remove(orgId, id);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark a maintenance task as completed' })
  @ApiParam({ name: 'id', description: 'Maintenance id' })
  @ApiOkResponse({ type: Maintenance })
  @ApiUnauthorizedResponse()
  async complete(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CompleteMaintenanceDto,
  ): Promise<Maintenance> {
    const orgId = this.getOrgId(req);
    return this.maintenanceService.complete(orgId, id, dto);
  }

  @Post(':id/reassign')
  @ApiOperation({ summary: 'Reassign a maintenance task to another user' })
  @ApiParam({ name: 'id', description: 'Maintenance id' })
  @ApiOkResponse({ type: Maintenance })
  @ApiUnauthorizedResponse()
  async reassign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ReassignMaintenanceDto,
  ): Promise<Maintenance> {
    const orgId = this.getOrgId(req);
    return this.maintenanceService.reassign(orgId, id, dto);
  }

  private getOrgId(req: AuthenticatedRequest): string {
    const orgId = req.user?.orgId ?? req.user?.organizationId;
    if (!orgId) {
      throw new UnauthorizedException('Organization id not found on user');
    }
    return String(orgId);
  }

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.id ?? req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException('User id not found on user');
    }
    return String(userId);
  }
}
