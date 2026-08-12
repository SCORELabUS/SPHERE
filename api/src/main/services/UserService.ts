import container from '../config/container';
import UserRepository from '../repositories/mongoose/UserRepository';
import OrganizationMembershipRepository from '../repositories/mongoose/OrganizationMembershipRepository';
import { USER_ROLES } from '../types/config/permissions';
import { LeanUser, UserFilters } from '../types/models/User';
import { processFileUris } from './FileService';
import bcrypt from 'bcryptjs';
import { generateUserTokenDTO, generateJwtToken, hashPassword } from '../utils/users/helpers';
import OrganizationService from './OrganizationService';
import EmailVerificationService from './EmailVerificationService';

class UserService {
  private userRepository: UserRepository;
  private organizationService: OrganizationService;
  private organizationMembershipRepository: OrganizationMembershipRepository;
  private emailVerificationService: EmailVerificationService;

  constructor() {
    this.userRepository = container.resolve('userRepository');
    this.organizationService = container.resolve('organizationService');
    this.organizationMembershipRepository = container.resolve('organizationMembershipRepository');
    this.emailVerificationService = container.resolve('emailVerificationService');
  }

  async index(queryParams: any, userRole?: string): Promise<LeanUser[]> {
    const filter: UserFilters = {};

    if (queryParams.q) filter.q = String(queryParams.q);
    if (queryParams.username) filter.username = String(queryParams.username);
    if (queryParams.email) filter.email = String(queryParams.email);
    if (queryParams.role) filter.role = String(queryParams.role) as any;

    const limit = queryParams.limit || 20;
    const offset = queryParams.offset || 0;
    const sortBy = queryParams.sortBy === 'email' ? 'email' : 'username';
    const sortOrder = queryParams.sortOrder === 'desc' ? 'desc' : 'asc';

    // When using q with non-ADMIN user, limit results and project only public fields
    const isSearch = !!queryParams.q;
    const shouldExcludeSensitive = isSearch && userRole !== 'ADMIN';

    // When a non-ADMIN user searches, automatically exclude admin users
    if (isSearch && userRole !== 'ADMIN' && !filter.role) {
      filter.role = 'USER' as any;
    }

    const projection: Record<string, 0 | 1> | undefined = shouldExcludeSensitive
      ? { password: 0, email: 0, role: 0, phone: 0, token: 0, tokenExpiration: 0, apiKeys: 0, createdAt: 0, updatedAt: 0 }
      : undefined;

    const users = await this.userRepository.find(filter, offset, limit, sortBy, sortOrder, projection);
    return users;
  }

  async show(username: string): Promise<LeanUser> {
    const user = await this.userRepository.findByUsername(username);

    if (!user) {
      throw new Error('NOT FOUND: User not found');
    }

    if (user.settings?.avatar) {
      processFileUris(user.settings, ['avatar']);
    }

    return user;
  }

  async register(newUser: any, creatorData: LeanUser) {
    // Stablish a default role if not provided
    if (!creatorData || !newUser.role) {
      newUser.role = USER_ROLES[USER_ROLES.length - 1];
    }

    if (creatorData && creatorData.role !== 'ADMIN' && newUser.role === 'ADMIN') {
      throw new Error('PERMISSION ERROR: Only admins can create other admins.');
    }

    newUser.email = newUser.email.trim().toLowerCase();

    const existingEmail = await this.userRepository.findByEmail(newUser.email);
    if (existingEmail) {
      throw new Error(
        'CONFLICT: An account already exists with this email. Sign in with its existing method, then add a SPHERE password from Settings > Integrations.'
      );
    }

    const existingUser = await this.userRepository.findByUsername(newUser.username);

    if (existingUser) {
      throw new Error(
        'INVALID DATA: There is already a user with the username that you are trying to set'
      );
    }

    newUser.email = newUser.email.trim().toLowerCase();
    const existingEmail = await this.userRepository.findByEmail(newUser.email);
    if (existingEmail) {
      throw new Error('INVALID DATA: There is already a user with that email address');
    }

    if (!newUser.settings) newUser.settings = {};
    newUser.settings.avatar = newUser.settings.avatar || '';
    newUser.emailVerified = false;
    newUser = { ...newUser, ...generateUserTokenDTO() };

    let registeredUser: LeanUser;
    try {
      registeredUser = await this.userRepository.create(newUser);
    } catch (error: any) {
      if (error?.code === 11000 && error?.keyPattern?.email) {
        throw new Error('INVALID DATA: There is already a user with that email address');
      }
      if (error?.code === 11000 && error?.keyPattern?.username) {
        throw new Error('INVALID DATA: There is already a user with that username');
      }
      throw error;
    }

    // Business rule: every user must have a personal organization they cannot delete.
    // Create it immediately after user creation.
    await this.organizationService.ensurePersonalOrganizationForUser({
      id: registeredUser.id,
      username: registeredUser.username,
    });

    const emailSent = await this.emailVerificationService.sendForUser(registeredUser);
    const {
      password: _password,
      emailVerificationTokenHash: _tokenHash,
      emailVerificationExpiresAt: _tokenExpiresAt,
      emailVerificationSentAt: _tokenSentAt,
      token: _legacyToken,
      tokenExpiration: _legacyTokenExpiration,
      ...safeUser
    } = registeredUser;

    return { registeredUser: safeUser, emailVerificationRequired: true, emailSent };
  }

