import { z } from 'zod';
import { category, severity } from '../../platform/contracts';
const actionTypes = [
  'CREATE_CASE',
  'CREATE_TASK',
  'UPDATE_TASK',
  'ASSIGN_TASK',
  'ROUTE',
  'ESCALATE',
  'ATTACH_TEMPLATE',
  'SET_METADATA',
  'ADD_LABEL',
  'NOTIFY',
  'REQUEST_INTEGRATION',
  'START_PROCESS',
] as const;
export const actionSchema = z
  .object({
    type: z.enum(actionTypes),
    target: z.string().max(200).optional(),
    input: z.record(z.unknown()).default({}),
  })
  .strict();
export const workflowSchema = z
  .object({
    rules: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            enabled: z.boolean().default(true),
            match: z
              .object({
                source: z.enum(['EMAIL', 'API', 'SYSTEM', 'TIMER']).optional(),
                type: z.string().optional(),
                category: category.optional(),
                severity: severity.optional(),
                labelBase: z.number().int().positive().optional(),
                labelPrefix: z.string().optional(),
                keywordsAny: z.array(z.string()).optional(),
                keywordsAll: z.array(z.string()).optional(),
                metadata: z.record(z.unknown()).optional(),
              })
              .strict(),
            actions: z.array(actionSchema).min(1).max(50),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.rules.map((r) => r.id)).size !== v.rules.length)
      ctx.addIssue({ code: 'custom', message: 'Rule ids must be unique' });
  });
export type WorkflowContent = z.infer<typeof workflowSchema>;
export type WorkflowAction = z.infer<typeof actionSchema>;
export interface WorkflowContext {
  organizationId: string;
  source: 'EMAIL' | 'API' | 'SYSTEM' | 'TIMER';
  type?: string;
  category?: string;
  severity?: string;
  label?: string;
  title?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}
export interface ResolvedAction {
  ruleId: string;
  actionIndex: number;
  action: WorkflowAction;
}
