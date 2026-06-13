import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import OrganizationInvitationMongoose from './models/OrganizationInvitationMongoose';

class OrganizationInvitationRepository extends RepositoryBase {
  async findByCode(code: string) {
    try {
      const inv = await OrganizationInvitationMongoose.findOne({ code });
      return inv ? inv.toObject({ getters: true, virtuals: true, versionKey: false }) : null;
    } catch {
      return null;
    }
  }

  async findByOrganizationId(organizationId: string) {
    try {
      const invitations = await OrganizationInvitationMongoose.find({
        _organizationId: new mongoose.Types.ObjectId(organizationId),
      }).sort({ createdAt: -1 });
      return invitations.map(inv => inv.toObject({ getters: true, virtuals: true, versionKey: false }));
    } catch {
      return [];
    }
  }

  async create(data: any) {
    const inv = await new OrganizationInvitationMongoose(data).save();
    return inv.toObject({ getters: true, virtuals: true, versionKey: false });
  }

  async incrementUseCount(id: string) {
    return OrganizationInvitationMongoose.findOneAndUpdate({ _id: id }, { $inc: { useCount: 1 } }, { new: true });
  }

  async destroy(id: string) {
    const result = await OrganizationInvitationMongoose.deleteOne({ _id: id });
    return result?.deletedCount === 1;
  }

  async destroyByOrganizationId(organizationId: string) {
    await OrganizationInvitationMongoose.deleteMany({
      _organizationId: new mongoose.Types.ObjectId(organizationId),
    });
    return true;
  }
}

export default OrganizationInvitationRepository;