  async updateToken(targetUsername: string, reqUser: LeanUser) {
    if (targetUsername !== reqUser.username && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only update your own token');
    }
    
    const user = await this.userRepository.findByUsername(targetUsername);

    if (!user) {
      throw new Error('INVALID DATA: User not found');
    }

    // Generate a new JWT token
    const token = generateJwtToken({ id: user.id, username: user.username, role: user.role });

    // Also update the legacy token in DB
    await this.userRepository.updateToken(targetUsername, generateUserTokenDTO());

    return { token, tokenExpiration: new Date(Date.now() + 24 * 60 * 60 * 1000) };
  }

  async login(loginField: string, password: string): Promise<{ user: LeanUser; token: string }> {
    let user: LeanUser | null = await this.userRepository.findByUsername(loginField, "+password");

    if (!user) {
      user = await this.userRepository.findByEmail(loginField, "+password");
    }

    if (!user) {
      throw new Error('INVALID DATA: Invalid credentials');
    }

    // SSO accounts have no local password; bcrypt.compare throws on undefined hashes.
    if (!user.password) {
      throw new Error('INVALID DATA: Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(password, user.password);

    if (!passwordValid) {
      throw new Error('INVALID DATA: Invalid credentials');
    }

    if (user.emailVerified === false) {
      throw new Error('PERMISSION ERROR: Verify your email address before signing in');
    }

    // Generate JWT token
    const token = generateJwtToken({ id: user.id, username: user.username, role: user.role });

    // Also store the legacy token in DB for backward compatibility
    await this.userRepository.updateToken(user.username, generateUserTokenDTO());

    return { user, token };
  }

  async update(reqUser: LeanUser, targetUsername: string, data: any) {
    
    if(reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only update your own user data');
    }else if (data.role && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only update user roles if you are an admin');
    }

    const userToUpdate = await this.userRepository.findByUsername(targetUsername);
    
    if (!userToUpdate) {
      throw new Error('NOT FOUND: User not found');
    }

    // Validación: no permitir degradar al último admin
    if (userToUpdate.role === 'ADMIN' && data.role && data.role !== 'ADMIN') {
      const allAdmins = await this.userRepository.find({role: 'ADMIN'});
      const adminCount = allAdmins.filter((u: LeanUser) => u.username !== targetUsername).length;
      if (adminCount < 1) {
        throw new Error('PERMISSION ERROR: There must always be at least one ADMIN user in the system.');
      }
    }

    if (data.username && data.username !== targetUsername) {
      const existingUser = await this.userRepository.findByUsername(data.username);
      if (existingUser) {
        throw new Error('INVALID DATA: There is already a user with the username that you are trying to set');
      }
    }

    if (data.password) {
      data.password = await hashPassword(data.password);
    }

    const user = await this.userRepository.update(targetUsername, data);

    if (!user) {
      throw new Error('NOT FOUND: User not found after update attempt');
    }

    if (data.username && data.username !== targetUsername) {
      const userId = user.id;
      const memberships = await this.organizationMembershipRepository.findByUserId(userId);
      const personalMembership = memberships.find((m: any) => m.organization?.isPersonal);
      if (personalMembership) {
        await this.organizationService.update(personalMembership.organization.id, {
          name: data.username.toLowerCase(),
          displayName: `${data.username} PERSONAL`,
        });
      }
    }

    if ((user as any).settings?.avatar) {
      processFileUris((user as any).settings, ['avatar']);
    }

    return user;
  }

  async destroy(reqUser: LeanUser, targetUsername: string) {
    if (reqUser.username !== targetUsername && reqUser.role !== 'ADMIN') {
      throw new Error('PERMISSION ERROR: You can only delete your own user');
    }

    const userToDelete = await this.userRepository.findByUsername(targetUsername);

    if (!userToDelete) {
      throw new Error('NOT FOUND: User not found');
    }

    if (userToDelete.role === 'ADMIN') {
      const allAdmins = await this.userRepository.find({role: 'ADMIN'});
      const adminCount = allAdmins.filter((u: LeanUser) => u.username !== targetUsername).length;
      if (adminCount < 1) {
        throw new Error('PERMISSION ERROR: There must always be at least one ADMIN user in the system.');
      }
    }

    const userId = userToDelete.id;
    const userMemberships = await this.organizationMembershipRepository.findByUserId(userId);

    for (const membership of userMemberships) {
      const org = membership.organization;
      const isPersonal = org.isPersonal;
      const membershipRole = membership.role;

      if (isPersonal) {
        await this.organizationService.destroy(org.id, true);
      } else {
        const membersBefore = await this.organizationService.listMembers(org.id, userId);

        if (membershipRole === 'OWNER' && membersBefore.length > 0) {
          const adminMember = membersBefore.find((m: any) => m.role === 'ADMIN');
          const newOwner = adminMember ?? membersBefore[0];
          await this.organizationService.updateMemberRole(
            newOwner.user.id,
            org.id,
            'OWNER',
            { ...reqUser, orgRole: 'OWNER' }
          );
        }

        await this.organizationService.removeMember(userId, org.id);

        const remainingMembers = await this.organizationService.listMembers(org.id);
        if (remainingMembers.length === 0) {
          await this.organizationService.destroy(org.id, true);
        }
      }
    }

    const result = await this.userRepository.destroy(targetUsername);
    if (!result) {
      throw new Error('NOT FOUND: User not found');
    }
    return true;
  }

  async exists(username: string) {
    return await this.userRepository.findByUsername(username);
  }
}

export default UserService;
