// apps/api/src/orgo/domain/hr/hr.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { HrService } from './hr.service';

/**
 * HR domain controller.
 *
 * Exposes REST endpoints related to HR operations, such as
 * managing employees. All routes are prefixed with `/hr`.
 */
@Controller('hr')
export class HrController {
  constructor(private readonly hrService: HrService) {}

  /**
   * Basic health check for the HR module.
   *
   * GET /hr/health
   */
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * List employees with optional filters and pagination.
   *
   * GET /hr/employees?search=&page=&limit=
   */
  @Get('employees')
  async listEmployees(
    @Query()
    query: {
      search?: string;
      page?: number;
      limit?: number;
      [key: string]: unknown;
    },
  ): Promise<unknown> {
    return this.hrService.listEmployees(query);
  }

  /**
   * Get a single employee by ID.
   *
   * GET /hr/employees/:id
   */
  @Get('employees/:id')
  async getEmployee(
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.hrService.getEmployeeById(id);
  }

  /**
   * Create a new employee.
   *
   * POST /hr/employees
   */
  @Post('employees')
  async createEmployee(
    @Body() payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.hrService.createEmployee(payload);
  }

  /**
   * Partially update an existing employee.
   *
   * PATCH /hr/employees/:id
   */
  @Patch('employees/:id')
  async updateEmployee(
    @Param('id') id: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<unknown> {
    return this.hrService.updateEmployee(id, payload);
  }

  /**
   * Delete (or soft-delete) an employee.
   *
   * DELETE /hr/employees/:id
   */
  @Delete('employees/:id')
  async deleteEmployee(
    @Param('id') id: string,
  ): Promise<unknown> {
    return this.hrService.deleteEmployee(id);
  }
}
