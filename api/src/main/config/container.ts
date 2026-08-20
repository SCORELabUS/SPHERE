// deno-lint-ignore-file no-explicit-any
import { createContainer, asValue, asClass, AwilixContainer } from "awilix";
import dotenv from "dotenv";
import process from "node:process";

import MongooseUserRepository from "../repositories/mongoose/UserRepository";
import MongoosePricingRepository from "../repositories/mongoose/PricingRepository";
import MongoosePricingCollectionRepository from "../repositories/mongoose/PricingCollectionRepository";
import OrganizationRepository from '../repositories/mongoose/OrganizationRepository';
import OrganizationMembershipRepository from '../repositories/mongoose/OrganizationMembershipRepository';
import OrganizationInvitationRepository from '../repositories/mongoose/OrganizationInvitationRepository';
import EntityPermissionRepository from '../repositories/mongoose/EntityPermissionRepository';
import NotificationRepository from '../repositories/mongoose/NotificationRepository';

import UserService from "../services/UserService";
import PricingService from "../services/PricingService";
import PricingCollectionService from "../services/PricingCollectionService";
import CacheService from "../services/CacheService";
import OrganizationService from '../services/OrganizationService';
import PermissionService from '../services/PermissionService';
import UserSettingsService from '../services/UserSettingsService';
import NotificationService from '../services/NotificationService';
import ApiKeyService from '../services/ApiKeyService';
import AuthProviderService from '../services/AuthProviderService';
import BrevoEmailService from '../services/email/BrevoEmailService';
import EmailVerificationService from '../services/EmailVerificationService';
import PasswordResetService from '../services/PasswordResetService';

dotenv.config();

function initContainer(databaseType: string): AwilixContainer {
  const container: AwilixContainer = createContainer();
  let userRepository, pricingRepository, pricingCollectionRepository, organizationRepository, organizationMembershipRepository, organizationInvitationRepository, entityPermissionRepository, notificationRepository;

  switch (databaseType) {
    case "mongoDB":
      userRepository = new MongooseUserRepository();
      pricingRepository = new MongoosePricingRepository();
      pricingCollectionRepository = new MongoosePricingCollectionRepository();
      organizationRepository = new OrganizationRepository();
      organizationMembershipRepository = new OrganizationMembershipRepository();
      organizationInvitationRepository = new OrganizationInvitationRepository();
      entityPermissionRepository = new EntityPermissionRepository();
      notificationRepository = new NotificationRepository();
      break;
    default:
      throw new Error(`Unsupported database type: ${databaseType}`);
  }
  container.register({
    userRepository: asValue(userRepository),
    pricingRepository: asValue(pricingRepository),
    pricingCollectionRepository: asValue(pricingCollectionRepository),
    organizationRepository: asValue(organizationRepository),
    organizationMembershipRepository: asValue(organizationMembershipRepository),
    organizationInvitationRepository: asValue(organizationInvitationRepository),
    entityPermissionRepository: asValue(entityPermissionRepository),
    notificationRepository: asValue(notificationRepository),
    userService: asClass(UserService).singleton(),
    pricingService: asClass(PricingService).singleton(),
    pricingCollectionService: asClass(PricingCollectionService).singleton(),
    cacheService: asClass(CacheService).singleton(),
    organizationService: asClass(OrganizationService).singleton(),
    permissionService: asClass(PermissionService).singleton(),
    userSettingsService: asClass(UserSettingsService).singleton(),
    notificationService: asClass(NotificationService).singleton(),
    apiKeyService: asClass(ApiKeyService).singleton(),
    authProviderService: asClass(AuthProviderService).singleton(),
    emailService: asClass(BrevoEmailService).singleton(),
    emailVerificationService: asClass(EmailVerificationService).singleton(),
    passwordResetService: asClass(PasswordResetService).singleton(),
  });
  return container;
}

let container: AwilixContainer | null = null;
if (!container) { container = initContainer(process.env.DATABASE_TECHNOLOGY ?? ""); }

export default container as AwilixContainer;
