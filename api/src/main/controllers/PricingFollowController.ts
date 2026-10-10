import container from '../config/container';
import PricingFollowService from '../services/PricingFollowService';
import { handleError } from '../utils/users/helpers';

class PricingFollowController {
  private pricingFollowService: PricingFollowService;

  constructor() {
    this.pricingFollowService = container.resolve('pricingFollowService');
    this.status = this.status.bind(this);
    this.follow = this.follow.bind(this);
    this.unfollow = this.unfollow.bind(this);
  }

  async status(req: any, res: any) {
    try {
      const result = await this.pricingFollowService.status(req.params.organizationId, req.params.pricingSlug, req.user);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async follow(req: any, res: any) {
    try {
      const result = await this.pricingFollowService.follow(req.params.organizationId, req.params.pricingSlug, req.user);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async unfollow(req: any, res: any) {
    try {
      const result = await this.pricingFollowService.unfollow(req.params.organizationId, req.params.pricingSlug, req.user);
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default PricingFollowController;
