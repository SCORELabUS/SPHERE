import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canPreviewOrganization,
  memberViewTarget,
  previewMembers,
  readViewAsRequest,
  resolveOrgView,
  viewAsKey,
  withViewAs,
} from '../src/modules/organization/utils/view-as.ts';
import type { OrgMemberWithUser } from '../src/modules/organization/api/organizationsApi.ts';

const member = (id: string, role: OrgMemberWithUser['role']): OrgMemberWithUser => ({
  id: `membership-${id}`,
  role,
  joinedAt: '',
  user: { id, username: id, email: `${id}@example.com`, avatar: null },
});
const members = [member('owner', 'OWNER'), member('zoe', 'MEMBER'), member('admin', 'ADMIN'), member('ana', 'MEMBER')];

test('reads which view the URL asks for', () => {
  assert.deepEqual(readViewAsRequest(new URLSearchParams('view=visitor')), { kind: 'visitor' });
  assert.deepEqual(readViewAsRequest(new URLSearchParams('view=member&as=ana')), { kind: 'member', userId: 'ana' });
  assert.deepEqual(readViewAsRequest(new URLSearchParams('view=member')), { kind: 'member', userId: null });
  assert.deepEqual(readViewAsRequest(new URLSearchParams('view=member&as=any')), { kind: 'member', userId: null });
  assert.equal(readViewAsRequest(new URLSearchParams('')), null);
  assert.equal(readViewAsRequest(new URLSearchParams('view=Visitor')), null);
  assert.equal(readViewAsRequest(new URLSearchParams('as=ana')), null);
});

test('writes the view into the URL, keeping the other parameters', () => {
  const base = new URLSearchParams('tab=pricings');
  assert.equal(withViewAs(base, { kind: 'visitor' }).toString(), 'tab=pricings&view=visitor');
  assert.equal(withViewAs(base, { kind: 'member', userId: 'ana' }).toString(), 'tab=pricings&view=member&as=ana');
  assert.equal(withViewAs(base, { kind: 'member', userId: null }).toString(), 'tab=pricings&view=member');
  const asMember = withViewAs(base, { kind: 'member', userId: 'ana' });
  assert.equal(withViewAs(asMember, { kind: 'visitor' }).toString(), 'tab=pricings&view=visitor');
  assert.equal(withViewAs(asMember, null).toString(), 'tab=pricings');
  assert.equal(base.toString(), 'tab=pricings');
});

test('tells requests apart by key', () => {
  assert.equal(viewAsKey(null), '');
  assert.equal(viewAsKey({ kind: 'visitor' }), 'visitor');
  assert.notEqual(viewAsKey({ kind: 'member', userId: 'ana' }), viewAsKey({ kind: 'member', userId: 'zoe' }));
  assert.notEqual(viewAsKey({ kind: 'member', userId: null }), viewAsKey({ kind: 'member', userId: 'ana' }));
});

test('only owners and admins preview the organization', () => {
  assert.equal(canPreviewOrganization('OWNER'), true);
  assert.equal(canPreviewOrganization('ADMIN'), true);
  assert.equal(canPreviewOrganization('MEMBER'), false);
  assert.equal(canPreviewOrganization(null), false);
});

test('previews as plain members only, by username', () => {
  assert.deepEqual(previewMembers(members).map(item => item.user.id), ['ana', 'zoe']);
});

test('an owner or admin previews as any member, or as the plain member asked for', () => {
  for (const role of ['OWNER', 'ADMIN'] as const) {
    assert.deepEqual(resolveOrgView(role, null, members), { mode: 'self', asMember: null });
    assert.deepEqual(resolveOrgView(role, { kind: 'visitor' }, members), { mode: 'visitor-preview', asMember: null });
    assert.deepEqual(resolveOrgView(role, { kind: 'member', userId: null }, members), { mode: 'member-preview', asMember: null });
    assert.equal(resolveOrgView(role, { kind: 'member', userId: 'zoe' }, members).asMember?.user.id, 'zoe');
    // An admin or someone gone is not previewed as: any member is.
    assert.deepEqual(resolveOrgView(role, { kind: 'member', userId: 'admin' }, members), { mode: 'member-preview', asMember: null });
    assert.deepEqual(resolveOrgView(role, { kind: 'member', userId: 'gone' }, members), { mode: 'member-preview', asMember: null });
  }
});

test('any member needs no member to exist', () => {
  const managers = [member('owner', 'OWNER'), member('admin', 'ADMIN')];
  assert.deepEqual(resolveOrgView('OWNER', { kind: 'member', userId: null }, managers), { mode: 'member-preview', asMember: null });
  assert.equal(resolveOrgView('OWNER', { kind: 'visitor' }, managers).mode, 'visitor-preview');
});

test('the API reads as the member picked, or as any member', () => {
  assert.equal(memberViewTarget(null), 'any');
  assert.equal(memberViewTarget(member('zoe', 'MEMBER')), 'zoe');
});

test('the request changes nothing for a plain member or someone outside', () => {
  for (const request of [null, { kind: 'visitor' } as const, { kind: 'member', userId: 'zoe' } as const]) {
    assert.deepEqual(resolveOrgView('MEMBER', request, members), { mode: 'self', asMember: null });
    assert.deepEqual(resolveOrgView(null, request, members), { mode: 'visitor', asMember: null });
  }
});
