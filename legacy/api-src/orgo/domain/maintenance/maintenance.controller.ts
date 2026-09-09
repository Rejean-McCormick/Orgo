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
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { UpdateMaintenanceDto } from './dto/update-maintenance.dto';
import { MaintenanceFiltersDto } from './dto/maintenance-filters.dto';
import { ChangeMaintenanceStatusDto } from './dto/change-maintenance-status.dto';
import { MaintenanceDto } from './dto/maintenance.dto';

@ApiTags('maintenance')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  @Post()
  @ApiOperation({ summary: 'Create a maintenance item' })
  @ApiCreatedResponse({ type: MaintenanceDto })
  create(
    @Body() createMaintenanceDto: CreateMaintenanceDto,
  ): Promise<MaintenanceDto> {
    return this.maintenanceService.create(createMaintenanceDto);
  }

  @Get()
  @ApiOperation({ summary: 'List maintenance items with optional filters' })
  @ApiOkResponse({ type: MaintenanceDto, isArray: true })
  findAll(
    @Query() filters: MaintenanceFiltersDto,
  ): Promise<MaintenanceDto[]> {
    return this.maintenanceService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single maintenance item by id' })
  @ApiOkResponse({ type: MaintenanceDto })
  findOne(@Param('id') id: string): Promise<MaintenanceDto> {
    return this.maintenanceService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a maintenance item' })
  @ApiOkResponse({ type: MaintenanceDto })
  update(
    @Param('id') id: string,
    @Body() updateMaintenanceDto: UpdateMaintenanceDto,
  ): Promise<MaintenanceDto> {
    return this.maintenanceService.update(id, updateMaintenanceDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Change status of a maintenance item' })
  @ApiOkResponse({ type: MaintenanceDto })
  changeStatus(
    @Param('id') id: string,
    @Body() changeStatusDto: ChangeMaintenanceStatusDto,
  ): Promise<MaintenanceDto> {
    return this.maintenanceService.changeStatus(id, changeStatusDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a maintenance item' })
  @ApiNoContentResponse()
  async remove(@Param('id') id: string): Promise<void> {
    await this.maintenanceService.remove(id);
  }
}
