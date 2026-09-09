import { canonical, DomainError } from '../../platform/contracts';
import {
  ResolvedAction,
  WorkflowContent,
  WorkflowContext,
} from './workflow.contract';

/** No clock, IO, random input or mutations. Order is persisted rule order, then action order. */
export function evaluate(
  content: WorkflowContent,
  context: WorkflowContext,
): ResolvedAction[] {
  const searchable =
    `${context.title ?? ''} ${context.description ?? ''}`.toLowerCase();
  return content.rules.flatMap((rule) => {
    const m = rule.match;
    if (
      !rule.enabled ||
      (m.source && m.source !== context.source) ||
      (m.type && m.type !== context.type) ||
      (m.category && m.category !== context.category) ||
      (m.severity && m.severity !== context.severity) ||
      (m.labelBase && m.labelBase !== Number(context.label?.split('.')[0])) ||
      (m.labelPrefix && !context.label?.startsWith(m.labelPrefix)) ||
      (m.keywordsAny &&
        !m.keywordsAny.some((k) => searchable.includes(k.toLowerCase()))) ||
      (m.keywordsAll &&
        !m.keywordsAll.every((k) => searchable.includes(k.toLowerCase()))) ||
      (m.metadata &&
        !Object.entries(m.metadata).every(
          ([k, v]) => canonical(context.metadata?.[k]) === canonical(v),
        ))
    )
      return [];
    return rule.actions.map((action, actionIndex) => ({
      ruleId: rule.id,
      actionIndex,
      action: structuredClone(action),
    }));
  });
}
export function resolveInput(
  value: unknown,
  bindings: Record<string, unknown>,
): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const key = value.slice(1);
    if (
      !Object.prototype.hasOwnProperty.call(bindings, key) ||
      bindings[key] === undefined
    )
      throw new DomainError(
        'UNBOUND_REFERENCE',
        `Unbound workflow reference: ${value}`,
      );
    return structuredClone(bindings[key]);
  }
  if (Array.isArray(value))
    return value.map((item) => resolveInput(item, bindings));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveInput(v, bindings)]),
    );
  return value;
}
