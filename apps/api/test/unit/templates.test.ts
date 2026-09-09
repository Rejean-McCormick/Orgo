import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from '../../src/orgo/modules/communications/templates';
test('message templates interpolate declared values without evaluating expressions', () => {
  assert.equal(
    renderTemplate('Hello {{ name }} / {{ message }}', {
      name: 'Sam',
      message: '{{not_recursively_evaluated}}',
    }),
    'Hello Sam / {{not_recursively_evaluated}}',
  );
  assert.throws(() => renderTemplate('{{missing}}', {}));
  assert.equal(
    renderTemplate('{{ process.exit() }}', {}),
    '{{ process.exit() }}',
  );
  assert.throws(() => renderTemplate('{{constructor}}', {}));
});
