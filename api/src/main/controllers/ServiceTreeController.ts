import container from '../config/container';
import ServiceTreeService from '../services/ServiceTreeService';
import { handleError } from '../utils/users/helpers';

class ServiceTreeController {
  private serviceTreeService: ServiceTreeService;

  constructor() {
    this.serviceTreeService = container.resolve('serviceTreeService');
    this.show = this.show.bind(this);
    this.replace = this.replace.bind(this);
  }

  async show(req: any, res: any) {
    try {
      const tree = await this.serviceTreeService.show(req.params.organizationId, req.user);
      res.json(tree);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async replace(req: any, res: any) {
    try {
      const tree = await this.serviceTreeService.replace(req.params.organizationId, req.body, req.user);
      res.json(tree);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default ServiceTreeController;
