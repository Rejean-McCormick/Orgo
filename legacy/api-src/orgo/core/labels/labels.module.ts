import { Module } from '@nestjs/common';
import { PersistenceModule } from '../../../persistence/persistence.module';
import { LabelService } from './label.service';
import { LabelRoutingService } from './label-routing.service';
import { RoutingRuleService } from './routing-rule.service';

@Module({
  imports: [PersistenceModule],
  providers: [LabelService, LabelRoutingService, RoutingRuleService],
  exports: [LabelService, LabelRoutingService, RoutingRuleService],
})
export class LabelsModule {}
