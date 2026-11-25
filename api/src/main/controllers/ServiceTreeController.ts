import container from '../config/container';
import ServiceTreeService from '../services/ServiceTreeService';
import { handleError } from '../utils/users/helpers';
import { memberAudience } from '../services/OrganizationMemberViewService';

class ServiceTreeController {
  private serviceTreeService: ServiceTreeService;

  constructor() {
    this.serviceTreeService = container.resolve('serviceTreeService');
    this.show = this.show.bind(this);
    this.showAsMember = this.showAsMember.bind(this);
    this.replace = this.replace.bind(this);
  }

  /** The tree as any plain member, or one member, reads it; for its owners and admins, never editable. */
  async showAsMember(req: any, res: any) {
    try {
      const audience = await memberAudience(req);
      const tree =
        audience.kind === 'any'
          ? await this.serviceTreeService.showAsPlainMember(req.params.organizationId)
          : await this.serviceTreeService.show(req.params.organizationId, audience.reader);
      res.set('Cache-Control', 'no-store');
      res.json({ ...tree, canEdit: false });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
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
