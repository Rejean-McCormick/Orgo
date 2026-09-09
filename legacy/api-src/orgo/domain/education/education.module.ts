import { Module } from '@nestjs/common';
import { EducationModuleService } from './education-module.service';
import { EducationController } from './education.controller';

@Module({
  controllers: [EducationController],
  providers: [EducationModuleService],
  exports: [EducationModuleService],
})
export class EducationModule {}
