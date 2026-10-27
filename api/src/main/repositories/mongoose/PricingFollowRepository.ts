import mongoose from 'mongoose';
import RepositoryBase from '../RepositoryBase';
import PricingFollowMongoose from './models/PricingFollowMongoose';

class PricingFollowRepository extends RepositoryBase {
  async follow(userId: string, pricingId: string): Promise<void> {
    await PricingFollowMongoose.updateOne(
      { _userId: new mongoose.Types.ObjectId(userId), pricingId: new mongoose.Types.ObjectId(pricingId) },
      { $setOnInsert: { _userId: new mongoose.Types.ObjectId(userId), pricingId: new mongoose.Types.ObjectId(pricingId) } },
      { upsert: true }
    );
  }

  async unfollow(userId: string, pricingId: string): Promise<void> {
    await PricingFollowMongoose.deleteOne({
      _userId: new mongoose.Types.ObjectId(userId),
      pricingId: new mongoose.Types.ObjectId(pricingId),
    });
  }

  async isFollowing(userId: string, pricingId: string): Promise<boolean> {
    const follow = await PricingFollowMongoose.exists({
      _userId: new mongoose.Types.ObjectId(userId),
      pricingId: new mongoose.Types.ObjectId(pricingId),
    });
    return follow !== null;
  }

  async findFollowerIds(pricingId: string): Promise<string[]> {
    const follows = await PricingFollowMongoose.find({ pricingId: new mongoose.Types.ObjectId(pricingId) })
      .select('_userId')
      .lean();
    return follows.map(follow => String(follow._userId));
  }
}

export default PricingFollowRepository;
