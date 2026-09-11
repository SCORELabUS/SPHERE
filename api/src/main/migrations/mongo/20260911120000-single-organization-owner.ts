import mongoose from 'mongoose';
import { ROLE_WEIGHT } from '../../types/models/Organization';

/**
 * Collapses organizations that hold more than one owner down to a single one.
 *
 * An organization now has exactly one owner: it is handed over as a swap rather
 * than shared, so nothing creates a second seat any more. Data written before
 * that rule existed can still hold several, which would leave those
 * organizations with two people able to give them away.
 *
 * Where the extra owners came from the organization above — ownership is
 * inherited down the tree — the inherited one is the seat that stays, so the
 * outcome matches what a handover would produce today. Failing that the oldest
 * membership stays, which is the one that founded the organization. Everyone
 * else becomes an ADMIN and keeps full management access.
 */
export async function up(db: mongoose.Connection) {
  const organizations = await db
    .collection('organizations')
    .find({}, { projection: { _id: 1, _parentId: 1 } })
    .toArray();

  // Shallowest first, so a child is settled against a parent whose own owner has
  // already been decided. The depth is walked up the `_parentId` chain rather
  // than read off `ancestors`, which predates that field and is missing from the
  // oldest organizations — sorting on it would put children before their parent
  // and quietly skip the inheritance rule below.
  const byId = new Map(organizations.map((organization: any) => [organization._id.toString(), organization]));

  const depthOf = (organization: any) => {
    const visited = new Set<string>();
    let current = organization;
    let depth = 0;

    while (current?._parentId) {
      const id = current._id.toString();
      // Bad data could point a branch at itself; stop rather than spin.
      if (visited.has(id)) break;
      visited.add(id);

      current = byId.get(current._parentId.toString());
      if (!current) break;
      depth += 1;
    }

    return depth;
  };

  const depths = new Map(
    organizations.map((organization: any) => [organization._id.toString(), depthOf(organization)])
  );

  organizations.sort(
    (a: any, b: any) => depths.get(a._id.toString())! - depths.get(b._id.toString())!
  );

  const ownerByOrganization = new Map<string, string>();
  let demotedCount = 0;

  for (const organization of organizations) {
    const owners = await db
      .collection('organizationMemberships')
      .find({ _organizationId: organization._id, role: 'OWNER' })
      .sort({ joinedAt: 1, _id: 1 })
      .toArray();

    if (owners.length === 0) {
      continue;
    }

    let keeper = owners[0];

    if (owners.length > 1 && organization._parentId) {
      const parentOwnerId = ownerByOrganization.get(organization._parentId.toString());
      const inherited = owners.find(
        (membership: any) => membership._userId.toString() === parentOwnerId
      );
      if (inherited) {
        keeper = inherited;
      }
    }

    ownerByOrganization.set(organization._id.toString(), keeper._userId.toString());

    const demoted = owners
      .filter((membership: any) => !membership._id.equals(keeper._id))
      .map((membership: any) => membership._id);

    if (demoted.length === 0) {
      continue;
    }

    await db.collection('organizationMemberships').updateMany(
      { _id: { $in: demoted } },
      { $set: { role: 'ADMIN', _roleWeight: ROLE_WEIGHT.ADMIN } }
    );
    demotedCount += demoted.length;

    console.log(
      `[organizationMemberships] Organization ${organization._id} kept owner ${keeper._userId} and demoted ${demoted.length} other owner(s) to ADMIN.`
    );
  }

  console.log(`[organizationMemberships] Demoted ${demotedCount} surplus owner(s) in total.`);
}

/**
 * There is nothing to put back: this migration enforces a rule rather than
 * changing a shape, and the memberships it touched carry no record of having
 * been owners once. Reverting the rule does not require reverting the data — the
 * demoted members are ADMINs, which is a role the old code understood perfectly
 * well.
 */
export async function down() {
  // Intentionally empty, see above.
}
