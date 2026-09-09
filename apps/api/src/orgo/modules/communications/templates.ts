import { DomainError } from '../../platform/contracts';
/** Plain text interpolation only. No expressions, HTML, filesystem or code evaluation. */
export function renderTemplate(
  template: string,
  variables: Record<string, string>,
) {
  return template.replace(
    /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g,
    (_match, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key))
        throw new DomainError(
          'TEMPLATE_VARIABLE_REQUIRED',
          `Missing template variable: ${key}`,
        );
      return variables[key];
    },
  );
}
