import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';

test('desktop smoke keeps native runners opt-in and scheduled work weekly', () => {
  const workflow = parse(readFileSync('../../.github/workflows/orchestra-desktop-smoke.yml', 'utf8'));
  assert.deepEqual(workflow.on.schedule, [{cron: '0 7 * * 1'}]);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.on.workflow_dispatch.inputs.native.type, 'boolean');
  assert.equal(workflow.on.workflow_dispatch.inputs.native.default, false);
  assert.equal(workflow.jobs['desktop-smoke'].strategy.matrix.os,
    "${{ github.event_name == 'workflow_dispatch' && inputs.native && fromJSON('[\"ubuntu-latest\",\"windows-latest\"]') || fromJSON('[\"ubuntu-latest\"]') }}");
  assert.equal(workflow.jobs['desktop-smoke']['timeout-minutes'], 20);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.ok(workflow.jobs['desktop-smoke'].steps.find(step => step.name === 'Native Windows Electron smoke'));
});
