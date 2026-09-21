import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import container from '../config/container';
import OrganizationService from '../services/OrganizationService';
import { handleError } from '../utils/users/helpers';

/**
 * The image types an organization avatar may be, mapped to the extension each
 * one is stored under.
 *
 * The extension comes from here rather than from the uploaded filename on
 * purpose. These files land in the folder `express.static` serves, so a name
 * the caller chose would decide the `Content-Type` the browser is later handed:
 * an `image/png` upload called `page.html` would come back as HTML and run on
 * the site's own origin.
 */
const AVATAR_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * The image is held in memory rather than written straight to disk, so one that
 * turns out to be too large or of the wrong type never reaches the static
 * folder. It is written out only once the caller is known to be allowed to
 * change it.
 */
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in AVATAR_EXTENSION_BY_MIME_TYPE) cb(null, true);
    else cb(new Error('Only JPEG, PNG and WebP images are allowed'));
  },
});

class OrganizationController {
  private organizationService: OrganizationService;
  public avatarUploadMiddleware: any;

  constructor() {
    this.organizationService = container.resolve('organizationService');
    this.index = this.index.bind(this);
    this.indexPublicRoots = this.indexPublicRoots.bind(this);
    this.indexByUser = this.indexByUser.bind(this);
    this.show = this.show.bind(this);
    this.hierarchy = this.hierarchy.bind(this);
    this.create = this.create.bind(this);
    this.createChildrenBulk = this.createChildrenBulk.bind(this);
    this.update = this.update.bind(this);
    this.moveToParent = this.moveToParent.bind(this);
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
    this.uploadAvatar = this.uploadAvatar.bind(this);
    this.removeAvatar = this.removeAvatar.bind(this);
    this.updateAvatarColors = this.updateAvatarColors.bind(this);
    this.avatarUploadMiddleware = avatarUpload.single('avatar');
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

  async hierarchy(req: any, res: any) {
    try {
      const nodes = await this.organizationService.getHierarchy(req.params.organizationId, req.user);
      res.json(nodes);
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

  async createChildrenBulk(req: any, res: any) {
    try {
      const result = await this.organizationService.createChildrenBulk(
        req.params.organizationId,
        req.body.organizations,
        req.user.id
      );
      res.status(201).json(result);
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

  async uploadAvatar(req: any, res: any) {
    try {
      if (!req.file) {
        return res.status(400).send({ error: 'No file uploaded' });
      }

      const extension = AVATAR_EXTENSION_BY_MIME_TYPE[req.file.mimetype];
      if (!extension) {
        return res.status(400).send({ error: 'Only JPEG, PNG and WebP images are allowed' });
      }

      const organizationId = req.params.organizationId;
      const filename = `${organizationId}-${Date.now()}.${extension}`;
      const folder =
        (process.env.SERVER_STATICS_FOLDER || 'public/') +
        (process.env.ORG_AVATARS_FOLDER || 'static/avatars/orgs');

      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, filename), req.file.buffer);

      const avatarPath = `${process.env.ORG_AVATARS_FOLDER || 'static/avatars/orgs'}/${filename}`;
      const organization = await this.organizationService.updateAvatar(organizationId, {
        avatarPath,
        avatarBgColor: req.body.avatarBgColor,
        avatarFgColor: req.body.avatarFgColor,
        isUpload: true,
      });
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  /**
   * Picks a predefined avatar, or none at all, along with the colours it is
   * drawn in. The counterpart of an upload: no file changes hands, only a
   * choice from the list the client was offered.
   */
  async updateAvatarColors(req: any, res: any) {
    try {
      const { avatarPath, avatarBgColor, avatarFgColor } = req.body;
      const organization = await this.organizationService.updateAvatar(
        req.params.organizationId,
        { avatarPath, avatarBgColor, avatarFgColor }
      );
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async removeAvatar(req: any, res: any) {
    try {
      const organization = await this.organizationService.removeAvatar(
        req.params.organizationId
      );
      res.json(organization);
    } catch (err: any) {
      const { status, message } = handleError(err);
      res.status(status).send({ error: message });
    }
  }

  async moveToParent(req: any, res: any) {
    try {
      const organization = await this.organizationService.moveToParent(
        req.params.organizationId,
        req.body.parentId ?? null,
        req.user
      );
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
