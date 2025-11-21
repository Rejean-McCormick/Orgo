import { Module } from '@nestjs/common';
import { HrModuleService } from './hr.service';
import { HrModuleController } from './hr.controller';

/**
 * Canonical domain type used for HR Tasks (`Task.type` = "hr_case").
 * This must stay aligned with the hr_case domain module config (hr_case_module.yaml)
 * and the global domain module specification.
 */
export const HR_DOMAIN_TYPE = 'hr_case';

@Module({
  controllers: [HrModuleController],
  providers: [HrModuleService],
  exports: [HrModuleService],
})
export class HrModule {}
