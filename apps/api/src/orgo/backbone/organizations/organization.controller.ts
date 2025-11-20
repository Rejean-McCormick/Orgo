// apps/api/src/orgo/backbone/organizations/organization.controller.ts

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationService } from './organization.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';

@ApiTags('organizations')
@Controller('api/v3/organizations')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  @ApiOperation({
    summary: 'List organizations',
    description:
      'Returns the list of organizations (tenants), optionally filtered by status or search term.',
  })
  @ApiOkResponse({
    description: 'List of organizations.',
    type: OrganizationResponseDto,
    isArray: true,
  })
  async listOrganizations(
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<OrganizationResponseDto[]> {
    return this.organizationService.listOrganizations(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a single organization',
    description: 'Returns a single organization by its ID.',
  })
  @ApiOkResponse({
    description: 'The organization matching the given ID.',
    type: OrganizationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Organization not found.',
  })
  async getOrganization(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.getOrganizationByIdOrThrow(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an organization',
    description:
      'Creates a new organization (tenant) with slug, display name, timezone, locale, status, and optional profile linkage.',
  })
  @ApiCreatedResponse({
    description: 'Organization created successfully.',
    type: OrganizationResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Validation error while creating the organization.',
  })
  async createOrganization(
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.createOrganization(dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an organization',
    description:
      'Updates an existing organization (tenant). Typically used to change display name, status, timezone, locale, or primary domain.',
  })
  @ApiOkResponse({
    description: 'Organization updated successfully.',
    type: OrganizationResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Organization not found.',
  })
  @ApiBadRequestResponse({
    description: 'Validation error while updating the organization.',
  })
  async updateOrganization(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.updateOrganization(id, dto);
  }
}
