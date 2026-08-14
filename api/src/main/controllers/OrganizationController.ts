import container from '../config/container';
import OrganizationService from '../services/OrganizationService';
import { handleError } from '../utils/users/helpers';

class OrganizationController {
  private organizationService: OrganizationService;

  constructor() {
    this.organizationService = container.resolve('organizationService');
    this.index = this.index.bind(this);
    this.indexPublicRoots = this.indexPublicRoots.bind(this);
    this.indexByUser = this.indexByUser.bind(this);
    this.show = this.show.bind(this);
    this.create = this.create.bind(this);
    this.update = this.update.bind(this);
    this.destroy = this.destroy.bind(this);
    this.listMembers = this.listMembers.bind(this);
    this.addMember = this.addMember.bind(this);
    this.addMembersBulk = this.addMembersBulk.bind(this);
    this.updateMemberRole = this.updateMemberRole.bind(this);
    this.removeMember = this.removeMember.bind(this);
    this.createInvitation = this.createInvitation.bind(this);
    this.listInvitations = this.listInvitations.bind(this);
    this.revokeInvitation = this.revokeInvitation.bind(this);
    this.previewInvitation = this.previewInvitation.bind(this);
    this.joinViaInvitation = this.joinViaInvitation.bind(this);
    this.inviteUsers = this.inviteUsers.bind(this);
  }

  async index(req: any, res: any) {
    try {
      if (req.user.role !== 'ADMIN') {
        throw new Error('PERMISSION ERROR: Only ADMIN users can access all organizations');
      }
      const organizations = await this.organizationService.index();
      res.json(organizations);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexPublicRoots(req: any, res: any) {
    try {
      const parsedLimit = Number.parseInt(req.query.limit, 10);
      const parsedOffset = Number.parseInt(req.query.offset, 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 12;
      const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : undefined;

      const organizations = await this.organizationService.indexPublicRoots({ q, limit, offset });
      res.json(organizations);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async indexByUser(req: any, res: any) {
    try {
      const { limit, offset } = req.query;
      const pagination = (limit !== undefined || offset !== undefined)
        ? {
            limit: limit !== undefined ? parseInt(limit as string, 10) : undefined,
            offset: offset !== undefined ? parseInt(offset as string, 10) : undefined,
          }
        : undefined;
      const result = await this.organizationService.indexByUser(req.user.id, {
        treeFormat: true,
        pagination,
      });
      res.json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async show(req: any, res: any) {
    try {
      const organization = await this.organizationService.show(req.params.organizationId);
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async create(req: any, res: any) {
    try {
      if (req.body.isPersonal) {
        req.body.name = req.user.username;
      }
      const organization = await this.organizationService.createWithOwner(req.body, req.user.id);
      res.status(201).json(organization);
    } catch (err: any) {
      if (err.name?.includes('ValidationError') || err.code === 11000) {
        res.status(422).send({ error: err.message });
      } else {
        const { status, message } = handleError(err);
        res.status(status).send({ error: message });
      }
    }
  }

  async update(req: any, res: any) {
    try {
      const organization = await this.organizationService.update(req.params.organizationId, req.body);
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async destroy(req: any, res: any) {
    try {
      const result = await this.organizationService.destroy(req.params.organizationId);
      const message = result ? 'Successfully deleted.' : 'Could not delete organization.';
      res.json({ message });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async listMembers(req: any, res: any) {
    try {
      const members = await this.organizationService.listMembers(req.params.organizationId);
      res.json(members);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async addMember(req: any, res: any) {
    try {
      const { userId, role } = req.body;
      const membership = await this.organizationService.addMember(userId, req.params.organizationId, role);
      res.status(201).json(membership);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async addMembersBulk(req: any, res: any) {
    try {
      const result = await this.organizationService.addMembersBulk(
        req.params.organizationId,
        req.body.members
      );
      res.status(201).json(result);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async updateMemberRole(req: any, res: any) {
    try {
      const { role } = req.body;
      const membership = await this.organizationService.updateMemberRole(req.params.userId, req.params.organizationId, role, req.user);
      res.json(membership);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async removeMember(req: any, res: any) {
    try {
      await this.organizationService.removeMember(req.params.userId, req.params.organizationId, req.user);
      res.json({ message: 'Successfully removed.' });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async createInvitation(req: any, res: any) {
    try {
      const { expiresInDays, maxUses } = req.body;
      const invitation = await this.organizationService.createInvitation(req.params.organizationId, req.user.id, {
        expiresInDays,
        maxUses,
      });
      res.status(201).json(invitation);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async listInvitations(req: any, res: any) {
    try {
      const invitations = await this.organizationService.listInvitations(req.params.organizationId);
      res.json(invitations);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async revokeInvitation(req: any, res: any) {
    try {
      await this.organizationService.revokeInvitation(req.params.invitationId);
      res.json({ message: 'Invitation revoked.' });
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async previewInvitation(req: any, res: any) {
    try {
      const data = await this.organizationService.previewInvitation(req.params.code);
      res.json(data);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async joinViaInvitation(req: any, res: any) {
    try {
      const organization = await this.organizationService.joinViaInvitation(req.params.code, req.user.id);
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async inviteUsers(req: any, res: any) {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).send({ error: 'userIds must be a non-empty array' });
      }
      const invitation = await this.organizationService.inviteUsersToOrganization(
        req.params.organizationId,
        userIds,
        req.user.id
      );
      res.status(201).json(invitation);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }
}

export default OrganizationController;
